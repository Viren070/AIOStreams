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

const logger = createLogger('knaben');

enum KnabenCategory {
  TV = 2000000,
  TVHD = 2001000,
  TVSD = 2002000,
  TVUHD = 2003000,
  TVDocumentary = 2004000,
  TVForeign = 2005000,
  TVSport = 2006000,
  TVCartoon = 2007000,
  TVOther = 2008000,
  Movies = 3000000,
  MoviesHD = 3001000,
  MoviesSD = 3002000,
  MoviesUHD = 3003000,
  MoviesDVD = 3004000,
  MoviesForeign = 3005000,
  MoviesBollywood = 3006000,
  Movies3D = 3007000,
  MoviesOther = 3008000,
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

// Strict, and only what the addon reads: the response was a passthrough
// object, so every extra field Knaben adds got cached for a week as well.
const KnabenSearchHitSchema = z.object({
  bytes: z.number(),
  categoryId: z.array(z.number()),
  hash: z
    .string()
    .nullable()
    .transform((val) => (val ? val.toLowerCase() : null)),
  date: z.iso
    .datetime({ offset: true, local: true })
    .transform((d) => (/(Z|[+-]\d{2}:\d{2})$/.test(d) ? d : `${d}Z`)),
  magnetUrl: z.string().nullable(),
  link: z.url().nullable(),
  seeders: z.number(),
  title: z.string(),
  tracker: z.string(),
});

type KnabenSearchHit = z.infer<typeof KnabenSearchHitSchema>;

const KnabenSearchResponse = z.object({
  hits: z.array(KnabenSearchHitSchema),
});

type KnabenSearchResponse = z.infer<typeof KnabenSearchResponse>;

interface KnabenSearchOptions {
  query: string;
  categories?: number[];
}

// https://knaben.org/api/v2/
const API_BASE_URL = 'https://api.knaben.org';
const API_VERSION = '2';

class KnabenAPI {
  private headers: Record<string, string>;

  private readonly searchCache = Cache.getInstance<
    string,
    KnabenSearchResponse
  >('knaben:search');

  constructor() {
    this.headers = {
      'User-Agent': HEADER_PRESETS.chrome['User-Agent'],
      Accept: 'application/json',
    };
  }

  async search(options: KnabenSearchOptions): Promise<KnabenSearchResponse> {
    const queryParams = new URLSearchParams({
      q: options.query,
      s: '300',
      // include 0-seeder and unsafe hits, hidden by default
      dead: '',
      unsafe: '',
    });
    if (options.categories?.length) {
      queryParams.set('c', options.categories.join(','));
    }
    const cacheKey = JSON.stringify(options);

    return searchWithBackgroundRefresh({
      searchCache: this.searchCache,
      searchCacheKey: cacheKey,
      bgCacheKey: `knaben:${cacheKey}`,
      cacheTTL: appConfig.builtins.knaben.searchCacheTtl,
      fetchFn: () =>
        this.request<KnabenSearchResponse>('search', {
          schema: KnabenSearchResponse,
          timeout: appConfig.builtins.knaben.searchTimeout,
          queryParams,
        }),
      isEmptyResult: (result) => result.hits.length === 0,
      logger,
    });
  }

  private async request<T>(
    endpoint: string,
    options: {
      schema: z.ZodSchema<T>;
      queryParams?: URLSearchParams;
      timeout?: number;
    }
  ): Promise<T> {
    let path = `/v${API_VERSION}`;
    if (endpoint) {
      path += `/${endpoint.startsWith('/') ? endpoint.slice(1) : endpoint}`;
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
        timeout: options.timeout ?? appConfig.userLimits.timeouts.maxTimeout,
        ttl:
          (options.timeout ?? appConfig.userLimits.timeouts.maxTimeout) + 1000,
      }
    );
    return result;
  }

  private async _request<T>(
    endpoint: string,
    options: {
      schema: z.ZodSchema<T>;
      queryParams?: URLSearchParams;
      timeout?: number;
    }
  ): Promise<T> {
    const { schema } = options;
    let path = `/v${API_VERSION}`;
    if (endpoint) {
      path += `/${endpoint.startsWith('/') ? endpoint.slice(1) : endpoint}`;
    }
    const url = new URL(path, API_BASE_URL);
    if (options.queryParams) {
      url.search = options.queryParams.toString();
    }

    logger.debug(`Making GET request to ${path}`);

    try {
      const response = await makeRequest(url.toString(), {
        method: 'GET',
        headers: this.headers,
        timeout: options.timeout ?? appConfig.userLimits.timeouts.maxTimeout,
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
