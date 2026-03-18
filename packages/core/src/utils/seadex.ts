import { createLogger } from './logger.js';
import { SeaDexDataset } from '../builtins/seadex/dataset.js';

const logger = createLogger('seadex');

const seadexDataset = SeaDexDataset.getInstance();

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
    await seadexDataset.initialise();

    const torrents = seadexDataset.getTorrents(anilistId);

    const bestHashes = new Set<string>();
    const allHashes = new Set<string>();
    const bestGroups = new Set<string>();
    const allGroups = new Set<string>();

    for (const torrent of torrents) {
      const infoHash = torrent.infoHash;

      if (!infoHash || infoHash.includes('<redacted>') || infoHash === '') {
        continue;
      }

      allHashes.add(infoHash);

      if (torrent.isBest) {
        bestHashes.add(infoHash);
      }

      const releaseGroup = torrent.releaseGroup?.toLowerCase();
      if (releaseGroup) {
        allGroups.add(releaseGroup);
        if (torrent.isBest) {
          bestGroups.add(releaseGroup);
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

export default getSeaDexInfoHashes;
