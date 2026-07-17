import { z } from 'zod';
import {
  UsenetStreamService,
  UsenetStreamServiceConfig,
} from './usenet-stream-base.js';
import {
  DebridServiceConfig,
  PlaybackInfo,
  DebridFile,
  DebridError,
} from './base.js';
import {
  ServiceId,
  createLogger,
  fromUrlSafeBase64,
  appConfig,
  makeUrlLogSafe,
} from '../utils/index.js';
import {
  selectFileInTorrentOrNZB,
  buildResolveKey,
  hashNzbUrl,
} from './utils.js';
import { parseTorrentTitle } from '@viren070/parse-torrent-title';
import { fetch } from 'undici';
import { basename } from 'path';

const logger = createLogger('altmount');

// Native AltMount `/api/nzb/streams` response shape
interface AltmountNativeStream {
  url: string;
  title: string;
  name: string;
}

interface AltmountNativeStreamsResponse {
  streams: AltmountNativeStream[];
  _queue_item_id: number;
  _queue_status: string;
  _cached: boolean;
}

export const AltmountConfig = z.object({
  altmountUrl: z
    .string()
    .transform((s) => s.trim().replace(/^\/+/, '').replace(/\/+$/, '')),
  publicAltmountUrl: z
    .string()
    .optional()
    .transform((s) => s?.trim().replace(/^\/+/, '').replace(/\/+$/, '')),
  altmountApiKey: z.string(),
  // webdavUser and webdavPassword are optional when using the native streams API.
  // They are only needed as a fallback for AltMount versions that predate the
  // native /api/nzb/streams endpoint.
  webdavUser: z.string().optional(),
  webdavPassword: z.string().optional(),
  aiostreamsAuth: z.string().optional(),
});

export class AltmountService extends UsenetStreamService {
  readonly serviceName: ServiceId = 'altmount';
  readonly serviceLogger = logger;

  private readonly altmountBaseUrl: string;
  private readonly publicAltmountBaseUrl: string | undefined;
  private readonly altmountApiKey: string;

  constructor(
    config: DebridServiceConfig,
    cacheAndPlayOptions?: { pollingInterval?: number; maxWaitTime?: number }
  ) {
    const parsedConfig = AltmountConfig.parse(
      JSON.parse(fromUrlSafeBase64(config.token))
    );

    const auth: UsenetStreamServiceConfig = {
      webdavUrl: `${parsedConfig.altmountUrl}/webdav/`,
      publicWebdavUrl: `${parsedConfig.publicAltmountUrl || parsedConfig.altmountUrl}/webdav/`,
      // Fall back to empty strings so the WebDAV client can be constructed even
      // when credentials are omitted (the WebDAV path is only used when the
      // native API is unavailable on older AltMount versions).
      webdavUser: parsedConfig.webdavUser ?? '',
      webdavPassword: parsedConfig.webdavPassword ?? '',
      apiUrl: `${parsedConfig.altmountUrl}/sabnzbd/api`,
      apiKey: parsedConfig.altmountApiKey,
      aiostreamsAuth: parsedConfig.aiostreamsAuth,
      cacheAndPlayOptions,
    };

    super(config, auth, 'altmount');

    this.altmountBaseUrl = parsedConfig.altmountUrl;
    this.publicAltmountBaseUrl = parsedConfig.publicAltmountUrl;
    this.altmountApiKey = parsedConfig.altmountApiKey;
  }

  protected getContentPathPrefix(): string {
    return '/complete';
  }

  protected getExpectedFolderName(
    nzb: PlaybackInfo & { type: 'usenet' }
  ): string {
    const nzbUrl = nzb.nzb;
    return nzbUrl.endsWith('.nzb')
      ? basename(nzbUrl, '.nzb')
      : basename(nzbUrl);
  }

