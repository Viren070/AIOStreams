import { z } from 'zod';
import {
  Cache,
  DistributedLock,
  formatZodError,
  getSimpleTextHash,
  getTimeTakenSincePoint,
  createLogger,
  makeRequest,
  makeUrlLogSafe,
  parseXmlCompat,
} from '../../../utils/index.js';
import { config as appConfig } from '../../../config/index.js';
import type { Logger } from '../../../logging/logger.js';
import { searchWithBackgroundRefresh } from '../../utils/general.js';

// --- Generic Custom Error ---
export class NabApiError extends Error {
  constructor(
    public readonly code: number,
    public readonly description: string
  ) {
    super(`${description} (Error Code: ${code})`);
    this.name = 'NabApiError';
  }
}

// --- Zod Schemas ---
const convertString = z
  .string()
  .optional()
  .transform((val) => {
    if (val === 'yes') return true;
    if (val === 'no') return false;
    if (val && !Number.isNaN(Number(val))) return Number(val);
    return val;
  });

const NabSearchFunctionSchema = z
  .array(
    z.object({
      $: z.object({
        available: convertString,
        supportedParams: z
          .string()
          .transform((val) => val.split(','))
          .default([]),
      }),
    })
  )
  .transform((arr) => arr[0].$);
const NabCapsSearchingSchema = z
  .object({
    search: NabSearchFunctionSchema,
  })
  .catchall(NabSearchFunctionSchema);

const CapabilitiesSchema = z
  .object({
    caps: z.object({
      server: z.array(
        z.object({ $: z.object({ title: z.string().optional() }) })
      ),
      limits: z
        .array(
          z.object({
            $: z.object({ default: convertString, max: convertString }),
          })
        )
        .optional(),
      searching: z.array(NabCapsSearchingSchema),
    }),
  })
  .transform((obj) => ({
    server: obj.caps.server[0].$,
    limits: obj.caps.limits?.[0].$,
    searching: obj.caps.searching[0],
  }));
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

const AttributeSchema = z
  .object({ $: z.object({ name: z.string(), value: convertString }) })
  .transform((attr) => ({ [attr.$.name]: attr.$.value }));

type NabAttributes = Record<string, string | number | boolean | undefined>;

/**
 * Collapse `<ns:attr>` elements into a single object.
 */
const collapseAttributes = (
  attrs: NabAttributes[] | undefined
): NabAttributes =>
  attrs?.reduce<NabAttributes>((acc, attr) => {
    for (const key in attr) {
      const value = attr[key];
      if (value === '') continue;
      const previous = acc[key];
      acc[key] =
        typeof previous === 'string' && previous && typeof value === 'string'
          ? `${previous},${value}`
          : value;
    }
    return acc;
  }, {}) ?? {};

const GuidSchema = z
  .array(z.union([z.string(), z.object({ _: z.string().optional() })]))
  .optional()
  .transform((arr) => {
    const first = arr?.[0];
    return (typeof first === 'string' ? first : first?._) || undefined;
  });

// Create specific schemas for each namespace
const createTorznabItemSchema = () =>
  z
    .object({
      title: z.array(z.string()).transform((arr) => arr[0]),
      link: z
        .array(z.string())
        .optional()
        .transform((arr) => arr?.[0]),
      guid: GuidSchema,
      pubDate: z.array(z.string()).transform((arr) => arr[0]),
      jackettindexer: z
        .array(
          z.object({
            _: z.string(),
            $: z.object({ id: z.string() }),
          })
        )
        .optional()
        .transform((arr) =>
          arr?.[0] ? { name: arr[0]._, id: arr[0].$.id } : undefined
        ),
      type: z
        .array(z.string()) // usually "public", "semi-private" or "private" in Jackett responses
        .optional()
        .transform((arr) => arr?.[0]),
      size: z
        .array(z.string())
        .optional()
        .transform((arr) => (arr?.[0] ? Number(arr[0]) : undefined)),
      enclosure: z.array(
        z
          .object({
            $: z.object({
              url: z.string(),
              length: convertString,
              type: z.string(),
            }),
          })
          .transform((obj) => obj.$)
      ),
      'torznab:attr': z
        .array(AttributeSchema)
        .optional()
        .transform(collapseAttributes),
    })
    .transform((item) => ({
      title: item.title,
      link: item.link,
      guid: item.guid,
      pubDate: item.pubDate,
      jackettindexer: item.jackettindexer,
      type: item.type,
      size: item.size,
      enclosure: item.enclosure,
      torznab: item['torznab:attr'],
    }));

