import { createLogger } from './logger.js';
import SeaDexAPI, { type SeaDexResponse } from '../builtins/seadex/api.js';

const logger = createLogger('seadex');

const seadexApi = new SeaDexAPI();

export interface SeaDexResult {
  bestHashes: Set<string>;
  allHashes: Set<string>;
  bestGroups: Set<string>;
  allGroups: Set<string>;
}

export interface SeaDexTagResult {
  isBest: boolean;
  isSeadex: boolean;
}

/**
 * Get SeaDex info hashes for an anime by AniList ID
 * @param anilistId - The AniList ID of the anime
 * @returns Object containing bestHashes (isBest=true) and allHashes (all SeaDex releases)
 */
export async function getSeaDexInfoHashes(
  anilistId: number
): Promise<SeaDexResult> {
  try {
    const data = await seadexApi.getEntriesByAnilistId(anilistId);
    return processSeaDexResponse(data, anilistId);
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
 * Process SeaDex API response into our result format
 */
function processSeaDexResponse(
  data: SeaDexResponse,
  anilistId: number
): SeaDexResult {
  const items = data.items;

  if (!items || items.length === 0) {
    logger.debug(`No SeaDex entries found for AniList ID ${anilistId}`);
    return {
      bestHashes: new Set(),
      allHashes: new Set(),
      bestGroups: new Set(),
      allGroups: new Set(),
    };
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

      // Collect release groups
      const releaseGroup = torrent.releaseGroup?.toLowerCase();
      if (releaseGroup) {
        allGroups.add(releaseGroup);
        if (torrent.isBest) {
          bestGroups.add(releaseGroup);
        }
      }
    }
  }

  logger.info(
    `Found ${bestHashes.size} best hashes, ${allHashes.size} total hashes, ${bestGroups.size} best groups, ${allGroups.size} total groups for AniList ID ${anilistId}`
  );

  return {
    bestHashes,
    allHashes,
    bestGroups,
    allGroups,
  };
}

export default getSeaDexInfoHashes;
