import { Cache } from '../../utils/cache.js';
import { config as appConfig } from '../../config/index.js';
import { createLogger } from '../../utils/index.js';
import { searchWithBackgroundRefresh } from '../utils/general.js';
import { MirrorPool } from '../utils/mirror-pool.js';

import { z } from 'zod';

const logger = createLogger('eztv');

// Only the fields the addon reads survive the transform: the rest (ids,
// screenshot urls, peers) would otherwise be cached for a week per torrent.
const EztvTorrentSchema = z
  .object({
    hash: z.string().transform((h) => h.toLowerCase()),
    filename: z.string(),
    magnet_url: z.string(),
    title: z.string(),
    season: z.string(),
    episode: z.string(),
    seeds: z.number(),
    date_released_unix: z.number(),
    size_bytes: z.string(),
  })
  .transform((data) => ({
    hash: data.hash,
    filename: data.filename,
    magnetUrl: data.magnet_url,
    title: data.title,
    season: data.season,
    episode: data.episode,
    seeds: data.seeds,
    dateReleasedUnix: data.date_released_unix,
    sizeBytes: data.size_bytes,
  }));

type EztvTorrent = z.infer<typeof EztvTorrentSchema>;

const EztvGetTorrentsResponseSchema = z
  .object({
    torrents_count: z.number(),
    limit: z.number(),
    torrents: z.array(EztvTorrentSchema).default([]),
  })
  .transform((data) => ({
    torrentsCount: data.torrents_count,
    limit: data.limit,
    torrents: data.torrents,
  }));

type EztvGetTorrentsResponse = z.infer<typeof EztvGetTorrentsResponseSchema>;

const EztvGetTorrentsOptions = z.object({
  imdbId: z.string(),
  limit: z.number().min(1).max(100).default(100).optional(),
  page: z.number().min(1).default(1).optional(),
});

type EztvGetTorrentsOptions = z.infer<typeof EztvGetTorrentsOptions>;

const mirrorPool = MirrorPool.for('eztv', () => appConfig.builtins.eztv.url);

class EztvAPI {
  private headers: Record<string, string>;

  private readonly searchCache = Cache.getInstance<
    string,
    EztvGetTorrentsResponse
  >('eztv:search');

  constructor() {
    this.headers = {
      'Content-Type': 'application/json',
      'User-Agent': appConfig.http.defaultUserAgent,
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
      cacheTTL: appConfig.builtins.eztv.searchCacheTtl,
      fetchFn: () =>
        this.request<EztvGetTorrentsResponse>('/api/get-torrents', {
          schema: EztvGetTorrentsResponseSchema,
          timeout: appConfig.builtins.eztv.searchTimeout,
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
    const search = options.queryParams ? `?${options.queryParams}` : '';
    const path = `${endpoint.startsWith('/') ? '' : '/'}${endpoint}${search}`;
    const timeout = options.timeout ?? appConfig.userLimits.timeouts.maxTimeout;

    return mirrorPool.getJson(path, {
      schema: options.schema,
      headers: this.headers,
      timeout,
    });
  }
}

export type { EztvGetTorrentsOptions, EztvGetTorrentsResponse, EztvTorrent };
export default EztvAPI;
