import { ParsedId, BuiltinServiceId, createLogger } from '../../utils/index.js';
import {
  NZB,
  UnprocessedTorrent,
  DebridDownload,
  getDebridService,
  isTorrentDebridService,
  isUsenetDebridService,
} from '../../debrid/index.js';
import { titleMatch, cleanTitle, preprocessTitle } from '../../parser/utils.js';
import { parseTorrentTitle } from '@viren070/parse-torrent-title';
import { SearchMetadata } from '../base/debrid.js';

const logger = createLogger('library:matching');

const TITLE_MATCH_THRESHOLD = 0.85;

/**
 * Matches title-based criteria against a download item name.
 */
export function isItemMatch(
  itemName: string,
  metadata: SearchMetadata,
  parsedId: ParsedId
): boolean {
  const parsed = parseTorrentTitle(itemName);
  const preprocessedTitle = preprocessTitle(
    parsed.title ?? '',
    itemName,
    metadata.titles
  );

  // Title match
  const cleanedTitles = metadata.titles.map(cleanTitle);
  if (
    !titleMatch(cleanTitle(preprocessedTitle), cleanedTitles, {
      threshold: TITLE_MATCH_THRESHOLD,
    })
  ) {
    return false;
  }

  // For series, check season/episode matching
  if (parsedId.mediaType === 'series') {
    const season = parsedId.season ? Number(parsedId.season) : undefined;
    const episode = parsedId.episode ? Number(parsedId.episode) : undefined;

    // If the item has season info, check it matches
    if (parsed.seasons && parsed.seasons.length > 0 && season !== undefined) {
      if (!parsed.seasons.includes(season)) {
        return false;
      }
    }

    // If we need a specific episode, verify it's a season pack or has the right episode
    // Season packs (no episode info) are valid matches for any episode in that season
    if (
      episode !== undefined &&
      parsed.episodes &&
      parsed.episodes.length > 0
    ) {
      const absoluteEpisode = metadata.absoluteEpisode;
      const relativeAbsoluteEpisode = metadata.relativeAbsoluteEpisode;
      const hasMatchingEpisode =
        parsed.episodes.includes(episode) ||
        (absoluteEpisode !== undefined &&
          parsed.episodes.includes(absoluteEpisode)) ||
        (relativeAbsoluteEpisode !== undefined &&
          parsed.episodes.includes(relativeAbsoluteEpisode));

      if (!hasMatchingEpisode) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Matches debrid download items against metadata to find matching torrents.
 */
export function matchTorrents(
  items: DebridDownload[],
  metadata: SearchMetadata,
  parsedId: ParsedId
): UnprocessedTorrent[] {
  const results: UnprocessedTorrent[] = [];

  for (const item of items) {
    if (!item.name || !item.hash) continue;
    if (item.status !== 'cached' && item.status !== 'downloaded') continue;

    if (!isItemMatch(item.name, metadata, parsedId)) continue;

    results.push({
      type: 'torrent',
      hash: item.hash,
      sources: [],
      title: item.name,
      size: item.size ?? 0,
      confirmed: true,
    });
  }

  return results;
}

/**
 * Matches debrid download items against metadata to find matching NZBs.
 */
export function matchNzbs(
  items: DebridDownload[],
  metadata: SearchMetadata,
  parsedId: ParsedId
): NZB[] {
  const results: NZB[] = [];

  for (const item of items) {
    if (!item.name) continue;
    if (item.status !== 'cached' && item.status !== 'downloaded') continue;

    if (!isItemMatch(item.name, metadata, parsedId)) continue;

    results.push({
      type: 'usenet',
      hash: item.hash ?? item.name,
      nzb: '', // no NZB data needed — item is already on account
      title: item.name,
      size: item.size ?? 0,
      library: true,
      confirmed: true,
    });
  }

  return results;
}

/**
 * Searches for matching torrents across all configured torrent-capable services.
 */
export async function searchTorrents(
  services: { id: BuiltinServiceId; credential: string }[],
  metadata: SearchMetadata,
  parsedId: ParsedId,
  clientIp?: string
): Promise<UnprocessedTorrent[]> {
  const servicePromises = services.map(async (service) => {
    try {
      const debridService = getDebridService(
        service.id,
        service.credential,
        clientIp
      );
      if (!isTorrentDebridService(debridService)) return [];
      const items = await debridService.listMagnets();
      return matchTorrents(items, metadata, parsedId);
    } catch (error) {
      logger.warn(`Failed to list magnets from ${service.id}`, {
        error: (error as Error).message,
      });
      return [];
    }
  });

  const results = await Promise.all(servicePromises);
  const allTorrents = results.flat();

  // Deduplicate by hash
  const seen = new Set<string>();
  return allTorrents.filter((t) => {
    if (!t.hash) return true;
    if (seen.has(t.hash)) return false;
    seen.add(t.hash);
    return true;
  });
}

/**
 * Searches for matching NZBs across all configured NZB-capable services.
 */
export async function searchNzbs(
  services: { id: BuiltinServiceId; credential: string }[],
  metadata: SearchMetadata,
  parsedId: ParsedId,
  clientIp?: string
): Promise<NZB[]> {
  const servicePromises = services.map(async (service) => {
    try {
      const debridService = getDebridService(
        service.id,
        service.credential,
        clientIp
      );
      if (!isUsenetDebridService(debridService) || !debridService.listNzbs)
        return [];
      const items = await debridService.listNzbs();
      return matchNzbs(items, metadata, parsedId);
    } catch (error) {
      logger.warn(`Failed to list NZBs from ${service.id}`, {
        error: (error as Error).message,
      });
      return [];
    }
  });

  const results = await Promise.all(servicePromises);
  const allNzbs = results.flat();

  // Deduplicate by hash
  const seen = new Set<string>();
  return allNzbs.filter((n) => {
    if (seen.has(n.hash)) return false;
    seen.add(n.hash);
    return true;
  });
}