const createNewznabItemSchema = () =>
  z
    .object({
      title: z.array(z.string()).transform((arr) => arr[0]),
      link: z
        .array(z.string())
        .optional()
        .transform((arr) => arr?.[0]),
      guid: GuidSchema,
      pubDate: z.array(z.string()).transform((arr) => arr[0]),
      size: z
        .array(z.string())
        .optional()
        .transform((arr) => (arr?.[0] ? Number(arr[0]) : undefined)),
      prowlarrindexer: z
        .array(
          z.object({
            _: z.string(),
            $: z.object({ id: z.string() }),
          })
        )
        .optional()
        .transform((arr) =>
          arr?.[0] ? { name: arr[0]._, id: arr[0].$.id } : undefined
        ),
      enclosure: z.array(
        z
          .object({
            $: z.object({
              url: z.string(),
              length: convertString,
              type: z.string(),
            }),
          })
          .transform((obj) => obj.$)
      ),
      'newznab:attr': z
        .array(AttributeSchema)
        .optional()
        .transform(collapseAttributes),
    })
    .transform((item) => ({
      title: item.title,
      link: item.link,
      guid: item.guid,
      pubDate: item.pubDate,
      size: item.size,
      enclosure: item.enclosure,
      newznab: item['newznab:attr'],
      prowlarrindexer: item.prowlarrindexer,
    }));

// schema for response attributes (offset, total only)
const ResponseAttributeSchema = z
  .object({
    $: z.object({
      offset: convertString.optional(),
      total: convertString.optional(),
    }),
  })
  .transform((obj) => ({
    offset: obj.$.offset as number | undefined,
    total: obj.$.total as number | undefined,
  }));

// Type definitions for search result items
export type TorznabSearchResultItem = z.infer<
  ReturnType<typeof createTorznabItemSchema>
>;
export type NewznabSearchResultItem = z.infer<
  ReturnType<typeof createNewznabItemSchema>
>;

// Union type for all possible search result items
export type SearchResultItem<T extends 'torznab' | 'newznab'> =
  T extends 'torznab' ? TorznabSearchResultItem : NewznabSearchResultItem;

export type SearchResponse<T extends 'torznab' | 'newznab'> = {
  offset?: number;
  total?: number;
  results: SearchResultItem<T>[];
};

type RawSearchResponse = {
  offset?: number;
  total?: number;
  results: (TorznabSearchResultItem | NewznabSearchResultItem)[];
};

// --- Connection test ---
const NAB_TEST_TIMEOUT = 15000;

/** Newznab reserves 100-104 for credential/account rejections. */
const NAB_AUTH_ERROR_CODES = new Set([100, 101, 102, 103, 104]);

export type NabTestStage = 'caps' | 'auth' | 'search';

/** The id params the addon looks for before falling back to a title search. */
const NAB_ID_SEARCH_PARAMS = ['imdbid', 'tvdbid', 'tmdbid'];

export type NabTestResult = {
  ok: boolean;
  stage?: NabTestStage;
  server?: Capabilities['server'];
  limits?: Capabilities['limits'];
  searchModes?: string[];
  /** ID params actually usable per media type - movie-search/tv-search each advertise their own supportedParams, and one may support IDs while the other doesn't. */
  idSearchParams?: { movie: string[]; series: string[] };
  resultCount?: number;
  error?: { code?: number; message: string };
};

/**
 * Mirrors BaseNabAddon.getSearchFunction's matching: a keyword-matching
 * function (e.g. "movie"/"tv") if available, else the generic `search`.
 */
const findIdSearchParams = (
  searching: Capabilities['searching'],
  keyword: string
): string[] => {
  const key = Object.keys(searching).find((s) =>
    s.toLowerCase().includes(keyword)
  );
  const fn =
    (key && searching[key]?.available && searching[key]) ||
    (searching.search?.available && searching.search) ||
    undefined;
  return (fn?.supportedParams ?? []).filter((param) =>
    NAB_ID_SEARCH_PARAMS.includes(param)
  );
};

const resolveTestStage = (
  error: unknown,
  fallback: NabTestStage
): NabTestStage =>
  error instanceof NabApiError && NAB_AUTH_ERROR_CODES.has(error.code)
    ? 'auth'
    : fallback;

const describeTestError = (
  error: unknown
): { code?: number; message: string } => {
  if (error instanceof NabApiError) {
    return { code: error.code, message: error.description };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.startsWith('Failed to parse XML response') ||
    message.startsWith('Response validation failed')
  ) {
    return { message: 'The response was not a Newznab/Torznab API response' };
  }
  return { message };
};

// --- API Client Class ---
export class BaseNabApi<N extends 'torznab' | 'newznab'> {
  private readonly capabilitiesCache: Cache<string, Capabilities>;
  private readonly searchCache: Cache<string, SearchResponse<N>>;
  private readonly SearchResultSchema: z.ZodType<RawSearchResponse>;
  private readonly logger: Logger;
  private readonly params: Record<string, string>;
  private readonly userAgent: string;
  private readonly httpProxy: string | undefined;