  /**
   * Override _resolve to call AltMount's native `/api/nzb/streams` endpoint.
   *
   * This avoids the SABnzbd history polling + WebDAV traversal roundtrip used
   * by the base class. AltMount returns ready-to-play stream URLs directly,
   * including an early "streamable" signal so playback can start before the
   * full post-processing pipeline completes.
   *
   * Falls back to the parent SABnzbd+WebDAV path on 404/405 so that older
   * AltMount instances (pre-native-API) continue to work without reconfiguration.
   *
   * For catalog/library items (serviceItemId without nzb) the parent
   * _resolveLibraryItem path is used unchanged.
   */
  protected async _resolve(
    playbackInfo: PlaybackInfo & { type: 'usenet' },
    filename: string
  ): Promise<string | undefined> {
    const { nzb, metadata, hash } = playbackInfo;

    // Library items resolved by serviceItemId use WebDAV directory listing —
    // delegate to the parent implementation unchanged.
    if (!nzb) {
      return super._resolve(playbackInfo, filename);
    }

    const cacheKey = buildResolveKey(
      'uss:cache',
      this.serviceName,
      playbackInfo,
      filename,
      this.config.token,
      this.config.clientIp
    );

    const cachedResponse = await UsenetStreamService.resolveCache.get(cacheKey);
    if (cachedResponse) {
      this.serviceLogger.debug(
        `Using cached stream URL for ${makeUrlLogSafe(nzb)}`
      );
      return cachedResponse;
    }

    try {
      const body = new URLSearchParams({ nzb_url: nzb });

      const response = await fetch(`${this.altmountBaseUrl}/api/nzb/streams`, {
        method: 'POST',
        headers: {
          'X-Api-Key': this.altmountApiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        // AltMount blocks until the file is streamable (or the import fails),
        // which can take several minutes for large releases.
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });

      // 404 / 405 means this is an older AltMount without the native endpoint
      if (response.status === 404 || response.status === 405) {
        this.serviceLogger.debug(
          'Native /api/nzb/streams not available, falling back to SABnzbd+WebDAV'
        );
        return super._resolve(playbackInfo, filename);
      }

      if (!response.ok) {
        throw new DebridError(
          `AltMount native API error: ${response.status} ${response.statusText}`,
          {
            statusCode: response.status,
            statusText: response.statusText,
            code: 'UNKNOWN',
            headers: {},
            body: null,
            type: 'api_error',
          }
        );
      }

      const data = (await response.json()) as AltmountNativeStreamsResponse;

      if (!data.streams?.length) {
        throw new DebridError('No streams returned from AltMount native API', {
          statusCode: 500,
          statusText: 'Internal Server Error',
          code: 'INTERNAL_SERVER_ERROR',
          headers: {},
          body: null,
          type: 'api_error',
        });
      }

      // Map AltMount streams to DebridFile so selectFileInTorrentOrNZB can
      // apply the standard filename / episode matching logic.
      const debridFiles: DebridFile[] = data.streams.map((stream, index) => ({
        name: stream.name,
        link: this.toPublicUrl(stream.url),
        size: 0,
        index,
      }));

      let selectedFile: DebridFile | undefined;

      if (debridFiles.length === 1) {
        selectedFile = debridFiles[0];
      } else {
        const title = filename || basename(nzb);
        const allStrings = [title, ...debridFiles.map((f) => f.name ?? '')];
        const parsedFilesMap = new Map(
          allStrings.map((s) => [s, parseTorrentTitle(s)])
        );

        const nzbInfo = {
          type: 'usenet' as const,
          nzb,
          hash,
          title,
          metadata,
          size: 0,
        };

        const debridDownload = {
          id: String(data._queue_item_id),
          status: 'downloaded' as const,
          files: debridFiles,
        };

        selectedFile = await selectFileInTorrentOrNZB(
          nzbInfo,
          debridDownload,
          parsedFilesMap,
          metadata
        );
      }

      const streamUrl = selectedFile?.link;
      if (!streamUrl) {
        throw new DebridError('No matching file found in AltMount streams', {
          statusCode: 400,
          statusText: 'Bad Request',
          code: 'NO_MATCHING_FILE',
          headers: {},
          body: { availableFiles: debridFiles.map((f) => f.name) },
          type: 'api_error',
        });
      }

      this.serviceLogger.debug('Selected stream from AltMount native API', {
        streamUrl,
        cached: data._cached,
        status: data._queue_status,
      });

      await UsenetStreamService.resolveCache.set(
        cacheKey,
        streamUrl,
        appConfig.builtins.debrid.playbackLinkCacheTtl,
        true
      );

      return streamUrl;
    } catch (error) {
      if (error instanceof DebridError) {
        throw error;
      }
      // Network or parse error — fall back to the SABnzbd+WebDAV path so the
      // service degrades gracefully rather than failing entirely.
      this.serviceLogger.warn(
        'Native AltMount API call failed, falling back to SABnzbd+WebDAV',
        { error: (error as Error).message }
      );
      return super._resolve(playbackInfo, filename);
    }
  }

  /**
   * Replace the internal AltMount base URL with the public URL in stream links
   * so that clients receive URLs they can actually reach.
   */
  private toPublicUrl(url: string): string {
    if (
      !this.publicAltmountBaseUrl ||
      this.publicAltmountBaseUrl === this.altmountBaseUrl
    ) {
      return url;
    }
    return url.replace(this.altmountBaseUrl, this.publicAltmountBaseUrl);
  }
}
