import { Torrent, UnprocessedTorrent, DebridFile } from '../debrid/index.js';
import {
  extractInfoHashFromMagnet,
  extractTrackersFromMagnet,
} from '../builtins/utils/debrid.js';
import { createLogger } from './logger.js';
import { Cache } from './cache.js';
// import { makeRequest } from './http.js';
import { fetch } from 'undici';
import parseTorrent from 'parse-torrent';
import { Env } from './env.js';
import { getTimeTakenSincePoint } from './index.js';

const logger = createLogger('torrent');

interface TorrentMetadata {
  hash: string;
  files: DebridFile[];
  sources: string[];
}

export class TorrentClient {
  static readonly #metadataCache = Cache.getInstance<string, TorrentMetadata>(
    'torrent-metadata'
  );

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

    // Try to get from cache if we have a download URL
    if (torrent.downloadUrl) {
      const cachedMetadata = await this.#metadataCache.get(torrent.downloadUrl);
      if (cachedMetadata) {
        return cachedMetadata;
      }
    }

    try {
      const metadata = await this.#fetchMetadata(torrent);
      return metadata;
    } catch (error) {
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
    torrent: UnprocessedTorrent
  ): Promise<TorrentMetadata> {
    if (!torrent.downloadUrl) {
      throw new Error('Download URL must be provided');
    }

    try {
      const start = Date.now();
      const response = await fetch(torrent.downloadUrl!, {
        signal: AbortSignal.timeout(Env.BUILTIN_GET_TORRENT_TIMEOUT),
        redirect: 'manual',
      });

      let metadata: TorrentMetadata;

      // Handle redirects
      if (response.status === 302 || response.status === 301) {
        const redirectUrl = response.headers.get('Location');
        if (!redirectUrl) {
          throw new Error('Redirect location not found');
        }

        const hash = extractInfoHashFromMagnet(redirectUrl);
        const sources = extractTrackersFromMagnet(redirectUrl);
        if (!hash) throw new Error('Invalid magnet URL');

        logger.debug(`Got info from magnet redirect`, {
          hash,
          sources,
          time: getTimeTakenSincePoint(start),
        });
        metadata = {
          hash,
          files: [],
          sources,
        };
      } else {
        if (!response.ok) {
          throw new Error(
            `Failed to fetch metadata for torrent: ${response.status} ${response.statusText}`
          );
        }

        const bytes = await response.arrayBuffer();
        const parsedTorrent = parseTorrent(new Uint8Array(bytes));
        const sources = Array.from(
          new Set([
            ...(parsedTorrent.announce || []),
            ...(torrent.sources || []),
          ])
        );

        logger.debug(`Got info from downloaded torrent.`, {
          hash: parsedTorrent.infoHash,
          sources,
          time: getTimeTakenSincePoint(start),
        });

        metadata = {
          hash: parsedTorrent.infoHash,
          files: (parsedTorrent.files || []).map((file, index) => ({
            size: file.length,
            id: index,
            name: file.name,
          })),
          sources,
        };
      }

      // Cache the result
      if (torrent.downloadUrl) {
        await this.#metadataCache.set(
          torrent.downloadUrl,
          metadata,
          Env.BUILTIN_TORRENT_METADATA_CACHE_TTL
        );
      }

      return metadata;
    } catch (error) {
      // if (error instanceof Error && error.name === 'TimeoutError') {
      //   throw new Error('Timeout fetching metadata for torrent');
      // }
      logger.warn(`Failed to get magnet from ${torrent.downloadUrl}: ${error}`);
      throw error;
    }
  }
}
