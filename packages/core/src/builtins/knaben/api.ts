import { Cache } from '../../utils/cache.js';
import { Env } from '../../utils/env.js';
import { formatZodError, makeRequest } from '../../utils/index.js';
import { createLogger } from '../../utils/index.js';
import { searchWithBackgroundRefresh } from '../utils/general.js';

import { z } from 'zod';

const logger = createLogger('knaben');

enum KnabenCategory {
  TV = 2000000,
  Movies = 3000000,
  Anime = 6000000,
  AnimeSubbed = 6001000,
  AnimeDubbed = 6002000,
  AnimeDualAudio = 6003000,
  AnimeRaw = 6004000,
  AnimeMusicVideo = 6005000,
  AnimeLiterature = 6006000,
  AnimeMusic = 6007000,
  AnimeNonEnglishTranslated = 6008000,
}

const KnabenSearchHitSchema = z.looseObject({
  bytes: z.number(),
  cachedOrigin: z.string(),
  category: z.string(),
  categoryId: z.array(z.number()),
  date: z.iso.datetime({ offset: true }),
  details: z.url().nullable(),
  hash: z
    .string()
    .nullable()
    .transform((val) => (val ? val.toLowerCase() : null)),
  id: z.string(),
  lastSeen: z.iso.datetime({ offset: true }),
  magnetUrl: z.string().nullable(),
  link: z.url().nullable(),
  peers: z.number(),
  seeders: z.number(),
  score: z.number().nullable(),
  title: z.string(),
  tracker: z.string(),
  trackerId: z.string(),
  virusDetection: z.number().min(0).max(1),
});

type KnabenSearchHit = z.infer<typeof KnabenSearchHitSchema>;

const KnabenSearchResponse = z.object({
  hits: z.array(KnabenSearchHitSchema),
  max_score: z.number().nullable(),
  total: z.object({
    relation: z.enum(['eq', 'gte', 'lte']),
    value: z.number(),
  }),
});

type KnabenSearchResponse = z.infer<typeof KnabenSearchResponse>;

const KnabenSearchOptions = z.object({
  searchType: z
    .union([
      z.literal('score'),
      z.string().regex(/^(100|[1-9]?\d)%$/, {
        message: 'Must be "score" or a percentage string like "80%"',
      }),
    ])
    .default('100%')
    .optional(),
  searchField: z.keyof(KnabenSearchHitSchema).default('title').optional(),
  query: z.string(),
  orderBy: z.keyof(KnabenSearchHitSchema).optional(),
  orderDirection: z.enum(['asc', 'desc']).default('desc').optional(),
  categories: z.array(z.number()).optional(),
  from: z.number().default(0).optional(),
  size: z.number().min(1).max(300).default(150).optional(),
  hideUnsafe: z.boolean().default(false).optional(),
  hideXXX: z.boolean().default(true).optional(),
  secondsSinceLastSeen: z.number().optional(),
});

type KnabenSearchOptions = z.infer<typeof KnabenSearchOptions>;

const KnabenSearchOptionsRequest = KnabenSearchOptions.transform((data) => ({
  search_type: data['searchType'],
  search_field: data['searchField'],
  query: data['query'],
  order_by: data['orderBy'],
  order_direction: data['orderDirection'],
  categories: data['categories'],
  from: data['from'],
  size: data['size'],
  hide_unsafe: data['hideUnsafe'],
  hide_xxx: data['hideXXX'],
  seconds_since_last_seen: data['secondsSinceLastSeen'],
}));

const API_BASE_URL = 'https://api.knaben.org';
const API_VERSION = '1';

class KnabenAPI {
  private headers: Record<string, string>;

  private readonly searchCache = Cache.getInstance<
    string,
    KnabenSearchResponse
  >('knaben:search');

  constructor() {
    this.headers = {
      'Content-Type': 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json',
    };
  }

  async search(options: KnabenSearchOptions): Promise<KnabenSearchResponse> {
    const body = KnabenSearchOptionsRequest.parse(options);
    const cacheKey = JSON.stringify(options);

    return searchWithBackgroundRefresh({
      searchCache: this.searchCache,
      searchCacheKey: cacheKey,
      bgCacheKey: `knaben:${cacheKey}`,
      cacheTTL: Env.BUILTIN_KNABEN_SEARCH_CACHE_TTL,
      fetchFn: () =>
        this.request<KnabenSearchResponse>('', {
          schema: KnabenSearchResponse,
          method: 'POST',
          timeout: Env.BUILTIN_KNABEN_SEARCH_TIMEOUT,
          body,
        }),
      isEmptyResult: (result) => result.hits.length === 0,
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
    }
  ): Promise<T> {
    const { schema, body, method = 'GET' } = options;
    let path = `/v${API_VERSION}`;
    if (endpoint) {
      path += `/${endpoint.startsWith('/') ? endpoint.slice(1) : endpoint}`;
    }
    const url = new URL(path, API_BASE_URL);

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
          `Knaben API error (${response.status}): ${response.statusText}`
        );
      }

      try {
        return schema.parse(data);
      } catch (error) {
        throw new Error(
          `Failed to parse Knaben API response: ${formatZodError(error as z.ZodError)}`
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

export { KnabenCategory, API_BASE_URL as knabenApiUrl };
export type { KnabenSearchOptions, KnabenSearchResponse, KnabenSearchHit };
export default KnabenAPI;
