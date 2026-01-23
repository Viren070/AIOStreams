import { Torrent, UnprocessedTorrent, DebridFile } from '../debrid/index.js';
import {
  extractInfoHashFromMagnet,
  validateInfoHash,
  extractTrackersFromMagnet,
} from '../builtins/utils/debrid.js';
import { createLogger } from './logger.js';
import { Cache } from './cache.js';
// import { makeRequest } from './http.js';
import { fetch } from 'undici';
import parseTorrent, { Instance } from 'parse-torrent';
import { Env } from './env.js';
import { getTimeTakenSincePoint } from './index.js';
import pLimit from 'p-limit';

const logger = createLogger('torrent');

interface TorrentMetadata {
  hash: string;
  files: DebridFile[];
  sources: string[];
  private: boolean;
}

export class TorrentClient {
  static readonly #metadataCache = Cache.getInstance<string, TorrentMetadata>(
    'torrent-metadata',
    undefined,
    Env.REDIS_URI ? 'redis' : 'sql'
  );

  // Track in-progress fetches to avoid duplicate requests
  static readonly #inProgressFetches = new Map<
    string,
    Promise<TorrentMetadata | undefined>
  >();

  // Limit concurrent requests
  static readonly #fetchLimit = pLimit(Env.BUILTIN_GET_TORRENT_CONCURRENCY);

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
        private: false,
      };
    }

    // If we don't have a download URL, we can't proceed
    if (!torrent.downloadUrl) {
      logger.debug(
        `No download URL available for torrent with hash ${torrent.hash}`
      );
      return undefined;
    }

    // Try to get from cache if we have a download URL

    const cachedMetadata = await this.#metadataCache.get(torrent.downloadUrl);
    if (cachedMetadata) {
      return cachedMetadata;
    }

    // Check if there's already a fetch in progress for this URL
    const inProgressFetch = this.#inProgressFetches.get(torrent.downloadUrl);
    if (inProgressFetch) {
      if (Env.BUILTIN_GET_TORRENT_LAZILY) {
        return undefined;
      }
      return inProgressFetch;
    }

    const fetchTask = async () => {
      try {
        const metadata = await this.#fetchMetadata(torrent);
        // On success, clean up the in-progress fetch.
        return metadata;
      } catch (error: any) {
        // On failure, log the error and clean up.
        logger.warn(
          `Failed to fetch metadata for ${torrent.downloadUrl}: ${error.message}`
        );
        return undefined;
      } finally {
        this.#inProgressFetches.delete(torrent.downloadUrl!);
      }
    };

    // Create a new fetch promise with concurrency limit
    const fetchPromise = this.#fetchLimit(fetchTask);
    this.#inProgressFetches.set(torrent.downloadUrl!, fetchPromise);

    if (Env.BUILTIN_GET_TORRENT_LAZILY) {
      // Queue the fetch but don't wait for it
      fetchPromise.catch(() => {});
      return undefined;
    }

    // Wait for the fetch if not lazy loading
    try {
      return await fetchPromise;
    } catch (error) {
      if (torrent.hash) {
        // If we have a hash but metadata fetch failed, return basic info
        return {
          hash: torrent.hash,
          files: [],
          sources: torrent.sources || [],
          private: false,
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

    const timeout = Env.BUILTIN_GET_TORRENT_LAZILY
      ? 30000
      : Env.BUILTIN_GET_TORRENT_TIMEOUT;
    const start = Date.now();

    const response = await fetch(downloadUrl, {
      signal: AbortSignal.timeout(timeout),
      redirect: 'manual',
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
      metadata = { hash, files: [], sources, private: false };
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

    await this.#metadataCache.set(
      downloadUrl,
      metadata,
      Env.BUILTIN_TORRENT_METADATA_CACHE_TTL
    );
    return metadata;
  }
}
