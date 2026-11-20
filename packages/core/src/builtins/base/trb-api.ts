// Shared by therarbg and torrent-galaxy, which run the same TRB backend.
import { Cache } from '../../utils/cache.js';
import { HEADER_PRESETS, createLogger } from '../../utils/index.js';
import type { Logger } from '../../logging/logger.js';
import { searchWithBackgroundRefresh } from '../utils/general.js';
import { MirrorPool } from '../utils/mirror-pool.js';

import { z } from 'zod';

export enum TrbCategory {
  Movies = 'Movies',
  TV = 'TV',
  TVShows = 'TV shows',
  Anime = 'Anime',
}

// some posts omit the "tt" prefix
export const normaliseImdbId = (id: string | null | undefined) =>
  id && /^\d+$/.test(id) ? `tt${id}` : id;

const TrbSearchResultSchema = z
  .looseObject({
    n: z.string(), // name
    a: z.number(), // unix timestamp i.e. age
    s: z.number(), // size
    u: z.string(), // user
    se: z.number(), // seeders
    i: z.string().nullable(), // imdb id
    h: z.string().transform((h) => h.toLowerCase()), // hash
  })
  .transform((data) => ({
    name: data.n,
    age: data.a,
    size: data.s,
    user: data.u,
    seeders: data.se,
    imdbId: normaliseImdbId(data.i),
    hash: data.h,
  }));

const TrbSearchResponse = z
  .object({
    page_size: z.number(),
    total: z.number(),
    results: z.array(TrbSearchResultSchema),
  })
  .transform((data) => ({
    pageSize: data.page_size,
    total: data.total,
    results: data.results,
  }));

type TrbSearchResponse = z.infer<typeof TrbSearchResponse>;

export interface TrbSite {
  id: string;
  name: string;
  indexerLabel: string;
  getConfig: () => {
    url: string[];
    searchTimeout: number;
    searchCacheTtl: number;
    pageLimit: number;
  };
}

export class TrbAPI {
  private headers: Record<string, string>;
  private readonly logger: Logger;
  private readonly searchCache: Cache<string, TrbSearchResponse>;
  private readonly mirrorPool: MirrorPool;

  constructor(private readonly site: TrbSite) {
    this.logger = createLogger(site.id);
    this.searchCache = Cache.getInstance<string, TrbSearchResponse>(
      `${site.id}:search`
    );
    this.mirrorPool = MirrorPool.for(site.id, () => site.getConfig().url);
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
  }): Promise<TrbSearchResponse> {
    const query = options.query;
    const page = options.page ?? 1;
    const categories = options.categories ?? [];
    const cacheKey = JSON.stringify({ query, page, categories });

    return searchWithBackgroundRefresh({
      searchCache: this.searchCache,
      searchCacheKey: cacheKey,
      bgCacheKey: `${this.site.id}:${cacheKey}`,
      cacheTTL: this.site.getConfig().searchCacheTtl,
      fetchFn: () => this.request(query, page, categories),
      isEmptyResult: (result) => result.results.length === 0,
      logger: this.logger,
    });
  }

  private async request(
    query: string,
    page: number,
    categories: string[]
  ): Promise<TrbSearchResponse> {
    const categorySegments = categories.map((c) => `:category:${c}`).join('');
    const path = `/get-posts/keywords:${encodeURIComponent(query)}:order:-a${categorySegments}:format:json/?page=${page}`;
    return this.mirrorPool.getJson(path, {
      schema: TrbSearchResponse,
      headers: this.headers,
      timeout: this.site.getConfig().searchTimeout,
    });
  }
}
