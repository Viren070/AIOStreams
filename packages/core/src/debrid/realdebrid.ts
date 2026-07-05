import { fetch } from 'undici';
import {
  ServiceId,
  createLogger,
  appConfig,
  Cache,
  DistributedLock,
} from '../utils/index.js';
import {
  DebridDownload,
  DebridError,
  DebridFile,
  PlaybackInfo,
  DebridFailureCache,
  TitleMetadata,
  TorrentDebridService,
} from './base.js';
import {
  Torrent,
  buildResolveKey,
  selectFileInTorrentOrNZB,
  removeDownloadOnAbort,
} from './utils.js';
import { parseTorrentTitle, ParsedResult } from '@viren070/parse-torrent-title';

const logger = createLogger('debrid:realdebrid');

export interface RealDebridServiceConfig {
  /** Base URL of a RealDebrid-compatible API, e.g. http://seedmount:8080 */
  baseUrl: string;
  /** API token (RealDebrid bearer token). */
  token: string;
  clientIp?: string;
}

/** RealDebrid `/rest/1.0/torrents/info` response (subset used here). */
interface RdTorrentInfo {
  id: string;
  hash: string;
  filename: string;
  original_filename?: string;
  bytes: number;
  original_bytes?: number;
  status: string;
  progress?: number;
  added?: string;
  seeders?: number;
  speed?: number;
  files?: Array<{ id: number; path: string; bytes: number; selected: number }>;
  links?: string[];
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/**
 * Maps a RealDebrid torrent `status` string to the unified
 * {@link DebridDownload} status vocabulary.
 *
 * RealDebrid statuses: magnet_error, magnet_conversion,
 * waiting_files_selection, queued, downloading, downloaded, error, virus,
 * compressing, uploading, dead.
 */
export function mapRealDebridStatus(status: string): DebridDownload['status'] {
  switch (status) {
    case 'downloaded':
      return 'downloaded';
    case 'downloading':
    case 'compressing':
      return 'downloading';
    case 'queued':
    case 'waiting_files_selection':
      return 'queued';
    case 'magnet_conversion':
      return 'processing';
    case 'uploading':
      return 'uploading';
    case 'magnet_error':
    case 'error':
    case 'virus':
    case 'dead':
      return 'failed';
    default:
      return 'unknown';
  }
}

/**
 * Native client for a RealDebrid-compatible REST API (`/rest/1.0/*`).
 *
 * Unlike the StremThru-backed services, this talks the RealDebrid wire
 * protocol directly against a user-supplied base URL, so it can point at a
 * self-hosted RealDebrid-compatible server.
 */
export class RealDebridService implements TorrentDebridService {
  readonly serviceName: ServiceId = 'custom_realdebrid';
  readonly capabilities = { torrents: true, usenet: false };

  private readonly baseUrl: string;
  private readonly token: string;
  private readonly clientIp?: string;
  private readonly pollingInterval: number;
  private readonly maxWaitTime: number;

  private static playbackLinkCache = Cache.getInstance<string, string | null>(
    'realdebrid:playbackLink'
  );

  constructor(
    config: RealDebridServiceConfig,
    options?: { pollInterval?: number; maxWaitTime?: number }
  ) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.token = config.token;
    this.clientIp = config.clientIp;
    this.pollingInterval = options?.pollInterval ?? 10_000;
    this.maxWaitTime = options?.maxWaitTime ?? 120_000;
  }

