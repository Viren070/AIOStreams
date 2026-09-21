import {
  Cache,
  DistributedLock,
  getSimpleTextHash,
  getTimeTakenSincePoint,
  createLogger,
  makeRequest,
  makeUrlLogSafe,
  readBodyUpTo,
  registerLockErrorClass,
} from '../../../utils/index.js';
import { config as appConfig } from '../../../config/index.js';
import type { Logger } from '../../../logging/logger.js';
import { searchWithBackgroundRefresh } from '../../utils/general.js';
import {
  NabScanError,
  NabScanner,
  type NabAttrs,
  type NabAttrType,
  type NabCapsDocument,
  type NabEnclosure,
  type NabErrorDocument,
  type NabScanProfile,
  type NabSearchDocument,
  type NabSearchFunction,
  type NabTextField,
} from './scan.js';

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

// Concurrent identical searches share one request through DistributedLock;
// without this the waiters get a plain Error and lose the error code.
registerLockErrorClass(NabApiError);
registerLockErrorClass(NabScanError);

export type NabNamespace = 'torznab' | 'newznab';

export type Capabilities = {
  server: { title?: string };
  limits?: { default?: number; max?: number };
  searching: Record<string, NabSearchFunction>;
};

/**
 * What each namespace's addon actually reads off an item. The scanner is given
 * this and materialises nothing else, so the 8-25 attributes an `extended=1`
 * feed carries per item are never turned into strings, let alone cached.
 */
const TORZNAB_PROFILE: NabScanProfile = {
  attrElement: 'torznab:attr',
  fields: new Set<NabTextField>(['title', 'guid', 'pubDate', 'size', 'type']),
  indexers: new Set(['prowlarrindexer', 'jackettindexer'] as const),
  enclosureLength: false,
  attrs: new Map<string, NabAttrType>([
    ['language', 'string'],
    ['subs', 'string'],
    ['magneturl', 'string'],
    ['infohash', 'string'],
    ['seeders', 'number'],
    ['downloadvolumefactor', 'number'],
    ['size', 'number'],
  ]),
};

const NEWZNAB_PROFILE: NabScanProfile = {
  attrElement: 'newznab:attr',
  fields: new Set<NabTextField>(['title', 'pubDate', 'size']),
  indexers: new Set(['prowlarrindexer'] as const),
  enclosureLength: true,
  attrs: new Map<string, NabAttrType>([
    ['zyclopsHealth', 'string'],
    ['usenetdate', 'string'],
    ['language', 'string'],
    ['subs', 'string'],
    ['sourceIndexerName', 'string'],
    ['hydraIndexerName', 'string'],
    ['poster', 'string'],
    ['size', 'number'],
  ]),
};

interface NabSearchResultItemBase {
  title: string;
  /** Torznab only, but the base addon's duplicate-page check reads it. */
  guid?: string;
  pubDate?: string;
  size?: number;
  enclosure: NabEnclosure[];
  prowlarrindexer?: { name: string };
}

export interface TorznabSearchResultItem extends NabSearchResultItemBase {
  /** Usually "public", "semi-private" or "private" in Jackett responses. */
  type?: string;
  jackettindexer?: { name: string };
  torznab: NabAttrs;
}

export interface NewznabSearchResultItem extends NabSearchResultItemBase {
  newznab: NabAttrs;
}

// Union type for all possible search result items
export type SearchResultItem<T extends NabNamespace> = T extends 'torznab'
  ? TorznabSearchResultItem
  : NewznabSearchResultItem;

export type SearchResponse<T extends NabNamespace> = {
  offset?: number;
  total?: number;
  results: SearchResultItem<T>[];
  /** Results were left unread because of a size or count cap. */
  truncated?: true;
};

type NabRequestKind = 'caps' | 'search';

type NabRequestResult<
  N extends NabNamespace,
  K extends NabRequestKind,
> = K extends 'caps' ? Capabilities : SearchResponse<N>;

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
  if (error instanceof NabScanError) {
    return { message: 'The response was not a Newznab/Torznab API response' };
  }
  return { message };
};

