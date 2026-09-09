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

const logger = createLogger('tsukihime');

const TsukihimeTorrentSchema = z
  .looseObject({
    name: z.string(),
    btih: z.string().transform((h) => h.toLowerCase()),
    totalsize: z.number(),
    source_date: z.number(), // unix timestamp
    group: z.object({ name: z.string() }).nullable().optional(),
    audiolangs: z.array(z.string()).optional(),
    sublangs: z.array(z.string()).optional(),
  })
  .transform((data) => ({
    name: data.name,
    hash: data.btih,
    size: data.totalsize,
    sourceDate: data.source_date,
    group: data.group?.name,
    audioLangs: data.audiolangs,
    subLangs: data.sublangs,
  }));

const TsukihimeTorrentsResponseSchema = z
  .object({
    total: z.number(),
    limit: z.number(),
    results: z.array(TsukihimeTorrentSchema),
  })
  .transform((data) => ({
    total: data.total,
    limit: data.limit,
    results: data.results,
  }));

type TsukihimeTorrent = z.infer<typeof TsukihimeTorrentSchema>;

type TsukihimeTorrentsResponse = z.infer<
  typeof TsukihimeTorrentsResponseSchema
>;

const TsukihimeAnimeSchema = z.looseObject({ id: z.number() });

const getApiBaseUrl = () => appConfig.builtins.tsukihime.url;

class TsukihimeAPI {
  private headers: Record<string, string>;

  private readonly searchCache = Cache.getInstance<
    string,
    TsukihimeTorrentsResponse
  >('tsukihime:search');

  private readonly animeIdCache = Cache.getInstance<string, number | null>(
    'tsukihime:anime-id'
  );

  constructor() {
    this.headers = {
      'Content-Type': 'application/json',
      'User-Agent': HEADER_PRESETS.chrome['User-Agent'],
      Accept: 'application/json',
    };
  }

  /** Resolves TsukiHime's internal anime id from a MAL, AniDB or AniList id. */
  async getAnimeId(
    idType: 'mal' | 'anidb' | 'anilist',
    id: number
  ): Promise<number | null> {
    const cacheKey = `${idType}:${id}`;
    const cached = await this.animeIdCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const url = new URL(`/v1/animes/${idType}/${id}`, getApiBaseUrl());
    const timeout = appConfig.builtins.tsukihime.searchTimeout;

    const { result: animeId } = await DistributedLock.getInstance().withLock(
      url.toString(),
      async () => {
        try {
          const response = await makeRequest(url.toString(), {
            method: 'GET',
            headers: this.headers,
            timeout,
          });
          // 404 = confirmed no mapping (cache briefly); anything else is
          // transient and must not be cached.
          if (response.status === 404) {
            await this.animeIdCache.set(cacheKey, null, 3600);
            return null;
          }
          if (!response.ok) {
            throw new Error(
              `TsukiHime API error (${response.status}): ${response.statusText}`
            );
          }
          const animeId = TsukihimeAnimeSchema.parse(await response.json()).id;
          await this.animeIdCache.set(cacheKey, animeId, 7 * 24 * 3600);
          return animeId;
        } catch (error) {
          logger.error(
            `Failed to resolve TsukiHime anime id for ${cacheKey}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
          return null;
        }
      },
      { timeout, ttl: timeout + 1000 }
    );
    return animeId;
  }

  async getTorrentsForAnime(
    animeId: number,
    page: number
  ): Promise<TsukihimeTorrentsResponse> {
    return this.search(`/v1/animes/${animeId}`, page);
  }

  async searchTorrents(
    query: string,
    page: number
  ): Promise<TsukihimeTorrentsResponse> {
    return this.search(
      `/v1/search/torrents?q=${encodeURIComponent(query)}`,
      page
    );
  }

  private async search(
    endpoint: string,
    page: number
  ): Promise<TsukihimeTorrentsResponse> {
    const cacheKey = JSON.stringify({ endpoint, page });

    return searchWithBackgroundRefresh({
      searchCache: this.searchCache,
      searchCacheKey: cacheKey,
      bgCacheKey: `tsukihime:${cacheKey}`,
      cacheTTL: appConfig.builtins.tsukihime.searchCacheTtl,
      fetchFn: () => this.request(endpoint, page),
      isEmptyResult: (result) => result.results.length === 0,
      logger,
    });
  }

  private async request(
    endpoint: string,
    page: number
  ): Promise<TsukihimeTorrentsResponse> {
    const url = new URL(endpoint, getApiBaseUrl());
    url.searchParams.set('limit', '100');
    url.searchParams.set('offset', ((page - 1) * 100).toString());
    const timeout = appConfig.builtins.tsukihime.searchTimeout;

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

          if (!response.ok) {
            throw new Error(
              `TsukiHime API error (${response.status}): ${response.statusText}`
            );
          }

          const data = (await response.json()) as unknown;

          try {
            return TsukihimeTorrentsResponseSchema.parse(data);
          } catch (error) {
            throw new Error(
              `Failed to parse TsukiHime API response: ${formatZodError(error as z.ZodError)}`
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

export { getApiBaseUrl as getTsukihimeUrl };
export type { TsukihimeTorrent, TsukihimeTorrentsResponse };
export default TsukihimeAPI;
