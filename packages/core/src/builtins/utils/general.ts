import { Logger } from 'winston';
import { Cache } from '../../utils/cache.js';
import { Env } from '../../utils/env.js';
import { createLogger } from '../../utils/index.js';
import pLimit from 'p-limit';

const logger = createLogger('builtin:scrape');

export const createQueryLimit = () =>
  pLimit(Env.BUILTIN_SCRAPE_QUERY_CONCURRENCY);

export function calculateAbsoluteEpisode(
  season: string,
  episode: string,
  seasons: { number: string; episodes: number }[]
): string {
  const episodeNumber = Number(episode);
  let totalEpisodesBeforeSeason = 0;

  for (const s of seasons.filter((s) => s.number !== '0')) {
    if (s.number === season) break;
    totalEpisodesBeforeSeason += s.episodes;
  }

  return (totalEpisodesBeforeSeason + episodeNumber).toString();
}

/**
 * Determines whether to use all titles for scraping based on the environment variable.
 * @deprecated Use getTitleLanguagesForUrl instead.
 */
function useAllTitles(url: string): boolean {
  if (Array.isArray(Env.BUILTIN_SCRAPE_WITH_ALL_TITLES)) {
    return Env.BUILTIN_SCRAPE_WITH_ALL_TITLES.includes(new URL(url).hostname);
  }
  return !!Env.BUILTIN_SCRAPE_WITH_ALL_TITLES;
}

/**
 * Extracts indexer name(s) from a URL using known aggregator URL patterns:
 *   - Jackett:   /api/v2.0/indexers/<name>/results/torznab/...
 *   - NZBHydra2: ?indexers=<name1>,<name2>,...
 *
 * Returns an array of lowercase indexer names, or an empty array if none found.
 */
function extractIndexerNames(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }

  // Jackett: /api/v2.0/indexers/<name>/results/...
  const jackettMatch = parsed.pathname.match(
    /\/api\/v2\.0\/indexers\/([^/]+)\/results\//i
  );
  if (jackettMatch) {
    return [decodeURIComponent(jackettMatch[1]).toLowerCase()];
  }

  // NZBHydra2: ?indexers=name1,name2,...
  const indexersParam = parsed.searchParams.get('indexers');
  if (indexersParam) {
    return indexersParam
      .split(',')
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean);
  }

  return [];
}

/**
 * Returns the list of title language specs to use when building scrape queries
 * for the given URL. Consults BUILTIN_SCRAPE_TITLE_LANGUAGES first (new system),
 * then falls back to BUILTIN_SCRAPE_WITH_ALL_TITLES (legacy).
 *
 * Returned specs are resolved in buildQueries:
 *   - `default`  – primary (service-level) title
 *   - `all`      – all titles up to BUILTIN_SCRAPE_TITLE_LIMIT
 *   - `original` – TMDB original-language titles
 *   - ISO 639-1  – titles tagged with that language (e.g. 'de', 'fr')
 *
 * Match priority (highest first):
 *   exact hostname > indexer name (Jackett/Hydra) > addon ID > wildcard (*)
 *
 * @param url - The URL whose hostname is matched against the config.
 * @param addonId - Optional addon ID (e.g. 'newznab', 'knaben') checked after indexer names, before wildcard.
 */
export function getTitleLanguagesForUrl(
  url: string,
  addonId?: string
): string[] {
  const config = Env.BUILTIN_SCRAPE_TITLE_LANGUAGES as
    | Record<string, string[]>
    | undefined;

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = url;
  }

  let specs: string[] | undefined;
  let source: string;

  if (config !== undefined) {
    if (config[hostname]?.length) {
      specs = config[hostname];
      source = 'hostname match';
    } else {
      const indexerNames = extractIndexerNames(url);
      const matchedIndexer = indexerNames.find((n) => config[n]?.length);
      if (matchedIndexer) {
        specs = config[matchedIndexer];
        source = `indexer name match (${matchedIndexer})`;
      } else if (addonId && config[addonId]?.length) {
        specs = config[addonId];
        source = 'addon ID match';
      } else if (config['*']?.length) {
        specs = config['*'];
        source = 'wildcard (*)';
      } else {
        source = 'legacy fallback (no matching entry)';
      }
    }
  } else {
    source = 'legacy fallback (BUILTIN_SCRAPE_TITLE_LANGUAGES not set)';
  }

  if (!specs) {
    specs = useAllTitles(url) ? ['all'] : ['default'];
  }

  logger.debug(`Title language spec resolved`, {
    hostname,
    addonId,
    specs,
    source,
  });

  return specs;
}

