import { Torrent, UnprocessedTorrent, DebridFile } from '../debrid/index.js';
import {
  extractInfoHashFromMagnet,
  validateInfoHash,
  extractTrackersFromMagnet,
} from '../builtins/utils/debrid.js';
import { createLogger } from '../logging/logger.js';
import { GrabCache } from './grab-cache.js';
import { makeRequest } from './http.js';
import parseTorrent, { Instance } from 'parse-torrent';
import { config as appConfig } from '../config/index.js';
import { getTimeTakenSincePoint } from './index.js';
import pLimit from 'p-limit';

const logger = createLogger('torrent');

interface TorrentMetadata {
  hash: string;
  files: DebridFile[];
  sources: string[];
  private?: boolean;
}

/**
 * Grabs torrent metadata (info hash + file list) from a download URL, on the
 * shared {@link GrabCache} primitive — the torrent counterpart of the NZB
 * grabbing in {@link DownloadManager}. Both single-flight + disk-cache by URL;
 * the difference is that torrents are parsed at grab time here (magnet-redirect
 * handling, `parse-torrent`), whereas NZB bodies are parsed later by the usenet
 * engine. This module stays out of the `utils` barrel because that torrent
 * parsing pulls in `debrid`/`builtins` helpers.
 */
export class TorrentGrabber {
  // Grabbed-torrent metadata cache (shares the `<data>/cache` root + dashboard
  // cache page with the NZB grabber). Built lazily so class-init doesn't read config.
  static #cacheImpl: GrabCache<TorrentMetadata> | null = null;
  static get #cache(): GrabCache<TorrentMetadata> {
    if (!this.#cacheImpl) {
      const g = appConfig.builtins.grab;
      this.#cacheImpl = new GrabCache<TorrentMetadata>({
        name: 'grab-torrent',
        maxMemBytes: g.torrentCacheBytes,
        maxDiskBytes: g.torrentDiskCacheBytes,
        serialize: (v) => Buffer.from(JSON.stringify(v), 'utf8'),
        deserialize: (b) => JSON.parse(b.toString('utf8')) as TorrentMetadata,
        sizeOf: (v) => Buffer.byteLength(JSON.stringify(v), 'utf8'),
      });
    }
    return this.#cacheImpl;
  }

  // Limit concurrent requests. Constructed lazily on first use so the
  // module-load class-init doesn't read runtime config.
  static #fetchLimitImpl: ReturnType<typeof pLimit> | null = null;
  static get #fetchLimit(): ReturnType<typeof pLimit> {
    if (!this.#fetchLimitImpl) {
      this.#fetchLimitImpl = pLimit(appConfig.builtins.getTorrent.concurrency);
    }
    return this.#fetchLimitImpl;
  }

  private constructor() {}

  static async getMetadata(
    torrent: UnprocessedTorrent
  ): Promise<TorrentMetadata | undefined> {
    // If we have hash and don't need full metadata, return early
    if (torrent.hash) {
      return {
        hash: torrent.hash,
        files: [], // Empty files array since we don't need metadata
        sources: torrent.sources || [],
      };
    }

    // If we don't have a download URL, we can't proceed
    if (!torrent.downloadUrl) {
      logger.debug(
        `No download URL available for torrent with hash ${torrent.hash}`
      );
      return undefined;
    }

    const cache = this.#cache;
    const url = torrent.downloadUrl;
    const lazy = appConfig.builtins.getTorrent.lazily;

    // Cache hit — done.
    const cached = await cache.cached(url);
    if (cached) return cached;

    // Already fetching this URL: lazy callers bail, eager callers join.
    const inFlight = cache.inFlight(url);
    if (inFlight) return lazy ? undefined : inFlight.catch(() => undefined);

    // Kick off a single-flighted, concurrency-limited grab+parse.
    const fetchPromise = cache.fetch(url, () =>
      this.#fetchLimit(() => this.#fetchMetadata(torrent))
    );

    if (lazy) {
      // Queue the fetch but don't wait for it.
      fetchPromise.catch(() => {});
      return undefined;
    }

    try {
      return await fetchPromise;
    } catch (error: any) {
      logger.warn(`Failed to fetch metadata for ${url}: ${error.message}`);
      if (torrent.hash) {
        // If we have a hash but metadata fetch failed, return basic info
        return {
          hash: torrent.hash,
          files: [],
          sources: torrent.sources || [],
        };
      }
      return undefined;
    }
  }

  static async #fetchMetadata(
    torrent: UnprocessedTorrent,
    redirectCount: number = 0
  ): Promise<TorrentMetadata> {
    const { downloadUrl } = torrent;
    if (!downloadUrl) throw new Error('Download URL must be provided.');

    const timeout = appConfig.builtins.getTorrent.lazily
      ? 30000
      : appConfig.builtins.getTorrent.timeout;
    const start = Date.now();

    const response = await makeRequest(downloadUrl, {
      timeout,
      // User-agent comes from a `[torrent_grabs]` (or per-host) entry in
      // REQUEST_HEADER_OVERRIDES, applied inside makeRequest.
      context: 'torrent_grabs',
      rawOptions: { redirect: 'manual' },
    });

    let metadata: TorrentMetadata;

    if (response.status >= 300 && response.status < 400) {
      const redirectUrl = response.headers.get('Location');
      if (!redirectUrl) throw new Error('Redirect location not found');

      const hash = validateInfoHash(
        extractInfoHashFromMagnet(redirectUrl.toLowerCase())
      );
      if (!hash) {
        if (redirectCount >= 3) {
          throw new Error(`Too many redirects: ${redirectUrl}`);
        }
        logger.debug(
          `Invalid magnet URL in redirect: ${redirectUrl}, retrying...`
        );
        return this.#fetchMetadata(torrent, redirectCount + 1);
      }

      const sources = extractTrackersFromMagnet(redirectUrl);
      logger.debug(
        `Got info for ${downloadUrl} from magnet redirect in ${getTimeTakenSincePoint(start)}`,
        {
          hash,
        }
      );
      metadata = { hash, files: [], sources };
    } else if (response.ok) {
      const bytes = await response.arrayBuffer();

      const parsedTorrent = await (parseTorrent(
        new Uint8Array(bytes)
      ) as unknown as Promise<Instance>);

      const sources = Array.from(
        new Set([...(parsedTorrent.announce || []), ...(torrent.sources || [])])
      );

      if (!validateInfoHash(parsedTorrent.infoHash)) {
        logger.debug(
          `No info hash found in torrent: ${JSON.stringify(parsedTorrent)}`
        );
        metadata = { hash: downloadUrl, files: [], sources, private: false };
        throw new Error('No info hash found in torrent');
      }

      logger.debug(
        `Got info for ${downloadUrl} from downloaded torrent in ${getTimeTakenSincePoint(start)}`,
        {
          hash: parsedTorrent.infoHash,
        }
      );
      metadata = {
        hash: parsedTorrent.infoHash,
        files: ('files' in parsedTorrent ? parsedTorrent.files || [] : []).map(
          (file, index) => ({
            size: file.length,
            id: index,
            name: file.name,
          })
        ),
        sources,
        private: !!parsedTorrent.info?.private,
      };
    } else {
      throw new Error(
        `Failed to fetch metadata: ${response.status} ${response.statusText}`
      );
    }

    // Caching is handled by the GrabCache wrapper on success.
    return metadata;
  }
}
