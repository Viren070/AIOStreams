import { fetch, RequestInit, Response } from 'undici';
import { z } from 'zod';
import {
  TorBoxApiResponseSchema,
  TorBoxSearchApiDataSchema,
} from './schemas.js';
import {
  createLogger,
  DistributedLock,
  Env,
  formatZodError,
  maskSensitiveInfo,
} from '../../utils/index.js';
import { IdType } from '../../utils/id-parser.js';

type TorboxSuccessResponse<T> = {
  success: true;
  message?: string;
  data: T | null;
};

type TorboxErrorResponse = {
  success: false;
  error: string;
  detail?: string;
  message?: string;
  data: null;
};

type TorboxResponse<T> = TorboxSuccessResponse<T> | TorboxErrorResponse;

export const supportedIdTypes: IdType[] = [
  'animePlanetId',
  'anidbId',
  'anilistId',
  'anisearchId',
  'imdbId',
  'kitsuId',
  'livechartId',
  'malId',
  'notifyMoeId',
  'thetvdbId',
  'themoviedbId',
];

export type TorboxSearchApiIdType =
  | 'anime-planet_id'
  | 'anidb_id'
  | 'anilist_id'
  | 'anisearch_id'
  | 'imdb_id'
  | 'kitsu_id'
  | 'livechart_id'
  | 'mal_id'
  | 'notify.moe_id'
  | 'thetvdb_id'
  | 'themoviedb_id';

const logger = createLogger('torbox-search');

function isErrorResponse<T>(
  response: TorboxResponse<T>
): response is TorboxErrorResponse {
  return !response.success;
}

export class TorboxSearchApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errorCode?: string
  ) {
    super(message);
    this.name = 'TorboxSearchApiError';
  }
}

const USER_AGENT = Env.DEFAULT_USER_AGENT;

class TorboxSearchApi {
  private readonly baseUrl = 'https://search-api.torbox.app';
  private static readonly ongoingRequests = new Map<string, Promise<any>>();
  private static readonly timeout =
    Env.BUILTIN_TORBOX_SEARCH_SEARCH_API_TIMEOUT;

  constructor(public readonly apiKey: string) {}

  private async createRequestLock<T>(
    key: string,
    executor: () => Promise<T>
  ): Promise<T> {
    const { result, cached } = await DistributedLock.getInstance().withLock(
      `tb-search-api:${key}`,
      executor,
      {
        timeout: TorboxSearchApi.timeout,
        ttl: TorboxSearchApi.timeout * 2,
      }
    );

    if (cached) {
      logger.debug(
        `Found cached result for ${key.replace(this.apiKey, maskSensitiveInfo(this.apiKey))}`
      );
    }

    return result;
  }

  async request<T>(
    endpoint: string,
    schema: z.ZodSchema<T>,
    {
      body,
      method = 'GET',
      params,
      ...options
    }: Omit<RequestInit, 'headers' | 'signal'> & {
      timeout?: number;
      params?: URLSearchParams;
    } = {}
  ): Promise<T> {
    const url = new URL(endpoint, this.baseUrl);
    if (params) {
      url.search = params.toString();
    }

    const headers = new Headers({
      Accept: 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    });

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        ...options,
        method,
        headers,
        signal: AbortSignal.timeout(TorboxSearchApi.timeout),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new TorboxSearchApiError('Request timed out', 408, 'TIMEOUT');
      }
      throw error;
    }

    const data = await response.json();

    const parsedResponse = TorBoxApiResponseSchema(schema).safeParse(data);

    if (!parsedResponse.success) {
      throw new TorboxSearchApiError(
        `Failed to parse API response: ${formatZodError(parsedResponse.error)}`,
        response.status,
        'PARSE_ERROR'
      );
    }

    const result = parsedResponse.data as TorboxResponse<T>;

    if (isErrorResponse(result)) {
      throw new TorboxSearchApiError(
        result.detail || result.message || 'Unknown',
        response.status,
        result.error
      );
    }

    if (Array.isArray(result.data) && result.data.length === 0) {
      logger.warn(`API returned empty array for ${endpoint}.`);
      logger.debug(JSON.stringify(result, null, 2));
    }

    return result.data as T;
  }

  public async getTorrentsById(
    idType: TorboxSearchApiIdType,
    id: string,
    params: {
      check_cache?: 'true' | 'false';
      check_owned?: 'true' | 'false';
      search_user_engines?: 'true' | 'false';
      season?: string;
      metadata?: 'true' | 'false';
      episode?: string;
    } = {
      check_cache: 'true',
      check_owned: 'true',
      metadata: 'true',
    }
  ): Promise<z.infer<typeof TorBoxSearchApiDataSchema>> {
    const endpoint = `/torrents/${idType}:${id}`;
    const lockKey =
      params.search_user_engines === 'true'
        ? `${this.apiKey}:${endpoint}:${params.season}:${params.episode}`
        : `${endpoint}:${params.season}:${params.episode}`;

    return this.createRequestLock(lockKey, () =>
      this.request<z.infer<typeof TorBoxSearchApiDataSchema>>(
        endpoint,
        TorBoxSearchApiDataSchema,
        {
          params: new URLSearchParams(
            Object.fromEntries(
              Object.entries(params).filter(([_, value]) => value !== undefined)
            )
          ),
        }
      )
    );
  }

  public async getUsenetById(
    idType: TorboxSearchApiIdType,
    id: string,
    params: {
      check_cache?: 'true' | 'false';
      check_owned?: 'true' | 'false';
      search_user_engines?: 'true' | 'false';
      season?: string;
      episode?: string;
      metadata?: 'true' | 'false';
    } = {
      check_cache: 'true',
      check_owned: 'true',
      metadata: 'true',
    }
  ) {
    const endpoint = `/usenet/${idType}:${id}`;
    const lockKey =
      params.search_user_engines === 'true'
        ? `${this.apiKey}:${endpoint}:${params.season}:${params.episode}`
        : `${endpoint}:${params.season}:${params.episode}`;

    return this.createRequestLock(lockKey, () =>
      this.request<z.infer<typeof TorBoxSearchApiDataSchema>>(
        endpoint,
        TorBoxSearchApiDataSchema,
        {
          params: new URLSearchParams(
            Object.fromEntries(
              Object.entries(params).filter(([_, value]) => value !== undefined)
            )
          ),
        }
      )
    );
  }
}

export default TorboxSearchApi;
