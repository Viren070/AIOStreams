import { Cache } from '../../utils/cache.js';
import { Env } from '../../utils/env.js';
import {
  formatZodError,
  makeRequest,
  DistributedLock,
} from '../../utils/index.js';
import { createLogger } from '../../utils/index.js';
import { searchWithBackgroundRefresh } from '../utils/general.js';

import { z } from 'zod';

const logger = createLogger('torrent-galaxy');

enum TorrentGalaxyCategory {
  Movies = 'Movies',
  TV = 'TV',
  Anime = 'Anime',
}

const TorrentGalaxySearchResultSchema = z
  .looseObject({
    pk: z.string(), // post key
    n: z.string(), // name
    a: z.number(), // unix timestamp i.e. age
    c: z.string(), // category e.g. Movies
    s: z.number(), // size
    t: z.url().nullable(), // poster URL
    u: z.string(), // user
    se: z.number(), // seeders
    le: z.number(), // leechers
    i: z.string().nullable(), // imdb id,
    h: z.string().transform((h) => h.toLowerCase()), // hash
    tg: z.array(z.string()), // tags.
  })
  .transform((data) => ({
    postKey: data.pk,
    name: data.n,
    age: data.a,
    category: data.c,
    size: data.s,
    posterUrl: data.t,
    user: data.u,
    seeders: data.se,
    leechers: data.le,
    imdbId: data.i,
    hash: data.h,
    tags: data.tg,
  }));

type TorrentGalaxySearchResult = z.infer<
  typeof TorrentGalaxySearchResultSchema
>;

const TorrentGalaxySearchResponse = z
  .object({
    page_size: z.number(),
    count: z.number(),
    total: z.number(),
    results: z.array(TorrentGalaxySearchResultSchema),
  })
  .transform((data) => ({
    pageSize: data.page_size,
    count: data.count,
    total: data.total,
    results: data.results,
  }));

type TorrentGalaxySearchResponse = z.infer<typeof TorrentGalaxySearchResponse>;

const TorrentGalaxySearchOptions = z.object({
  query: z.string(),
  page: z.number().default(1),
});

type TorrentGalaxySearchOptions = z.infer<typeof TorrentGalaxySearchOptions>;

const API_BASE_URL = Env.BUILTIN_TORRENT_GALAXY_URL;

class TorrentGalaxyAPI {
  private headers: Record<string, string>;

  private readonly searchCache = Cache.getInstance<
    string,
    TorrentGalaxySearchResponse
  >('torrent-galaxy:search');

  constructor() {
    this.headers = {
      'Content-Type': 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json',
    };
  }

  async search(
    options: TorrentGalaxySearchOptions
  ): Promise<TorrentGalaxySearchResponse> {
    let queryParams = new URLSearchParams();
    if (options.page) {
      queryParams.set('page', options.page.toString());
    }
    const cacheKey = JSON.stringify(options);
    return searchWithBackgroundRefresh({
      searchCache: this.searchCache,
      searchCacheKey: cacheKey,
      bgCacheKey: `tgx:${cacheKey}`,
      cacheTTL: Env.BUILTIN_TORRENT_GALAXY_SEARCH_CACHE_TTL,
      fetchFn: () =>
        this.request<TorrentGalaxySearchResponse>(
          `/get-posts/keywords:${encodeURIComponent(options.query)}:format:json`,
          {
            schema: TorrentGalaxySearchResponse,
            timeout: Env.BUILTIN_TORRENT_GALAXY_SEARCH_TIMEOUT,
            queryParams,
          }
        ),
      isEmptyResult: (result) => result.results.length === 0,
      logger,
    });
  }

  private async request<T>(
    endpoint: string,
    options: {
      schema: z.ZodSchema<T>;
      body?: unknown;
      method?: string;
      timeout?: number;
      queryParams?: URLSearchParams;
    }
  ): Promise<T> {
    let path = '';
    if (endpoint) {
      path = `/${endpoint.startsWith('/') ? endpoint.slice(1) : endpoint}`;
    }
    const url = new URL(path, API_BASE_URL);
    if (options.queryParams) {
      url.search = options.queryParams.toString();
    }

    const lockKey = url.toString();
    const { result } = await DistributedLock.getInstance().withLock(
      lockKey,
      () => this._request(endpoint, options),
      {
        timeout: options.timeout ?? Env.MAX_TIMEOUT,
        ttl: (options.timeout ?? Env.MAX_TIMEOUT) + 1000,
      }
    );
    return result;
  }

  private async _request<T>(
    endpoint: string,
    options: {
      schema: z.ZodSchema<T>;
      body?: unknown;
      method?: string;
      timeout?: number;
      queryParams?: URLSearchParams;
    }
  ): Promise<T> {
    const { schema, body, method = 'GET' } = options;
    let path = '';
    if (endpoint) {
      path = `/${endpoint.startsWith('/') ? endpoint.slice(1) : endpoint}`;
    }
    const url = new URL(path, API_BASE_URL);
    if (options.queryParams) {
      url.search = options.queryParams.toString();
    }

    logger.debug(`Making ${method} request to ${path}`);

    try {
      const response = await makeRequest(url.toString(), {
        method,
        headers: this.headers,
        body: body ? JSON.stringify(body) : undefined,
        timeout: options.timeout ?? Env.MAX_TIMEOUT,
      });

      const data = (await response.json()) as unknown;

      if (!response.ok) {
        throw new Error(
          `Torrent Galaxy API error (${response.status}): ${response.statusText}`
        );
      }

      try {
        return schema.parse(data);
      } catch (error) {
        throw new Error(
          `Failed to parse Torrent Galaxy API response: ${formatZodError(error as z.ZodError)}`
        );
      }
    } catch (error) {
      logger.error(
        `Request to ${path} failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      throw error instanceof Error
        ? error
        : new Error('Unknown error occurred');
    }
  }
}

export { TorrentGalaxyCategory, API_BASE_URL as torrentGalaxyUrl };
export type {
  TorrentGalaxySearchOptions,
  TorrentGalaxySearchResponse,
  TorrentGalaxySearchResult,
};
export default TorrentGalaxyAPI;
