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

const logger = createLogger('eztv');

const EztvTorrentSchema = z
  .object({
    id: z.number(),
    hash: z.string().transform((h) => h.toLowerCase()),
    filename: z.string(),
    magnet_url: z.string(),
    title: z.string(),
    imdb_id: z.string(),
    season: z.string(),
    episode: z.string(),
    small_screenshot: z.string().optional(),
    large_screenshot: z.string().optional(),
    seeds: z.number(),
    peers: z.number(),
    date_released_unix: z.number(),
    size_bytes: z.string(),
  })
  .transform((data) => ({
    id: data.id,
    hash: data.hash,
    filename: data.filename,
    magnetUrl: data.magnet_url,
    title: data.title,
    imdbId: data.imdb_id,
    season: data.season,
    episode: data.episode,
    smallScreenshot: data.small_screenshot,
    largeScreenshot: data.large_screenshot,
    seeds: data.seeds,
    peers: data.peers,
    dateReleasedUnix: data.date_released_unix,
    sizeBytes: data.size_bytes,
  }));

type EztvTorrent = z.infer<typeof EztvTorrentSchema>;

const EztvGetTorrentsResponseSchema = z
  .object({
    imdb_id: z.string(),
    torrents_count: z.number(),
    limit: z.number(),
    page: z.number(),
    torrents: z.array(EztvTorrentSchema),
  })
  .transform((data) => ({
    imdbId: data.imdb_id,
    torrentsCount: data.torrents_count,
    limit: data.limit,
    page: data.page,
    torrents: data.torrents,
  }));

type EztvGetTorrentsResponse = z.infer<typeof EztvGetTorrentsResponseSchema>;

const EztvGetTorrentsOptions = z.object({
  imdbId: z.string(),
  limit: z.number().min(1).max(100).default(100).optional(),
  page: z.number().min(1).default(1).optional(),
});

type EztvGetTorrentsOptions = z.infer<typeof EztvGetTorrentsOptions>;

const API_BASE_URL = Env.BUILTIN_EZTV_URL;

class EztvAPI {
  private headers: Record<string, string>;

  private readonly searchCache = Cache.getInstance<
    string,
    EztvGetTorrentsResponse
  >('eztv:search');

  constructor() {
    this.headers = {
      'Content-Type': 'application/json',
      'User-Agent': Env.DEFAULT_USER_AGENT,
      Accept: 'application/json',
    };
  }

  async getTorrents(
    options: EztvGetTorrentsOptions
  ): Promise<EztvGetTorrentsResponse> {
    const parsed = EztvGetTorrentsOptions.parse(options);
    const cacheKey = JSON.stringify(parsed);

    return searchWithBackgroundRefresh({
      searchCache: this.searchCache,
      searchCacheKey: cacheKey,
      bgCacheKey: `eztv:${cacheKey}`,
      cacheTTL: Env.BUILTIN_EZTV_SEARCH_CACHE_TTL,
      fetchFn: () =>
        this.request<EztvGetTorrentsResponse>('/api/get-torrents', {
          schema: EztvGetTorrentsResponseSchema,
          timeout: Env.BUILTIN_EZTV_SEARCH_TIMEOUT,
          queryParams: new URLSearchParams({
            imdb_id: parsed.imdbId,
            limit: String(parsed.limit ?? 100),
            page: String(parsed.page ?? 1),
          }),
        }),
      isEmptyResult: (result) => result.torrents.length === 0,
      logger,
    });
  }

  private async request<T>(
    endpoint: string,
    options: {
      schema: z.ZodSchema<T>;
      timeout?: number;
      queryParams?: URLSearchParams;
    }
  ): Promise<T> {
    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
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
      timeout?: number;
      queryParams?: URLSearchParams;
    }
  ): Promise<T> {
    const { schema } = options;
    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = new URL(path, API_BASE_URL);
    if (options.queryParams) {
      url.search = options.queryParams.toString();
    }

    logger.debug(`Making GET request to ${path}`);

    try {
      const response = await makeRequest(url.toString(), {
        method: 'GET',
        headers: this.headers,
        timeout: options.timeout ?? Env.MAX_TIMEOUT,
      });

      const data = (await response.json()) as unknown;

      if (!response.ok) {
        throw new Error(
          `EZTV API error (${response.status}): ${response.statusText}`
        );
      }

      try {
        return schema.parse(data);
      } catch (error) {
        throw new Error(
          `Failed to parse EZTV API response: ${formatZodError(error as z.ZodError)}`
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

export { API_BASE_URL as eztvApiUrl };
export type { EztvGetTorrentsOptions, EztvGetTorrentsResponse, EztvTorrent };
export default EztvAPI;