  constructor(
    public readonly namespace: N,
    logger: Logger,
    private readonly baseUrl: string,
    private readonly apiKey?: string,
    private readonly apiPath: string = '/api',
    params: Record<string, string | number | boolean> = {}
  ) {
    this.logger = logger;
    this.baseUrl = this.removeTrailingSlash(baseUrl);
    this.apiPath = this.removeTrailingSlash(apiPath);
    this.params = Object.fromEntries(
      Object.entries(params).map(([key, value]) => [key, String(value)])
    );
    const apiPathUrl = new URL(this.baseUrl + this.apiPath);
    // append any search params from the apiPath to this.params
    if (apiPathUrl.search) {
      apiPathUrl.searchParams.forEach((value, key) => {
        if (!(key in this.params)) {
          this.params[key] = value;
        }
      });
      this.baseUrl = apiPathUrl.origin;
      this.apiPath = apiPathUrl.pathname;
    }
    this.capabilitiesCache = Cache.getInstance(`${namespace}:api:caps`);
    this.searchCache = Cache.getInstance(`${namespace}:api:search:v2`);
    this.userAgent =
      appConfig.builtins.nab.userAgent ?? appConfig.http.defaultUserAgent;
    this.httpProxy =
      appConfig.builtins.nab.httpProxy?.[namespace as 'torznab' | 'newznab'];

    // Create the appropriate schema based on namespace
    if (namespace === 'torznab') {
      this.SearchResultSchema = z
        .object({
          rss: z.object({
            channel: z.array(
              z.union([
                z.literal(''),
                z.object({
                  item: z
                    .array(createTorznabItemSchema())
                    .optional()
                    .default([]),
                  'torznab:response': z
                    .array(ResponseAttributeSchema)
                    .optional(),
                  'newznab:response': z
                    .array(ResponseAttributeSchema)
                    .optional(),
                  response: z.array(ResponseAttributeSchema).optional(),
                }),
              ])
            ),
          }),
        })
        .transform((data) => {
          const channel = data.rss.channel[0];
          const response =
            channel === ''
              ? undefined
              : (channel['torznab:response']?.[0] ??
                channel['newznab:response']?.[0] ??
                channel.response?.[0]);
          return {
            offset: response?.offset,
            total: response?.total,
            results: channel === '' ? [] : channel.item,
          };
        });
    } else {
      this.SearchResultSchema = z
        .object({
          rss: z.object({
            channel: z.array(
              z.union([
                z.literal(''),
                z.object({
                  item: z
                    .array(createNewznabItemSchema())
                    .optional()
                    .default([]),
                  'torznab:response': z
                    .array(ResponseAttributeSchema)
                    .optional(),
                  'newznab:response': z
                    .array(ResponseAttributeSchema)
                    .optional(),
                  response: z.array(ResponseAttributeSchema).optional(),
                }),
              ])
            ),
          }),
        })
        .transform((data) => {
          const channel = data.rss.channel[0];
          const response =
            channel === ''
              ? undefined
              : (channel['torznab:response']?.[0] ??
                channel['newznab:response']?.[0] ??
                channel.response?.[0]);
          return {
            offset: response?.offset,
            total: response?.total,
            results: channel === '' ? [] : channel.item,
          };
        });
    }
  }

  public async getCapabilities(): Promise<Capabilities> {
    const cacheKey = `${this.baseUrl}${this.apiPath}?t=caps&${JSON.stringify(this.params)}`;
    return this.capabilitiesCache.wrap(
      () => this.request('caps', CapabilitiesSchema, undefined, 3000),
      cacheKey,
      appConfig.builtins.nab.capabilitiesCacheTtl
    );
  }

  public async search(
    searchFunction: string = 'search',
    params: Record<string, string | number | boolean> = {}
  ): Promise<SearchResponse<N>> {
    const cacheKey = `${this.baseUrl}${this.apiPath}?t=${searchFunction}&${JSON.stringify(params)}&apikey=${this.apiKey ? getSimpleTextHash(this.apiKey) : ''}&${JSON.stringify(this.params)}`;

    return searchWithBackgroundRefresh({
      searchCache: this.searchCache as Cache<string, SearchResponse<N>>,
      searchCacheKey: cacheKey,
      bgCacheKey: `nab:${cacheKey}`,
      cacheTTL: appConfig.builtins.nab.searchCacheTtl,
      fetchFn: () =>
        this.request(
          searchFunction,
          this.SearchResultSchema,
          params
        ) as Promise<SearchResponse<N>>,
      isEmptyResult: (result) => result.results.length === 0,
      logger: this.logger,
    });
  }

