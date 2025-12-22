import { z } from 'zod';
import {
  Env,
  ServiceId,
  createLogger,
  getSimpleTextHash,
  Cache,
  DistributedLock,
} from '../utils/index.js';
import { selectFileInTorrentOrNZB, Torrent } from './utils.js';
import {
  DebridService,
  DebridServiceConfig,
  DebridDownload,
  PlaybackInfo,
  DebridError,
} from './base.js';
import { parseTorrentTitle } from '@viren070/parse-torrent-title';
// import { fetch } from 'undici'; // Use global fetch if available in Node 18+, otherwise keep this

const logger = createLogger('debrid:torrserver');

// Constants for TorrServer operations
const TORRSERVER_ADD_DELAY_MS = 1000;
const TORRSERVER_MAX_POLL_ATTEMPTS = 15;
const TORRSERVER_POLL_INTERVAL_MS = 1000; // Poll faster for responsiveness

export const TorrServerConfig = z.object({
  torrserverUrl: z
    .string()
    .url()
    .transform((s) => s.trim().replace(/\/+$/, '')),
  torrserverAuth: z.string().optional(),
});

interface TorrServerTorrent {
  hash: string;
  title?: string;
  size?: number;
  stat?: number; // 0 - stopped, 1 - downloading, 2 - seeding
  file_stats?: Array<{
    id: number;
    path: string;
    length: number;
  }>;
}

interface TorrServerListResponse {
  torrents: TorrServerTorrent[];
}

interface TorrServerAddResponse {
  hash: string;
}

export class TorrServerDebridService implements DebridService {
  private readonly torrserverUrl: string;
  private readonly torrserverAuth?: string;
  private static playbackLinkCache = Cache.getInstance<string, string | null>(
    'ts:link'
  );
  private static checkCache = Cache.getInstance<string, DebridDownload>(
    'ts:instant-check'
  );

  readonly supportsUsenet = false;
  readonly serviceName: ServiceId = 'torrserver' as ServiceId;