  private async request<T>(
    method: string,
    path: string,
    form?: Record<string, string>
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
    };
    let body: string | undefined;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }

    const res = await fetch(`${this.baseUrl}/rest/1.0${path}`, {
      method,
      headers,
      body,
    });

    const text = await res.text();
    if (!res.ok) {
      throw this.toDebridError(res.status, res.statusText, text);
    }
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  private toDebridError(
    statusCode: number,
    statusText: string,
    body: string
  ): DebridError {
    let message = statusText || 'RealDebrid request failed';
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object' && 'error' in parsed) {
        message = String((parsed as { error: unknown }).error);
      }
    } catch {
      /* non-JSON body */
    }
    return new DebridError(message, {
      statusCode,
      statusText,
      code:
        statusCode === 401 || statusCode === 403
          ? 'UNAUTHORIZED'
          : statusCode === 404
            ? 'NOT_FOUND'
            : 'UNKNOWN',
      headers: {},
      body: parsed ?? body,
      type: 'api_error',
    });
  }

  private mapInfoToDownload(info: RdTorrentInfo): DebridDownload {
    const links = info.links ?? [];
    // RealDebrid returns one link per SELECTED file, ordered by ascending
    // file id. Sort a copy by id before pairing so the mapping is correct
    // even if a compatible server returns `files` in a different order.
    const sorted = [...(info.files ?? [])].sort((a, b) => a.id - b.id);
    const selectedCount = sorted.filter((f) => f.selected).length;
    if (info.status === 'downloaded' && links.length !== selectedCount) {
      logger.warn(
        `Link count (${links.length}) does not match selected file count ` +
          `(${selectedCount}) for torrent ${info.id}; links may be mis-paired`
      );
    }
    let linkCursor = 0;
    const files: DebridFile[] = sorted.map((f) => {
      const file: DebridFile = {
        index: f.id - 1, // RealDebrid file ids are 1-based
        name: basename(f.path),
        size: f.bytes,
        path: f.path,
      };
      if (f.selected) {
        file.link = links[linkCursor++];
      }
      return file;
    });

    return {
      id: info.id,
      hash: info.hash,
      name: info.original_filename ?? info.filename,
      size: info.original_bytes ?? info.bytes,
      status: mapRealDebridStatus(info.status),
      addedAt: info.added,
      files,
    };
  }

  private withIp(form: Record<string, string>): Record<string, string> {
    return this.clientIp ? { ...form, ip: this.clientIp } : form;
  }

  /** Selects all files so RealDebrid starts the download (it stays in
   * `waiting_files_selection` until files are chosen). */
  private async selectFiles(id: string): Promise<void> {
    await this.request(
      'POST',
      `/torrents/selectFiles/${encodeURIComponent(id)}`,
      {
        files: 'all',
      }
    );
  }

  async addMagnet(magnet: string): Promise<DebridDownload> {
    const added = await this.request<{ id: string }>(
      'POST',
      '/torrents/addMagnet',
      this.withIp({ magnet })
    );
    await this.selectFiles(added.id);
    return this.getMagnet(added.id);
  }

  async addTorrent(torrent: string): Promise<DebridDownload> {
    // `torrent` is a URL to a .torrent file; fetch its bytes and upload.
    // Restrict to http(s) so a crafted URL can't reach other schemes.
    const scheme = (() => {
      try {
        return new URL(torrent).protocol;
      } catch {
        return '';
      }
    })();
    if (scheme !== 'http:' && scheme !== 'https:') {
      throw new DebridError(`Unsupported torrent URL scheme: ${torrent}`, {
        statusCode: 400,
        statusText: 'Bad Request',
        code: 'BAD_REQUEST',
        headers: {},
        body: null,
      });
    }
    const resp = await fetch(torrent);
    if (!resp.ok) {
      throw new DebridError(`Failed to fetch torrent file: ${resp.status}`, {
        statusCode: resp.status,
        statusText: resp.statusText,
        code: 'UNKNOWN',
        headers: {},
        body: null,
        type: 'upstream_error',
      });
    }
    const bytes = Buffer.from(await resp.arrayBuffer());
    const put = await fetch(`${this.baseUrl}/rest/1.0/torrents/addTorrent`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${this.token}` },
      body: bytes,
    });
    const text = await put.text();
    if (!put.ok) {
      throw this.toDebridError(put.status, put.statusText, text);
    }
    const added = JSON.parse(text) as { id: string };
    await this.selectFiles(added.id);
    return this.getMagnet(added.id);
  }

  async getMagnet(magnetId: string): Promise<DebridDownload> {
    const info = await this.request<RdTorrentInfo>(
      'GET',
      `/torrents/info/${encodeURIComponent(magnetId)}`
    );
    logger.debug(`Fetched torrent info for ${magnetId}`, {
      status: info.status,
    });
    return this.mapInfoToDownload(info);
  }

  async listMagnets(): Promise<DebridDownload[]> {
    const list = await this.request<RdTorrentInfo[]>('GET', '/torrents');
    return (list ?? []).map((info) => ({
      ...this.mapInfoToDownload(info),
      library: true,
    }));
  }

  /**
   * A RealDebrid-compatible server has no reliable instant-availability
   * endpoint, so "cached" means the hash is already downloaded in the user's
   * library. Everything else is reported uncached.
   */
  async checkMagnets(magnets: string[]): Promise<DebridDownload[]> {
    const library = await this.listMagnets();
    const downloadedByHash = new Map<string, DebridDownload>();
    for (const item of library) {
      if (item.hash && item.status === 'downloaded') {
        downloadedByHash.set(item.hash.toLowerCase(), item);
      }
    }
    return magnets.map((hash) => {
      const key = hash.toLowerCase();
      const hit = downloadedByHash.get(key);
      if (hit) {
        return { ...hit, status: 'cached' };
      }
      return { id: hash, hash, status: 'unknown' };
    });
  }

  async generateTorrentLink(link: string, clientIp?: string): Promise<string> {
    const result = await this.request<{ download: string }>(
      'POST',
      '/unrestrict/link',
      this.withIp({ link, ...(clientIp ? { ip: clientIp } : {}) })
    );
    if (!result?.download) {
      throw new DebridError('RealDebrid unrestrict returned no download link', {
        statusCode: 502,
        statusText: 'Bad Gateway',
        code: 'BAD_GATEWAY',
        headers: {},
        body: result,
        type: 'upstream_error',
      });
    }
    return result.download;
  }

  async removeMagnet(magnetId: string): Promise<void> {
    await this.request(
      'DELETE',
      `/torrents/delete/${encodeURIComponent(magnetId)}`
    );
  }

  async resolve(
    playbackInfo: PlaybackInfo,
    filename: string,
    cacheAndPlay: boolean,
    autoRemoveDownloads?: boolean,
    signal?: AbortSignal
  ): Promise<string | undefined> {
    if (playbackInfo.type !== 'torrent') {
      throw new DebridError('custom_realdebrid only supports torrents', {
        statusCode: 400,
        statusText: 'Bad Request',
        code: 'NOT_IMPLEMENTED',
        headers: {},
        body: null,
      });
    }

    const cacheKey = buildResolveKey(
      'rd:cache',
      this.serviceName,
      playbackInfo,
      filename,
      this.token,
      this.clientIp
    );
    const { result } = await DistributedLock.getInstance().withLock(
      cacheKey,
      () =>
        this._resolveTorrent(
          playbackInfo,
          filename,
          cacheAndPlay,
          cacheKey,
          autoRemoveDownloads,
          signal
        ),
      { ttl: this.maxWaitTime + 30_000 }
    );
    return result;
  }

  private async _resolveTorrent(
    playbackInfo: PlaybackInfo & { type: 'torrent' },
    filename: string,
    cacheAndPlay: boolean,
    cacheKey: string,
    autoRemoveDownloads?: boolean,
    signal?: AbortSignal
  ): Promise<string | undefined> {
    const { hash, metadata } = playbackInfo;

    const cachedLink = await RealDebridService.playbackLinkCache.get(cacheKey);
    if (cachedLink !== undefined) {
      if (cachedLink === null) {
        if (!cacheAndPlay) return undefined;
      } else {
        return cachedLink;
      }
    }

    await DebridFailureCache.check(this.serviceName, 'torrent', hash);

    let download: DebridDownload;
    if (playbackInfo.serviceItemId) {
      download = await this.getMagnet(playbackInfo.serviceItemId);
    } else {
      let magnet = `magnet:?xt=urn:btih:${hash}`;
      if (playbackInfo.filename) magnet += `&dn=${playbackInfo.filename}`;
      if (playbackInfo.sources.length > 0) {
        magnet += `&tr=${playbackInfo.sources.join('&tr=')}`;
      }
      download = await this.addMagnet(magnet);
    }

    // Drop the magnet if a parallel failover attempt wins the race.
    if (!playbackInfo.serviceItemId) {
      removeDownloadOnAbort(
        signal,
        { id: download.id, private: download.private ?? playbackInfo.private },
        (id) => this.removeMagnet(id),
        (m) => logger.warn(m)
      );
    }

    if (download.status !== 'downloaded') {
      await RealDebridService.playbackLinkCache.set(cacheKey, null, 60);
      if (!cacheAndPlay) return undefined;
      download = await this.pollUntilDownloaded(hash, download, signal);
    }

    if (!download.files?.length) {
      throw new DebridError('No files found for magnet download', {
        statusCode: 400,
        statusText: 'No files found for magnet download',
        code: 'NO_MATCHING_FILE',
        headers: {},
        body: download,
      });
    }

    const file = await this.selectFile(playbackInfo, download, metadata);
    if (!file?.link) {
      throw new DebridError('Selected file was missing a link', {
        statusCode: 400,
        statusText: 'Selected file was missing a link',
        code: 'NO_MATCHING_FILE',
        headers: {},
        body: file,
      });
    }

    const playbackLink = await this.generateTorrentLink(
      file.link,
      this.clientIp
    );
    await RealDebridService.playbackLinkCache.set(
      cacheKey,
      playbackLink,
      appConfig.builtins.debrid.playbackLinkCacheTtl,
      true
    );

    if (autoRemoveDownloads && download.id && !download.private) {
      this.removeMagnet(download.id.toString()).catch((err) => {
        logger.warn(`Failed to cleanup magnet ${download.id}: ${err.message}`);
      });
    }

    return playbackLink;
  }

  private async pollUntilDownloaded(
    hash: string,
    current: DebridDownload,
    signal?: AbortSignal
  ): Promise<DebridDownload> {
    const maxPolls = Math.ceil(this.maxWaitTime / this.pollingInterval);
    for (let i = 0; i < maxPolls; i++) {
      if (signal?.aborted) {
        throw new DebridError('resolve aborted (failover lost)', {
          statusCode: 499,
          statusText: 'Client Closed Request',
          code: 'UNKNOWN',
          headers: {},
          body: null,
        });
      }
      await new Promise((r) => setTimeout(r, this.pollingInterval));
      const list = await this.listMagnets();
      const match = list.find((m) => m.hash === hash);
      if (!match) continue;
      if (match.status === 'downloaded') {
        // Re-fetch full info (list entries omit per-file links).
        return this.getMagnet(match.id.toString());
      }
      if (['failed', 'invalid'].includes(match.status)) {
        const err = new DebridError(`Magnet download ${match.status}`, {
          statusCode: 400,
          statusText: `Magnet download ${match.status}`,
          code: 'UNKNOWN',
          headers: {},
          body: match,
        });
        DebridFailureCache.mark(this.serviceName, 'torrent', hash, err).catch(
          () => {}
        );
        throw err;
      }
    }
    throw new DebridError('Timed out waiting for magnet to download', {
      statusCode: 408,
      statusText: 'Timed out waiting for magnet to download',
      code: 'TIMEOUT',
      headers: {},
      body: null,
    });
  }

  private async selectFile(
    playbackInfo: PlaybackInfo & { type: 'torrent' },
    download: DebridDownload,
    metadata?: TitleMetadata
  ): Promise<DebridFile | undefined> {
    if (playbackInfo.fileIndex !== undefined) {
      const file = download.files?.find(
        (f) => f.index === playbackInfo.fileIndex
      );
      if (!file) {
        throw new DebridError(
          `File with index ${playbackInfo.fileIndex} not found`,
          {
            statusCode: 400,
            statusText: 'File not found',
            code: 'NO_MATCHING_FILE',
            headers: {},
            body: { fileIndex: playbackInfo.fileIndex },
          }
        );
      }
      return file;
    }

    const torrent: Torrent = {
      title: download.name ?? playbackInfo.filename ?? '',
      hash: playbackInfo.hash,
      size: download.size || 0,
      type: 'torrent',
      sources: playbackInfo.sources,
      private: playbackInfo.private,
    };
    const allStrings = [
      download.name ?? '',
      ...(download.files ?? []).map((f) => f.name ?? ''),
    ];
    const parsedFiles = new Map<string, ParsedResult>();
    for (const s of allStrings) parsedFiles.set(s, parseTorrentTitle(s));

    return selectFileInTorrentOrNZB(torrent, download, parsedFiles, metadata, {
      chosenFilename: playbackInfo.filename,
      chosenIndex: playbackInfo.index,
    });
  }
}