  /**
   * Probe the endpoint.
   *
   * `caps` proves the url and api path; the bare `search` proves the api key,
   * since plenty of indexers serve caps without authenticating.
   */
  public async testConnection(): Promise<NabTestResult> {
    let capabilities: Capabilities;
    try {
      capabilities = await this._request(
        'caps',
        CapabilitiesSchema,
        undefined,
        NAB_TEST_TIMEOUT
      );
    } catch (error) {
      return {
        ok: false,
        stage: resolveTestStage(error, 'caps'),
        error: describeTestError(error),
      };
    }

    const available = Object.entries(capabilities.searching).filter(
      ([, fn]) => fn?.available === true
    );
    const details = {
      server: capabilities.server,
      limits: capabilities.limits,
      searchModes: available.map(([name]) => name),
      idSearchParams: {
        movie: findIdSearchParams(capabilities.searching, 'movie'),
        series: findIdSearchParams(capabilities.searching, 'tv'),
      },
    };

    try {
      const response = await this._request(
        'search',
        this.SearchResultSchema,
        { limit: 1 },
        NAB_TEST_TIMEOUT
      );
      return {
        ok: true,
        ...details,
        resultCount: response.total ?? response.results.length,
      };
    } catch (error) {
      return {
        ok: false,
        stage: resolveTestStage(error, 'search'),
        ...details,
        error: describeTestError(error),
      };
    }
  }

  private removeTrailingSlash = (path: string) =>
    path.endsWith('/') ? path.slice(0, -1) : path;

  private getHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/xml',
      Accept: 'application/rss+xml, text/rss+xml, application/xml, text/xml',
      'User-Agent': this.userAgent,
    };
    return headers;
  };

  private async request<T>(
    func: string,
    schema: z.ZodSchema<T>,
    params: Record<string, string | number | boolean> = {},
    timeout?: number
  ): Promise<T> {
    const lockKey = `${this.baseUrl}${this.apiPath}?t=${func}&${JSON.stringify(params)}&apikey=${this.apiKey ? getSimpleTextHash(this.apiKey) : ''}&${JSON.stringify(this.params)}`;
    const { result } = await DistributedLock.getInstance().withLock(
      lockKey,
      () => this._request(func, schema, params, timeout),
      {
        timeout: timeout ?? appConfig.builtins.nab.searchTimeout,
        ttl: (timeout ?? appConfig.builtins.nab.searchTimeout) + 1000,
      }
    );
    return result;
  }

  private async _request<T>(
    func: string,
    schema: z.ZodSchema<T>,
    params: Record<string, string | number | boolean> = {},
    timeout?: number
  ): Promise<T> {
    const start = Date.now();
    const url = new URL(`${this.baseUrl}${this.apiPath}`);
    const searchParams = new URLSearchParams({
      t: func,
      ...Object.fromEntries(
        Object.entries(params).map(([k, v]) => [k, String(v)])
      ),
    });
    for (const [key, value] of Object.entries(this.params)) {
      if (!searchParams.has(key)) {
        searchParams.set(key, value);
      }
    }
    if (this.apiKey) searchParams.set('apikey', this.apiKey);
    url.search = searchParams.toString();
    const urlString = url.toString();

    this.logger.info(
      `Making ${this.namespace} request to: ${makeUrlLogSafe(urlString)}`
    );

    try {
      const response = await makeRequest(urlString, {
        method: 'GET',
        headers: this.getHeaders(),
        timeout: timeout ?? appConfig.builtins.nab.searchTimeout,
        forceProxy: this.httpProxy,
        // `[newznab]`/`[torznab]` overrides apply on top of getHeaders()
        // (legacy nab.userAgent) inside makeRequest.
        context: this.namespace,
      });

      const data = await response.text();

      let result: any | null = null;
      let parseError: Error | null = null;
      try {
        result = parseXmlCompat(data);
      } catch (error) {
        parseError = error as Error;
      }

      if (result && result.error) {
        const code = parseInt(result.error.$.code, 10);
        const description = result.error.$.description;
        throw new NabApiError(code, description);
      }

      if (!response.ok) {
        throw new Error(`${response.status} - ${response.statusText}`);
      }

      if (parseError || !result) {
        this.logger.error(`Unexpected XML response: ${data}`);
        throw new Error(
          `Failed to parse XML response: ${parseError?.message ?? 'Unknown error'}`
        );
      }

      const parsedResult = schema.parse(result);
      this.logger.debug(
        `Completed ${this.namespace} request for ${makeUrlLogSafe(urlString)} in ${getTimeTakenSincePoint(start)}`
      );
      return parsedResult;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const message = `Response validation failed: ${formatZodError(error)}`;
        this.logger.error(`${this.namespace} ${message}`);
        throw new Error(message);
      }
      this.logger.error(`${this.namespace} request error: ${error}`);
      throw error;
    }
  }
}
