import { fetch } from 'undici';
import {
  Cache,
  DistributedLock,
  Env,
  formatZodError,
  makeRequest,
} from '../../utils/index.js';
import z from 'zod';

interface ResponseMeta {
  headers: Record<string, string>;
  status: number;
  statusText: string;
}

interface ProwlarrApiResponse<T> {
  data: T;
  meta: ResponseMeta;
}

interface ProwlarrConfig {
  baseUrl: string;
  apiKey: string;
  timeout: number;
}

export class ProwlarrApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string
  ) {
    super(message);
  }
}

const ProwlarrErrorSchema = z.object({
  message: z.string(),
  description: z.string(),
});

const ProwlarrApiTagItemSchema = z.object({
  label: z.string(),
  id: z.number(),
});
const ProwlarrApiTagsListSchema = z.array(ProwlarrApiTagItemSchema);
export type ProwlarrApiTagItem = z.infer<typeof ProwlarrApiTagItemSchema>;
// minimise schema to only include the fields we need
const ProwlarrApiIndexerSchema = z.object({
  id: z.number(),
  name: z.string(),
  sortName: z.string(),
  definitionName: z.string(),
  enable: z.boolean(),
  tags: z.array(z.number()),
});

export type ProwlarrApiIndexer = z.infer<typeof ProwlarrApiIndexerSchema>;

const ProwlarrApiIndexersListSchema = z.array(ProwlarrApiIndexerSchema);

const ProwlarrApiSearchItemSchema = z.object({
  guid: z.string(), // can sometimes be the raw magnet url
  age: z.number(), // in days
  size: z.number(),
  indexerId: z.number(),
  indexer: z.string(),
  title: z.string(),
  downloadUrl: z.url().optional(),
  indexerFlags: z.array(
    z.enum(['freeleech', 'public', 'private', 'semi-private'])
  ),
  magnetUrl: z.url().optional(),
  infoHash: z
    .string()
    .optional()
    .transform((val) => val?.toLowerCase()),
  seeders: z.number().optional(),
});

const ProwlarrApiSearchSchema = z.array(ProwlarrApiSearchItemSchema);

export type ProwlarrApiSearchItem = z.infer<typeof ProwlarrApiSearchItemSchema>;

class ProwlarrApi {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  private readonly baseApiPath = '/api/v1';

  private readonly searchCache = Cache.getInstance<
    string,
    ProwlarrApiSearchItem[]
  >('prowlarr-api:search');

  private readonly indexersCache = Cache.getInstance<
    string,
    ProwlarrApiIndexer[]
  >('prowlarr-api:indexers');

  private readonly tagsCache = Cache.getInstance<string, ProwlarrApiTagItem[]>(
    'prowlarr-api:tags'
  );

  #headers: Record<string, string>;
  #timeout: number;

  constructor(config: ProwlarrConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.#headers = {
      'Content-Type': 'application/json',
      'X-Api-Key': this.apiKey,
      'User-Agent': Env.DEFAULT_USER_AGENT,
    };
    this.#timeout = config.timeout;
  }

  async tags(): Promise<ProwlarrApiResponse<ProwlarrApiTagItem[]>> {
    return this.tagsCache.wrap(
      () =>
        this.request<ProwlarrApiTagItem[]>(
          'tag',
          {},
          ProwlarrApiTagsListSchema
        ),
      `${this.baseUrl}:tag`,
      Env.BUILTIN_PROWLARR_INDEXERS_CACHE_TTL
    );
  }

  async indexers(): Promise<ProwlarrApiResponse<ProwlarrApiIndexer[]>> {
    return this.indexersCache.wrap(
      () =>
        this.request<ProwlarrApiIndexer[]>(
          'indexer',
          {},
          ProwlarrApiIndexersListSchema,
          3000
        ),
      `${this.baseUrl}:indexer`,
      Env.BUILTIN_PROWLARR_INDEXERS_CACHE_TTL
    );
  }

  async search({
    query,
    indexerIds,
    type,
    limit,
    offset,
  }: {
    query: string;
    indexerIds: number[];
    type: 'search';
    limit?: number;
    offset?: number;
  }): Promise<ProwlarrApiResponse<ProwlarrApiSearchItem[]>> {
    return this.searchCache.wrap(
      () =>
        this.request<ProwlarrApiSearchItem[]>(
          'search',
          {
            query,
            type,
            indexerIds,
            ...(limit !== undefined && { limit }),
            ...(offset !== undefined && { offset }),
          },
          ProwlarrApiSearchSchema
        ),
      `${this.baseUrl}:search:${query}`,
      Env.BUILTIN_PROWLARR_SEARCH_CACHE_TTL
    );
  }

  private getPath(endpoint: string) {
    return `${this.baseUrl}${this.baseApiPath}/${endpoint}`;
  }

  private async request<T>(
    endpoint: string,
    params: Record<
      string,
      string | number | boolean | (string | number)[]
    > = {},
    schema: z.ZodType<T>,
    timeout?: number
  ): Promise<ProwlarrApiResponse<T>> {
    const { result } = await DistributedLock.getInstance().withLock(
      `${this.getPath(endpoint)}:${JSON.stringify(params)}`,
      () => this._request(endpoint, params, schema, timeout),
      {
        timeout: timeout ?? this.#timeout,
        ttl: (timeout ?? this.#timeout) * 2,
      }
    );
    return result;
  }

  private async _request<T>(
    endpoint: string,
    params: Record<
      string,
      string | number | boolean | (string | number)[]
    > = {},
    schema: z.ZodType<T>,
    timeout?: number
  ): Promise<ProwlarrApiResponse<T>> {
    const url = new URL(this.getPath(endpoint));
    const headers = this.#headers;

    // Create URLSearchParams and handle array parameters
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        // Handle array parameters by adding multiple entries with the same key
        value.forEach((item) => searchParams.append(key, String(item)));
      } else {
        // Handle non-array parameters
        searchParams.append(key, String(value));
      }
    }

    url.search = searchParams.toString();
    const response = await makeRequest(url.toString(), {
      method: 'GET',
      headers,
      timeout: timeout ?? this.#timeout,
    });

    const meta: ResponseMeta = {
      headers: Object.fromEntries(response.headers.entries()),
      status: response.status,
      statusText: response.statusText,
    };

    if (!response.ok) {
      try {
        throw new ProwlarrApiError(
          ProwlarrErrorSchema.parse(await response.json()).message,
          response.status,
          response.statusText
        );
      } catch (error) {
        throw new ProwlarrApiError(
          `Generic HTTP error: ${response.status} - ${response.statusText}`,
          response.status,
          response.statusText
        );
      }
    }

    const { success, data, error } = schema.safeParse(await response.json());

    if (!success) {
      throw new ProwlarrApiError(
        `Prowlarr API error: ${formatZodError(error)}`,
        response.status,
        response.statusText
      );
    }

    return {
      data,
      meta,
    };
  }
}

export default ProwlarrApi;