  constructor(private readonly config: DebridServiceConfig) {
    let tokenData: any;
    try {
      tokenData = JSON.parse(config.token);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Invalid TorrServer token JSON: ${errorMessage}`
      );
    }

    const parsedConfig = TorrServerConfig.parse(tokenData);

    this.torrserverUrl = parsedConfig.torrserverUrl;
    this.torrserverAuth = parsedConfig.torrserverAuth;
  }

  private addApiKeyToUrl(url: URL): void {
    if (this.torrserverAuth && !this.torrserverAuth.includes(':')) {
      const trimmedKey = this.torrserverAuth.trim();
      if (trimmedKey !== '') {
        url.searchParams.set('apikey', trimmedKey);
      }
    }
  }

  private addAuthToStreamUrl(url: URL): void {
    if (!this.torrserverAuth) return;

    const trimmedAuth = this.torrserverAuth.trim();
    if (trimmedAuth === '') return;

    if (trimmedAuth.includes(':')) {
      // Basic auth credentials (username:password) - add to URL
      // Handle passwords that may contain colons by only splitting on the first colon
      const colonIndex = trimmedAuth.indexOf(':');
      const username = trimmedAuth.substring(0, colonIndex);
      const password = trimmedAuth.substring(colonIndex + 1);
      url.username = username;
      url.password = password;
    } else {
      // API key - add as query parameter
      url.searchParams.set('apikey', trimmedAuth);
    }
  }

  private async torrserverRequest<T>(
    endpoint: string,
    options?: {
      method?: string;
      body?: any;
    }
  ): Promise<T> {
    const url = `${this.torrserverUrl}${endpoint}`;
    const method = options?.method || 'GET';

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add Auth headers for API control
      if (this.torrserverAuth && this.torrserverAuth.includes(':')) {
        // Only set Basic auth header for username:password format
        headers['Authorization'] =
          `Basic ${Buffer.from(this.torrserverAuth).toString('base64')}`;
      }

      // Append API Key to URL if it's not Basic Auth style
      const fetchUrl = new URL(url);
      this.addApiKeyToUrl(fetchUrl);

      const response = await fetch(fetchUrl.toString(), {
        method,
        body: options?.body ? JSON.stringify(options.body) : undefined,
        headers,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (error: any) {
      throw new DebridError('TorrServer request failed', {
        statusCode: error?.statusCode || 500,
        statusText: error?.message || 'Unknown error',
        code: 'INTERNAL_SERVER_ERROR',
        headers: {},
        body: error,
        cause: error,
      });
    }
  }

  public async listMagnets(): Promise<DebridDownload[]> {
    try {
      // POST usually works better for /torrents/list in some versions, but GET /torrents is standard
      const response = await this.torrserverRequest<any>('/torrents');

      // Handle response structure which might vary slightly
      const torrents = Array.isArray(response)
        ? response
        : response.torrents || [];

      return (
        torrents.map((torrent: TorrServerTorrent) => ({
          id: torrent.hash,
          hash: torrent.hash,
          name: torrent.title,
          size: torrent.size,
          status: this.mapTorrServerStatus(torrent.stat),
          files: torrent.file_stats?.map((file) => ({
            index: file.id,
            name: file.path,
            size: file.length,
          })),
        })) || []
      );
    } catch (error) {
      logger.error('Failed to list torrents from TorrServer:', error);
      return [];
    }
  }

  private mapTorrServerStatus(stat?: number): DebridDownload['status'] {
    switch (stat) {
      case 0: // Loaded/Paused
      case 1: // Downloading
      case 2: // Seeding/Up
        // IMPORTANT: We treat downloading (1) as 'cached' because TorrServer allows streaming while downloading.
        // If we return 'downloading', AIOStreams might wait for 100% completion.
        return 'cached';
      default:
        return 'unknown';
    }
  }

  public async checkMagnets(
    magnets: string[],
    sid?: string
  ): Promise<DebridDownload[]> {
    // TorrServer streams "instantly", so we can assume availability for valid magnets
    // Real logic would be checking if we have bandwidth, but here we just pass them through.
    const results: DebridDownload[] = [];

    for (const magnet of magnets) {
      const hash = this.extractHashFromMagnet(magnet);
      if (!hash) continue;

      results.push({
        id: hash,
        hash,
        status: 'cached', // Assume cached to trigger "instant play" logic
        files: [],
      });
    }
    return results;
  }

  private extractHashFromMagnet(magnet: string): string | null {
    const match = magnet.match(/btih:([a-fA-F0-9]{40})/i);
    return match ? match[1].toLowerCase() : null;
  }

  public async addMagnet(magnet: string): Promise<DebridDownload> {
    try {
      const hash = this.extractHashFromMagnet(magnet);
      if (!hash) {
        throw new DebridError('Invalid magnet link', {
          statusCode: 400,
          statusText: 'Invalid magnet link',
          code: 'BAD_REQUEST',
          headers: {},
        });
      }

      // Add torrent to TorrServer
      await this.torrserverRequest<TorrServerAddResponse>('/torrents/add', {
        method: 'POST',
        body: {
          link: magnet,
          title: hash,
          save: true, // Auto save to history
        },
      });

      await new Promise((resolve) =>
        setTimeout(resolve, TORRSERVER_ADD_DELAY_MS)
      );

      // Get torrent info
      const torrents = await this.listMagnets();
      const torrent = torrents.find((t) => t.hash === hash);

      // Even if not found immediately (rare race condition), return a dummy valid object
      if (!torrent) {
        return {
          id: hash,
          hash: hash,
          status: 'cached',
          files: [],
        };
      }

      return torrent;
    } catch (error) {
      if (error instanceof DebridError) {
        throw error;
      }
      throw new DebridError('Failed to add magnet to TorrServer', {
        statusCode: 500,
        statusText: error instanceof Error ? error.message : 'Unknown error',
        code: 'INTERNAL_SERVER_ERROR',
        headers: {},
        cause: error,
      });
    }
  }

  public async generateTorrentLink(
    link: string,
    clientIp?: string
  ): Promise<string> {
    return link;
  }

  public async resolve(
    playbackInfo: PlaybackInfo,
    filename: string,
    cacheAndPlay: boolean
  ): Promise<string | undefined> {
    const { result } = await DistributedLock.getInstance().withLock(
      `torrserver:resolve:${playbackInfo.hash}:${this.config.clientIp}`,
      () => this._resolve(playbackInfo, filename, cacheAndPlay),
      {
        timeout: 30000,
        ttl: 10000,
      }
    );
    return result;
  }

  private async _resolve(
    playbackInfo: PlaybackInfo,
    filename: string,
    cacheAndPlay: boolean
  ): Promise<string | undefined> {
    if (playbackInfo.type === 'usenet') return undefined;

    const { hash, metadata } = playbackInfo;
    const cacheKey = `torrserver:resolve:${hash}:${filename}`;

    // Check Cache first
    const cachedLink =
      await TorrServerDebridService.playbackLinkCache.get(cacheKey);
    if (cachedLink) return cachedLink;

    let magnet = `magnet:?xt=urn:btih:${hash}`;
    if (playbackInfo.sources.length > 0) {
      magnet += `&tr=${playbackInfo.sources.map(encodeURIComponent).join('&tr=')}`;
    }

    // Add to TorrServer
    let magnetDownload = await this.addMagnet(magnet);

    // Poll until files are populated
    for (let i = 0; i < TORRSERVER_MAX_POLL_ATTEMPTS; i++) {
      if (magnetDownload.files && magnetDownload.files.length > 0) break;

      await new Promise((resolve) =>
        setTimeout(resolve, TORRSERVER_POLL_INTERVAL_MS)
      );
      const list = await this.listMagnets();
      const found = list.find((t) => t.hash === hash);
      if (found) magnetDownload = found;
    }

    if (!magnetDownload.files?.length) {
      // Fallback: If we can't get file list, we can't select file index.
      // However, we can try to return a link without index and let TorrServer guess/play first file
      logger.warn(`No files found for ${hash}, trying blind stream`);
    }

    // Select file logic
    const parsedFiles = new Map<string, any>();
    if (magnetDownload.files) {
      for (const file of magnetDownload.files) {
        if (!file.name) continue;
        try {
          const parsed = parseTorrentTitle(file.name);
          parsedFiles.set(file.name, {
            title: parsed?.title,
            seasons: parsed?.seasons,
            episodes: parsed?.episodes,
            year: parsed?.year,
          });
        } catch (err) {
          logger.debug(
            `Failed to parse torrent title for file: ${file.name}`,
            err
          );
          // Continue processing other files; treat this file as unparsed
          continue;
        }
      }
    }

    const selectedFile = await selectFileInTorrentOrNZB(
      {
        type: 'torrent',
        hash,
        title: magnetDownload.name || filename,
        size: magnetDownload.size || 0,
        seeders: 1,
        sources: [],
      },
      magnetDownload,
      parsedFiles,
      metadata,
      {
        chosenFilename: playbackInfo.filename,
        chosenIndex: playbackInfo.index,
      }
    );

    // Build Stream URL
    const streamUrlObj = new URL('/stream', this.torrserverUrl);
    streamUrlObj.searchParams.set('link', hash); // Use hash instead of full magnet
    streamUrlObj.searchParams.set('play', '1'); // Force play
    streamUrlObj.searchParams.set('save', 'true'); // Save to DB

    if (selectedFile) {
      streamUrlObj.searchParams.set('index', String(selectedFile.index));
    } else {
      streamUrlObj.searchParams.set('index', '0'); // Default to 0 for 0-based indexing
    }

    // AUTH HANDLING FOR STREAM LINK - supports both API keys and Basic auth
    this.addAuthToStreamUrl(streamUrlObj);

    const streamUrl = streamUrlObj.toString();

    await TorrServerDebridService.playbackLinkCache.set(
      cacheKey,
      streamUrl,
      Env.BUILTIN_DEBRID_PLAYBACK_LINK_CACHE_TTL
    );

    return streamUrl;
  }
}
