import { Logger } from 'winston';
import { Cache } from '../../utils/cache.js';
import { Env } from '../../utils/env.js';
import { createLogger } from '../../utils/index.js';
import pLimit from 'p-limit';

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
 *
 * Env.BUILTIN_SCRAPE_WITH_ALL_TITLES can be:
 *   - an array: in which case, if the hostname of the given URL is in the array, returns true.
 *   - a boolean: returns its truthiness.
 *   - undefined: returns false.
 *
 * @param url - The URL whose hostname is checked against the array (if applicable).
 * @returns {boolean} - True if all titles should be used for the given URL, false otherwise.
 */
export function useAllTitles(url: string): boolean {
  if (Array.isArray(Env.BUILTIN_SCRAPE_WITH_ALL_TITLES)) {
    return Env.BUILTIN_SCRAPE_WITH_ALL_TITLES.includes(new URL(url).hostname);
  }
  return !!Env.BUILTIN_SCRAPE_WITH_ALL_TITLES;
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
