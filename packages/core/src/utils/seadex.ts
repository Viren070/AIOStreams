import { createLogger } from './logger.js';
import { Cache } from './cache.js';
import { makeRequest } from './http.js';
import { Env } from './env.js';

const logger = createLogger('seadex');

const SEADEX_API_BASE = 'https://releases.moe/api/collections/entries/records';

const SEADEX_CACHE_TTL = 60 * 60;

// Cache SeaDex results for 1 hour
const seadexCache = Cache.getInstance<string, SeaDexResult>(
  'seadex',
  SEADEX_CACHE_TTL * 1000,
  'memory'
);

export interface SeaDexResult {
  bestHashes: Set<string>;
  allHashes: Set<string>;
  bestGroups: Set<string>;
  allGroups: Set<string>;
}

interface SeaDexTorrent {
  infoHash: string;
  isBest: boolean;
  releaseGroup?: string;
}

interface SeaDexEntry {
  expand?: {
    trs?: SeaDexTorrent[];
  };
}

interface SeaDexResponse {
  items?: SeaDexEntry[];
}

/**
 * SeaDex API Client
 * Fetches "best" release info from https://releases.moe/
 *
 * SeaDex is a curated database of the best anime releases.
 * - "Best" releases are marked with isBest=true
 * - Other releases on SeaDex are still quality releases, just not the absolute best
 * - Redacted hashes (containing "<redacted>") are excluded
 */
export class SeaDexApi {
  /**
   * Get SeaDex info hashes for an anime by AniList ID
   * @param anilistId - The AniList ID of the anime
   * @returns Object containing bestHashes (isBest=true) and allHashes (all SeaDex releases)
   */
  static async getInfoHashesForAnime(anilistId: number): Promise<SeaDexResult> {
    const cacheKey = `anilist-${anilistId}`;
    const cached = await seadexCache.get(cacheKey);
    if (cached) {
      logger.debug(`SeaDex cache hit for AniList ID ${anilistId}`);
      return cached;
    }

    try {
      const url = `${SEADEX_API_BASE}?expand=trs&filter=alID=${anilistId}&sort=-trs.isBest`;

      logger.debug(`Fetching SeaDex data for AniList ID ${anilistId}`);

      const response = await makeRequest(url, {
        method: 'GET',
        timeout: 10000,
        headers: {
          Accept: 'application/json',
          'User-Agent': Env.DEFAULT_USER_AGENT,
        },
      });

      if (!response.ok) {
        logger.warn(
          `SeaDex API returned ${response.status} for AniList ID ${anilistId}`
        );
        return {
          bestHashes: new Set(),
          allHashes: new Set(),
          bestGroups: new Set(),
          allGroups: new Set(),
        };
      }

      const data = (await response.json()) as SeaDexResponse;
      const items = data?.items;

      if (!items || items.length === 0) {
        logger.debug(`No SeaDex entries found for AniList ID ${anilistId}`);
        const emptyResult: SeaDexResult = {
          bestHashes: new Set(),
          allHashes: new Set(),
          bestGroups: new Set(),
          allGroups: new Set(),
        };
        await seadexCache.set(cacheKey, emptyResult, SEADEX_CACHE_TTL);
        return emptyResult;
      }

      const bestHashes = new Set<string>();
      const allHashes = new Set<string>();
      const bestGroups = new Set<string>();
      const allGroups = new Set<string>();

      for (const item of items) {
        const trsArray = item.expand?.trs;
        if (!trsArray) continue;

        for (const torrent of trsArray) {
          const infoHash = torrent.infoHash?.toLowerCase();

          // Skip empty or redacted hashes
          if (!infoHash || infoHash.includes('<redacted>') || infoHash === '') {
            continue;
          }

          allHashes.add(infoHash);

          if (torrent.isBest) {
            bestHashes.add(infoHash);
          }
        }

        // Collect release groups
        for (const torrent of trsArray) {
          const releaseGroup = torrent.releaseGroup?.toLowerCase();
          if (!releaseGroup) continue;

          allGroups.add(releaseGroup);
          if (torrent.isBest) {
            bestGroups.add(releaseGroup);
          }
        }
      }

      logger.info(
        `Found ${bestHashes.size} best hashes, ${allHashes.size} total hashes, ${bestGroups.size} best groups, ${allGroups.size} total groups for AniList ID ${anilistId}`
      );

      const result: SeaDexResult = { bestHashes, allHashes, bestGroups, allGroups };
      await seadexCache.set(cacheKey, result, SEADEX_CACHE_TTL);
      return result;
    } catch (error) {
      logger.error(
        `Failed to fetch SeaDex data for AniList ID ${anilistId}:`,
        error instanceof Error ? error.message : String(error)
      );
      return {
        bestHashes: new Set(),
        allHashes: new Set(),
        bestGroups: new Set(),
        allGroups: new Set(),
      };
    }
  }

  /**
   * Check if an infoHash is a SeaDex "best" release
   */
  static isSeadexBest(infoHash: string, seadexResult: SeaDexResult): boolean {
    return seadexResult.bestHashes.has(infoHash.toLowerCase());
  }

  /**
   * Check if an infoHash is on SeaDex (best or regular)
   */
  static isOnSeadex(infoHash: string, seadexResult: SeaDexResult): boolean {
    return seadexResult.allHashes.has(infoHash.toLowerCase());
  }
}

export default SeaDexApi;
