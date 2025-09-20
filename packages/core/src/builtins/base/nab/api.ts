import { z } from 'zod';
import {
  Cache,
  DistributedLock,
  Env,
  formatZodError,
  getTimeTakenSincePoint,
  createLogger,
  makeRequest,
} from '../../../utils/index.js';
import { Parser } from 'xml2js';
import { Logger } from 'winston';

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
      server: z.array(z.object({ $: z.object({ title: z.string() }) })),
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

// Create specific schemas for each namespace
const createTorznabItemSchema = () =>
  z
    .object({
      title: z.array(z.string()).transform((arr) => arr[0]),
      link: z.array(z.string()).transform((arr) => arr[0]),
      guid: z
        .array(z.union([z.string(), z.object({ _: z.string() })]))
        .transform((arr) => (typeof arr[0] === 'string' ? arr[0] : arr[0]._)),
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
        .transform(
          (arr) => arr?.reduce((acc, attr) => ({ ...acc, ...attr }), {}) ?? {}
        ),
    })
    .transform((item) => ({
      title: item.title,
      link: item.link,
      guid: item.guid,
      pubDate: item.pubDate,
      jackettindexer: item.jackettindexer,
      size: item.size,
      enclosure: item.enclosure,
      torznab: item['torznab:attr'],
    }));

const createNewznabItemSchema = () =>
  z
    .object({
      title: z.array(z.string()).transform((arr) => arr[0]),
      link: z.array(z.string()).transform((arr) => arr[0]),
      guid: z
        .array(z.union([z.string(), z.object({ _: z.string() })]))
        .transform((arr) => (typeof arr[0] === 'string' ? arr[0] : arr[0]._)),
      pubDate: z.array(z.string()).transform((arr) => arr[0]),
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
      'newznab:attr': z
        .array(AttributeSchema)
        .optional()
        .transform(
          (arr) => arr?.reduce((acc, attr) => ({ ...acc, ...attr }), {}) ?? {}
        ),
    })
    .transform((item) => ({
      title: item.title,
      link: item.link,
      guid: item.guid,
      pubDate: item.pubDate,
      size: item.size,
      enclosure: item.enclosure,
      newznab: item['newznab:attr'],
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

// --- API Client Class ---
export class BaseNabApi<N extends 'torznab' | 'newznab'> {
  private readonly xmlParser: Parser;
  private readonly capabilitiesCache: Cache<string, Capabilities>;
  private readonly searchCache: Cache<string, SearchResultItem<N>[]>;
  private readonly SearchResultSchema: z.ZodType<any[]>;
  private readonly logger: Logger;

  constructor(
    public readonly namespace: N,
    logger: Logger,
    private readonly baseUrl: string,
    private readonly apiKey?: string,
    private readonly apiPath: string = '/api'
  ) {
    this.logger = logger;
    this.baseUrl = this.removeTrailingSlash(baseUrl);
    this.apiPath = this.removeTrailingSlash(apiPath);
    this.xmlParser = new Parser();
    this.capabilitiesCache = Cache.getInstance(`${namespace}:api:caps`);
    this.searchCache = Cache.getInstance(`${namespace}:api:search`);

    // Create the appropriate schema based on namespace
    if (namespace === 'torznab') {
      this.SearchResultSchema = z
        .object({
          rss: z.object({
            channel: z.array(
              z.object({
                item: z.array(createTorznabItemSchema()).optional().default([]),
              })
            ),
          }),
        })
        .transform((data) => data.rss.channel[0].item);
    } else {
      this.SearchResultSchema = z
        .object({
          rss: z.object({
            channel: z.array(
              z.object({
                item: z.array(createNewznabItemSchema()).optional().default([]),
              })
            ),
          }),
        })
        .transform((data) => data.rss.channel[0].item);
    }
  }

  public async getCapabilities(): Promise<Capabilities> {
    const cacheKey = `${this.baseUrl}${this.apiPath}?t=caps`;
    return this.capabilitiesCache.wrap(
      () => this.request('caps', CapabilitiesSchema, undefined, 3000),
      cacheKey,
      Env.BUILTIN_NAB_CAPABILITIES_CACHE_TTL
    );
  }

  public async search(
    searchFunction: string = 'search',
    params: Record<string, string | number | boolean> = {}
  ): Promise<SearchResultItem<N>[]> {
    const cacheKey = `${this.baseUrl}${this.apiPath}?t=${searchFunction}&${JSON.stringify(params)}&apikey=${this.apiKey}`;
    return this.searchCache.wrap(
      () => this.request(searchFunction, this.SearchResultSchema, params),
      cacheKey,
      Env.BUILTIN_NAB_SEARCH_CACHE_TTL
    );
  }

  private removeTrailingSlash = (path: string) =>
    path.endsWith('/') ? path.slice(0, -1) : path;
  private getHeaders = () => ({
    'Content-Type': 'application/xml',
    'User-Agent': Env.DEFAULT_USER_AGENT,
  });

  private async request<T>(
    func: string,
    schema: z.ZodSchema<T>,
    params: Record<string, string | number | boolean> = {},
    timeout?: number
  ): Promise<T> {
    const lockKey = `${this.baseUrl}${this.apiPath}?t=${func}&${JSON.stringify(params)}&apikey=${this.apiKey}`;
    const { result } = await DistributedLock.getInstance().withLock(
      lockKey,
      () => this._request(func, schema, params, timeout),
      {
        timeout: timeout ?? Env.BUILTIN_NAB_SEARCH_TIMEOUT,
        ttl: (timeout ?? Env.BUILTIN_NAB_SEARCH_TIMEOUT) + 1000,
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
    if (this.apiKey) searchParams.set('apikey', this.apiKey);
    url.search = searchParams.toString();
    const urlString = url.toString();

    this.logger.info(`Making ${this.namespace} request to: ${urlString}`);

    try {
      const response = await makeRequest(urlString, {
        method: 'GET',
        headers: this.getHeaders(),
        timeout: timeout ?? Env.BUILTIN_NAB_SEARCH_TIMEOUT,
      });

      const data = await response.text();

      let result: any | null = null;
      let parseError: Error | null = null;
      try {
        result = await this.xmlParser.parseStringPromise(data);
      } catch (error) {
        parseError = error as Error;
      }
      this.xmlParser.reset();

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
        `Completed ${this.namespace} request for ${urlString} in ${getTimeTakenSincePoint(start)}`
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
