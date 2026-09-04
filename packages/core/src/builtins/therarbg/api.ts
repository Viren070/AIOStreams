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

const logger = createLogger('therarbg');

enum TheRARBGCategory {
  Movies = 'Movies',
  TV = 'TV',
  TVShows = 'TV shows',
  Anime = 'Anime',
}

const TheRARBGSearchResultSchema = z
  .looseObject({
    n: z.string(), // name
    a: z.number(), // unix timestamp i.e. age
    c: z.string(), // category e.g. Movies
    s: z.number(), // size
    u: z.string(), // user
    se: z.number(), // seeders
    i: z.string().nullable(), // imdb id
    h: z.string().transform((h) => h.toLowerCase()), // hash
  })
  .transform((data) => ({
    name: data.n,
    age: data.a,
    category: data.c,
    size: data.s,
    user: data.u,
    seeders: data.se,
    imdbId: data.i,
    hash: data.h,
  }));

const TheRARBGSearchResponse = z
  .object({
    page_size: z.number(),
    total: z.number(),
    results: z.array(TheRARBGSearchResultSchema),
  })
  .transform((data) => ({
    pageSize: data.page_size,
    total: data.total,
    results: data.results,
  }));

type TheRARBGSearchResponse = z.infer<typeof TheRARBGSearchResponse>;

const getApiBaseUrl = () => appConfig.builtins.therarbg.url;

class TheRARBGAPI {
  private headers: Record<string, string>;

  private readonly searchCache = Cache.getInstance<
    string,
    TheRARBGSearchResponse
  >('therarbg:search');

  constructor() {
    this.headers = {
      'Content-Type': 'application/json',
      'User-Agent': HEADER_PRESETS.chrome['User-Agent'],
      Accept: 'application/json',
    };
  }

  async search(options: {
    query: string;
    page?: number;
    categories?: string[];
  }): Promise<TheRARBGSearchResponse> {
    const query = options.query;
    const page = options.page ?? 1;
    const categories = options.categories ?? [];
    const cacheKey = JSON.stringify({ query, page, categories });

    return searchWithBackgroundRefresh({
      searchCache: this.searchCache,
      searchCacheKey: cacheKey,
      bgCacheKey: `therarbg:${cacheKey}`,
      cacheTTL: appConfig.builtins.therarbg.searchCacheTtl,
      fetchFn: () => this.request(query, page, categories),
      isEmptyResult: (result) => result.results.length === 0,
      logger,
    });
  }

  private async request(
    query: string,
    page: number,
    categories: string[]
  ): Promise<TheRARBGSearchResponse> {
    const categorySegments = categories.map((c) => `:category:${c}`).join('');
    const url = new URL(
      `/get-posts/order:-a${categorySegments}:keywords:${encodeURIComponent(query)}:format:json/`,
      getApiBaseUrl()
    );
    url.searchParams.set('page', page.toString());
    const timeout = appConfig.builtins.therarbg.searchTimeout;

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
              `TheRARBG API error (${response.status}): ${response.statusText}`
            );
          }

          try {
            return TheRARBGSearchResponse.parse(data);
          } catch (error) {
            throw new Error(
              `Failed to parse TheRARBG API response: ${formatZodError(error as z.ZodError)}`
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

export { TheRARBGCategory, getApiBaseUrl as getTheRARBGUrl };
export default TheRARBGAPI;