// --- API Client Class ---
export class BaseNabApi<N extends NabNamespace> {
  private readonly capabilitiesCache: Cache<string, Capabilities>;
  private readonly searchCache: Cache<string, SearchResponse<N>>;
  private readonly profile: NabScanProfile;
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
    this.profile = namespace === 'torznab' ? TORZNAB_PROFILE : NEWZNAB_PROFILE;
    this.capabilitiesCache = Cache.getInstance(`${namespace}:api:caps`);
    // v3: the cached item shape is now the scanner's projection.
    this.searchCache = Cache.getInstance(`${namespace}:api:search:v3`);
    this.userAgent =
      appConfig.builtins.nab.userAgent ?? appConfig.http.defaultUserAgent;
    this.httpProxy =
      appConfig.builtins.nab.httpProxy?.[namespace as 'torznab' | 'newznab'];
  }

  public async getCapabilities(): Promise<Capabilities> {
    const cacheKey = `${this.baseUrl}${this.apiPath}?t=caps&${JSON.stringify(this.params)}`;
    return this.capabilitiesCache.wrap(
      () => this.request('caps', 'caps', undefined, 3000),
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
      fetchFn: () => this.request(searchFunction, 'search', params),
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
        'caps',
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
        'search',
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
      Accept: 'application/rss+xml, text/rss+xml, application/xml, text/xml',
      'User-Agent': this.userAgent,
    };
    return headers;
  };

  private async request<K extends NabRequestKind>(
    func: string,
    kind: K,
    params: Record<string, string | number | boolean> = {},
    timeout?: number
  ): Promise<NabRequestResult<N, K>> {
    const lockKey = `${this.baseUrl}${this.apiPath}?t=${func}&${JSON.stringify(params)}&apikey=${this.apiKey ? getSimpleTextHash(this.apiKey) : ''}&${JSON.stringify(this.params)}`;
    const { result } = await DistributedLock.getInstance().withLock(
      lockKey,
      () => this._request(func, kind, params, timeout),
      {
        timeout: timeout ?? appConfig.builtins.nab.searchTimeout,
        ttl: (timeout ?? appConfig.builtins.nab.searchTimeout) + 1000,
      }
    );
    return result;
  }

  private async _request<K extends NabRequestKind>(
    func: string,
    kind: K,
    params: Record<string, string | number | boolean> = {},
    timeout?: number
  ): Promise<NabRequestResult<N, K>> {
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

      const {
        body,
        bytes,
        truncated: bodyTruncated,
      } = await readBodyUpTo(response, appConfig.builtins.nab.maxResponseBytes);

      let document:
        | NabCapsDocument
        | NabSearchDocument
        | NabErrorDocument
        | undefined;
      let scanError: NabScanError | undefined;
      try {
        const scanner = new NabScanner(body);
        document =
          kind === 'caps'
            ? scanner.scanCaps()
            : await scanner.scanSearch(this.profile, {
                maxItems: appConfig.builtins.nab.maxResults,
              });
      } catch (error) {
        if (!(error instanceof NabScanError)) throw error;
        scanError = error;
      }

      // An API error document outranks the status code: plenty of indexers
      // return one with a 4xx, and its code is what callers act on.
      if (document?.kind === 'error') {
        throw new NabApiError(document.code, document.description);
      }

      if (!response.ok) {
        throw new Error(`${response.status} - ${response.statusText}`);
      }

      if (!document) {
        this.logger.error(
          `Unexpected ${this.namespace} response (${bytes} bytes, status ${response.status}): ${body.subarray(0, 500).toString('utf8')}`
        );
        throw new NabScanError(
          `Failed to parse XML response: ${scanError?.message ?? 'Unknown error'}`
        );
      }

      this.logger.debug(
        `Completed ${this.namespace} request for ${makeUrlLogSafe(urlString)} in ${getTimeTakenSincePoint(start)}`
      );

      if (document.kind === 'caps') {
        const { kind: _kind, ...capabilities } = document;
        return capabilities as NabRequestResult<N, K>;
      }

      const truncated = document.truncated || bodyTruncated;
      if (truncated) {
        this.logger.warn(
          `Truncated ${this.namespace} response for ${makeUrlLogSafe(urlString)}`,
          {
            bytes,
            bodyCapped: bodyTruncated,
            items: document.results.length,
            itemsCapped: document.truncated,
            total: document.total,
          }
        );
      }
      if (document.skipped) {
        this.logger.warn(
          `Skipped ${document.skipped} untitled ${this.namespace} results for ${makeUrlLogSafe(urlString)}`
        );
      }

      return {
        offset: document.offset,
        total: document.total,
        results: document.results.map(({ attrs, ...item }) => ({
          ...item,
          [this.namespace]: attrs,
        })),
        ...(truncated ? { truncated: true as const } : {}),
      } as NabRequestResult<N, K>;
    } catch (error) {
      this.logger.error(`${this.namespace} request error: ${error}`);
      throw error;
    }
  }
}
