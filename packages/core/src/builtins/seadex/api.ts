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

const logger = createLogger('seadex');

// Zod Schemas
const SeaDexTorrentSchema = z.object({
  collectionId: z.string(),
  collectionName: z.string(),
  created: z.string(),
  dualAudio: z.boolean().optional(),
  files: z.array(
    z.object({
      length: z.number(),
      name: z.string(),
    })
  ),
  groupedUrl: z.string(),
  id: z.string(),
  infoHash: z.string(),
  isBest: z.boolean(),
  releaseGroup: z.string().optional(),
  tags: z.array(z.string()),
  tracker: z.string(),
  updated: z.string(),
  url: z.string(),
});

type SeaDexTorrent = z.infer<typeof SeaDexTorrentSchema>;

const SeaDexEntrySchema = z.object({
  alID: z.number(),
  collectionId: z.string(),
  collectionName: z.string(),
  comparison: z.string().optional(),
  created: z.string(),
  expand: z
    .object({
      trs: z.array(SeaDexTorrentSchema).optional(),
    })
    .optional(),
  id: z.string(),
  incomplete: z.boolean(),
  notes: z.string().optional(),
  theoreticalBest: z.string().optional(),
  trs: z.array(z.string()),
  updated: z.string(),
});

type SeaDexEntry = z.infer<typeof SeaDexEntrySchema>;

const SeaDexResponseSchema = z.object({
  page: z.number(),
  perPage: z.number(),
  totalItems: z.number(),
  totalPages: z.number(),
  items: z.array(SeaDexEntrySchema),
});

type SeaDexResponse = z.infer<typeof SeaDexResponseSchema>;

/**
 * SeaDex API Client
 */
class SeaDexAPI {
  private headers: Record<string, string>;
  private readonly cache = Cache.getInstance<string, SeaDexResponse>(
    'seadex:api'
  );

  constructor() {
    this.headers = {
      'Content-Type': 'application/json',
      'User-Agent': Env.DEFAULT_USER_AGENT,
      Accept: 'application/json',
    };
  }

  /**
   * Fetch SeaDex entries by AniList ID
   * @param anilistId - The AniList ID
   * @returns SeaDex response with entries and expanded torrents
   */
  async getEntriesByAnilistId(anilistId: number): Promise<SeaDexResponse> {
    const cacheKey = `anilist-${anilistId}`;

    return searchWithBackgroundRefresh({
      searchCache: this.cache,
      searchCacheKey: cacheKey,
      bgCacheKey: `seadex:${cacheKey}`,
      cacheTTL: Env.BUILTIN_SEADEX_ENTRY_CACHE_TTL,
      fetchFn: async () => {
        logger.debug(`Fetching SeaDex data for AniList ID ${anilistId}`);

        const params = new URLSearchParams({
          expand: 'trs',
          filter: `alID=${anilistId}`,
          sort: '-trs.isBest',
        });

        return this.request<SeaDexResponse>(
          `/api/collections/entries/records?${params.toString()}`,
          {
            schema: SeaDexResponseSchema,
            timeout: 10000,
          }
        );
      },
      isEmptyResult: (result) => result.items.length === 0,
      logger,
    });
  }

  private async request<T>(
    endpoint: string,
    options: {
      schema: z.ZodSchema<T>;
      method?: string;
      body?: unknown;
      timeout?: number;
    }
  ): Promise<T> {
    const lockKey = `${Env.BUILTIN_SEADEX_URL}${endpoint}`;
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
      method?: string;
      body?: unknown;
      timeout?: number;
    }
  ): Promise<T> {
    const { schema, method = 'GET' } = options;
    const url = new URL(endpoint, Env.BUILTIN_SEADEX_URL);

    logger.debug(`Making ${method} request to ${endpoint}`);

    try {
      const response = await makeRequest(url.toString(), {
        method,
        headers: this.headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        timeout: options.timeout ?? Env.MAX_TIMEOUT,
      });

      if (!response.ok) {
        logger.warn(
          `SeaDex API returned ${response.status} for ${endpoint}: ${response.statusText}`
        );
        throw new Error(
          `SeaDex API error (${response.status}): ${response.statusText}`
        );
      }

      const data = (await response.json()) as unknown;

      try {
        return schema.parse(data);
      } catch (error) {
        throw new Error(
          `Failed to parse SeaDex API response: ${formatZodError(error as z.ZodError)}`
        );
      }
    } catch (error) {
      logger.error(
        `Request to ${endpoint} failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      throw error instanceof Error
        ? error
        : new Error('Unknown error occurred');
    }
  }
}

export type { SeaDexResponse, SeaDexEntry, SeaDexTorrent };
export default SeaDexAPI;