export const bgRefreshCache = Cache.getInstance<string, number>(
  'builtins:bg-refresh'
);

/**
 * Options for the searchWithBackgroundRefresh function
 */
interface SearchWithBgRefreshOptions<T> {
  searchCache: Cache<string, T>;
  searchCacheKey: string;
  bgCacheKey: string;
  cacheTTL: number;
  fetchFn: () => Promise<T>;
  isEmptyResult: (result: T) => boolean;
  logger: Logger;
}

/**
 * Performs a cached search with background refresh support.
 *
 * When a cached result exists:
 * - Returns the cached result immediately
 * - Schedules a background refresh if the minimum interval has passed
 *
 * When no cached result exists:
 * - Performs the search synchronously
 * - Caches the result (unless empty)
 * - Records the refresh timestamp
 *
 * @param options - Configuration options for the search
 * @returns The search result (cached or fresh)
 */
export async function searchWithBackgroundRefresh<T>(
  options: SearchWithBgRefreshOptions<T>
): Promise<T> {
  const {
    searchCacheKey,
    bgCacheKey,
    searchCache,
    cacheTTL,
    fetchFn,
    isEmptyResult,
    logger,
  } = options;

  const cachedResult = await searchCache.get(searchCacheKey);

  if (cachedResult !== undefined) {
    triggerBackgroundRefresh({
      searchCache,
      searchCacheKey,
      bgCacheKey,
      cacheTTL,
      fetchFn,
      isEmptyResult,
      logger,
    });
    return cachedResult;
  }

  const result = await fetchFn();

  // Don't cache empty results
  if (!isEmptyResult(result)) {
    await searchCache.set(searchCacheKey, result, cacheTTL);
    await bgRefreshCache.set(
      bgCacheKey,
      Date.now(),
      Env.BUILTIN_MINIMUM_BACKGROUND_REFRESH_INTERVAL
    );
  }

  return result;
}

/**
 * Triggers a background refresh if the minimum interval has passed.
 * This function is fire-and-forget and does not block.
 */
function triggerBackgroundRefresh<T>(options: {
  searchCache: Cache<string, T>;
  searchCacheKey: string;
  bgCacheKey: string;
  cacheTTL: number;
  fetchFn: () => Promise<T>;
  isEmptyResult: (result: T) => boolean;
  logger: Logger;
}): void {
  const {
    searchCacheKey,
    bgCacheKey,
    searchCache,
    cacheTTL,
    fetchFn,
    isEmptyResult,
    logger,
  } = options;

  (async () => {
    try {
      const lastRefresh = await bgRefreshCache.get(bgCacheKey);
      const now = Date.now();
      const intervalMs = Env.BUILTIN_MINIMUM_BACKGROUND_REFRESH_INTERVAL * 1000;

      if (lastRefresh && now - lastRefresh < intervalMs) {
        // Not enough time has passed since last refresh
        return;
      }

      // Perform background refresh
      logger.debug(`Starting background refresh for: ${searchCacheKey}`);
      const freshResult = await fetchFn();

      // Update cache if result is not empty
      if (!isEmptyResult(freshResult)) {
        await searchCache.set(searchCacheKey, freshResult, cacheTTL, true);
        await bgRefreshCache.set(
          bgCacheKey,
          now,
          Env.BUILTIN_MINIMUM_BACKGROUND_REFRESH_INTERVAL
        );
        logger.info(`Background refreshed cache for: ${searchCacheKey}`);
      }
    } catch (error) {
      logger.error(
        `Background refresh failed for: ${searchCacheKey} - ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  })();
}
