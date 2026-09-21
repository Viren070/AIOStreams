import { Cache } from '../../utils/cache.js';
import { config as appConfig } from '../../config/index.js';
import {
  formatZodError,
  makeRequest,
  DistributedLock,
  HEADER_PRESETS,
} from '../../utils/index.js';
import { createLogger } from '../../utils/index.js';
import { searchWithBackgroundRefresh } from '../utils/general.js';

import { z } from 'zod';

const logger = createLogger('the-pirate-bay');

// apibay returns a single sentinel row (id "0", all-zero hash) instead of an
// empty array when nothing matches.
const NO_RESULTS_HASH = '0'.repeat(40);

const ThePirateBaySearchResultSchema = z
  .looseObject({
    name: z.string(),
    info_hash: z.string().transform((h) => h.toLowerCase()),
    seeders: z.coerce.number(),
    size: z.coerce.number(),
    added: z.coerce.number(), // unix timestamp
    username: z.string(),
    imdb: z.string().nullable().optional(),
  })
  .transform((data) => ({
    name: data.name,
    hash: data.info_hash,
    seeders: data.seeders,
    size: data.size,
    added: data.added,
    user: data.username,
    imdbId: data.imdb || null,
  }));

const ThePirateBaySearchResponse = z
  .array(ThePirateBaySearchResultSchema)
  .transform((results) => results.filter((r) => r.hash !== NO_RESULTS_HASH));

type ThePirateBaySearchResponse = z.infer<typeof ThePirateBaySearchResponse>;

const getApiBaseUrl = () => appConfig.builtins.thePirateBay.url;

class ThePirateBayAPI {
  private headers: Record<string, string>;

  private readonly searchCache = Cache.getInstance<
    string,
    ThePirateBaySearchResponse
  >('the-pirate-bay:search');

  constructor() {
    this.headers = {
      'Content-Type': 'application/json',
      'User-Agent': HEADER_PRESETS.chrome['User-Agent'],
      Accept: 'application/json',
    };
  }

  async search(query: string): Promise<ThePirateBaySearchResponse> {
    const cacheKey = JSON.stringify({ query });

    return searchWithBackgroundRefresh({
      searchCache: this.searchCache,
      searchCacheKey: cacheKey,
      bgCacheKey: `the-pirate-bay:${cacheKey}`,
      cacheTTL: appConfig.builtins.thePirateBay.searchCacheTtl,
      fetchFn: () => this.request(query),
      isEmptyResult: (result) => result.length === 0,
      logger,
    });
  }

  private async request(query: string): Promise<ThePirateBaySearchResponse> {
    const url = new URL('/q.php', getApiBaseUrl());
    url.searchParams.set('q', query);
    // 200 is apibay's parent Video category - expands to all of 200-299 server-side
    url.searchParams.set('cat', '200');
    const timeout = appConfig.builtins.thePirateBay.searchTimeout;

    const { result } = await DistributedLock.getInstance().withLock(
      url.toString(),
      async () => {
        logger.debug(`Making GET request to ${url.pathname}`);
        try {
          const response = await makeRequest(url.toString(), {
            method: 'GET',
            headers: this.headers,
            timeout,
          });

          const data = (await response.json()) as unknown;

          if (!response.ok) {
            throw new Error(
              `The Pirate Bay API error (${response.status}): ${response.statusText}`
            );
          }

          try {
            return ThePirateBaySearchResponse.parse(data);
          } catch (error) {
            throw new Error(
              `Failed to parse The Pirate Bay API response: ${formatZodError(error as z.ZodError)}`
            );
          }
        } catch (error) {
          logger.error(
            `Request to ${url.pathname} failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
          throw error instanceof Error
            ? error
            : new Error('Unknown error occurred');
        }
      },
      { timeout, ttl: timeout + 1000 }
    );
    return result;
  }
}

export { getApiBaseUrl as getThePirateBayUrl };
export default ThePirateBayAPI;
