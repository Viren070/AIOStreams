/**
 * Easynews Search API Client
 *
 * Unofficial client that mimics the Easynews webapp behavior to search
 * and generate NZB download URLs. Uses HTTP Basic Auth for authentication.
 */

import { z } from 'zod';
import {
  Cache,
  createLogger,
  formatZodError,
  makeRequest,
  DistributedLock,
} from '../../utils/index.js';
import { config as appConfig } from '../../config/index.js';
import { searchWithBackgroundRefresh } from '../utils/general.js';
import { VIDEO_FILE_EXTENSIONS } from '../../debrid/utils.js';
import { parseDuration } from '../../parser/utils.js';
import bytes from 'bytes';
import pLimit, { type LimitFunction } from 'p-limit';

const logger = createLogger('easynews');

export type EasynewsApiVersion = '2.0' | '3.0';

/**
 * Easynews serves at most two concurrent searches per account on the 2.0
 * endpoint. The 3.0 endpoint is not limited, but it is fenced by the same counter: while two 2.0
 * requests are in flight, a 3.0 request is stalled too, so any 2.0 use pins the
 * whole account to the lower limit.
 */
const SEARCH_CONCURRENCY: Record<EasynewsApiVersion, number> = {
  '2.0': 2,
  '3.0': 10,
};

/**
 * The cap follows the account rather than the IP, so one limiter per account
 * covers every request made with those credentials, across queries, pages and
 * background refreshes.
 */
interface AccountSearchLimit {
  limit: LimitFunction;
  versions: Set<EasynewsApiVersion>;
}

const searchLimits = new Map<string, AccountSearchLimit>();

function getSearchLimit(
  account: string,
  apiVersion: EasynewsApiVersion
): LimitFunction {
  let entry = searchLimits.get(account);
  if (!entry) {
    entry = {
      limit: pLimit(SEARCH_CONCURRENCY[apiVersion]),
      versions: new Set(),
    };
    searchLimits.set(account, entry);
  }
  entry.versions.add(apiVersion);

  const concurrency = entry.versions.has('2.0')
    ? SEARCH_CONCURRENCY['2.0']
    : SEARCH_CONCURRENCY['3.0'];
  if (entry.limit.concurrency !== concurrency) {
    entry.limit.concurrency = concurrency;
  }
  return entry.limit;
}

export const EASYNEWS_BASE = 'https://members.easynews.com';
// Page size for the 2.0 API. The 3.0 API ignores page-size params entirely
// and always returns 100 items per page.
export const EASYNEWS_DEFAULT_PER_PAGE = 250;

/**
 * Search result item from Easynews API
 */
export interface EasynewsSearchItem {
  /** Unique hash identifier for the file */
  hash: string;
  /** 3 char id */
  id?: string;
  /** Filename without extension */
  filename: string;
  /** File extension (e.g., 'mkv', 'mp4') */
  ext: string;
  /** Signature for NZB generation (optional) */
  sig?: string;
  /** File size in bytes */
  size: number;
  /** Title/subject of the post */
  title: string;
  /** Poster name */
  poster?: string;
  /** Post date (unix timestamp or date string) */
  posted?: string | number;
  /** Video duration in seconds */
  duration?: number;
  /** Audio track language codes, e.g. ['eng','spa'] (from audio_tracks/alangs/alang) */
  audioLangs?: string[];
  /** Subtitle track language codes (from subtitle_tracks/slangs/slang) */
  subLangs?: string[];
  /** Raw audio codec reported by Easynews, e.g. 'EAC3','AC3','AAC','DCA' */
  acodec?: string;
  /** Raw video codec reported by Easynews, e.g. 'H264','HEVC','AVC1','XVID' */
  vcodec?: string;
  /** Horizontal resolution in pixels, e.g. 1920 */
  xres?: number;
  /** Vertical resolution in pixels, e.g. 1080 */
  yres?: number;
  /** Overall bitrate in bits/sec */
  bps?: number;
}

/**
 * Download server info from Easynews
 */
export interface EasynewsDownloadInfo {
  /** Download farm identifier */
  dlFarm: string;
  /** Download port */
  dlPort: string;
  /** Download URL base */
  downURL: string;
}

/**
 * Complete search response with results and download info
 */
export interface EasynewsSearchResult {
  /** Search result items */
  results: EasynewsSearchItem[];
  /** Download server info */
  downloadInfo: EasynewsDownloadInfo;
}

/**
 * Raw search response from Easynews API
 */
const EasynewsSearchResponseSchema = z.object({
  data: z.array(z.union([z.array(z.any()), z.record(z.string(), z.any())])),
  results: z.number().optional(),
  returned: z.number().optional(),
  numPages: z.number().optional(),
  page: z.number().optional(),
  perPage: z.union([z.string(), z.number()]).optional(),
  thumbURL: z.string().optional(),
  thumbUrl: z.string().optional(),
  dlFarm: z.union([z.string(), z.number()]).optional(),
  dlPort: z.union([z.string(), z.number()]).optional(),
  downURL: z.string().optional(),
});

type EasynewsSearchResponse = z.infer<typeof EasynewsSearchResponseSchema>;

/**
 * Internal parsed response with metadata
 */
interface ParsedSearchResponse {
  items: EasynewsSearchItem[];
  totalResults?: number;
  numPages?: number;
  currentPage: number;
  downloadInfo: EasynewsDownloadInfo;
}

/**
 * Search options
 */
export interface EasynewsSearchOptions {
  query: string;
  page?: number;
  perPage?: number;
  paginate?: boolean;
}

/**
 * NZB generation parameters - data needed to generate an NZB from Easynews
 */
export const EasynewsNzbParamsSchema = z.object({
  hash: z.string(),
  filename: z.string(),
  ext: z.string(),
  sig: z.string().optional(),
});

export type EasynewsNzbParams = z.infer<typeof EasynewsNzbParamsSchema>;

/**
 * Easynews auth credentials schema
 */
export const EasynewsAuthSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export type EasynewsAuth = z.infer<typeof EasynewsAuthSchema>;

/**
 * Easynews API Error
 */
export class EasynewsApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly statusText?: string
  ) {
    super(message);
    this.name = 'EasynewsApiError';
  }
}

/**
 * Minimum duration in seconds to filter out samples
 */
const MIN_DURATION_SECONDS = 60;

/**
 * Retries for an empty response body. Easynews only drops requests that are
 * over its concurrency cap, so the limiter should keep this from triggering.
 */
const EMPTY_RESPONSE_RETRIES = 1;
const EMPTY_RESPONSE_RETRY_DELAY = 500;

/**
 * Easynews API client
 */
export class EasynewsApi {
  private readonly auth: string;
  private readonly encodedAuth: string;
  private readonly searchCache = Cache.getInstance<
    string,
    EasynewsSearchResult
  >('easynews:search');

  private skipReasons = new Map<string, string[]>();

  constructor(
    username: string,
    password: string,
    private readonly apiVersion: EasynewsApiVersion = '3.0'
  ) {
    // HTTP Basic Auth header
    this.auth = Buffer.from(`${username}:${password}`).toString('base64');

    // Base64url encode auth for NZB URL generation
    this.encodedAuth = Buffer.from(
      JSON.stringify({ username, password })
    ).toString('base64url');

    // Registered up front so a 2.0 client pins the account's cap even while it
    // is idle and only a 3.0 client is searching.
    getSearchLimit(this.auth, this.apiVersion);
  }

  /**
   * Log reasons summary
   */
  private logSkipReasons(): void {
    if (this.skipReasons.size === 0) {
      return;
    }

    const reasonLabels: Record<string, string> = {
      invalid: 'Invalid (missing hash/ext)',
      password: 'Password-protected',
      extension: 'Non-video extension',
      duration: 'Too short duration',
      sample: 'Sample file detected',
    };

    const summary: string[] = [];
    let totalSkipped = 0;

    for (const [reason, items] of this.skipReasons.entries()) {
      const label = reasonLabels[reason] || reason;
      const count = items.length;
      totalSkipped += count;
      summary.push(`  ${label}: ${count}`);
      for (const item of items) {
        summary.push(`    - ${item}`);
      }
    }

    if (totalSkipped > 0) {
      logger.debug(`Skipped ${totalSkipped} items:\n${summary.join('\n')}`);
    }

    // Clear for next search
    this.skipReasons.clear();
  }

  /**
   * Search for content with optional pagination
   * Returns results along with download server info
   */
  async search(options: EasynewsSearchOptions): Promise<EasynewsSearchResult> {
    const cacheKey = JSON.stringify({
      ...options,
      apiVersion: this.apiVersion,
    });

    return searchWithBackgroundRefresh({
      searchCache: this.searchCache,
      searchCacheKey: cacheKey,
      bgCacheKey: `easynews:${cacheKey}`,
      cacheTTL: appConfig.builtins.easynews.searchCacheTtl,
      fetchFn: () => this.performSearchWithPagination(options),
      isEmptyResult: (result) => result.results.length === 0,
      logger,
    });
  }

  /**
   * Perform search with concurrent pagination
   */
  private async performSearchWithPagination(
    options: EasynewsSearchOptions
  ): Promise<EasynewsSearchResult> {
    const { paginate = false, perPage = EASYNEWS_DEFAULT_PER_PAGE } = options;
    const maxPages = appConfig.builtins.easynews.maxPages;

    // Fetch first page to get metadata
    const firstPage = await this.performSearch({
      ...options,
      page: 1,
      perPage,
    });

    if (!paginate) {
      this.logSkipReasons();
      return {
        results: firstPage.items,
        downloadInfo: firstPage.downloadInfo,
      };
    }

    // Determine how many pages to fetch
    const totalPages = firstPage.numPages ?? 1;
    const pagesToFetch = Math.min(totalPages, maxPages);

    logger.debug('Pagination info', {
      totalResults: firstPage.totalResults,
      totalPages,
      pagesToFetch,
      firstPageResults: firstPage.items.length,
    });

    // If only one page, return first page results
    if (pagesToFetch <= 1) {
      this.logSkipReasons();
      return {
        results: firstPage.items,
        downloadInfo: firstPage.downloadInfo,
      };
    }

    // Fetch remaining pages concurrently
    const remainingPages = Array.from(
      { length: pagesToFetch - 1 },
      (_, i) => i + 2
    );

    const pagePromises = remainingPages.map((page) =>
      this.performSearch({ ...options, page, perPage })
    );

    const settledResults = await Promise.allSettled(pagePromises);

    // Combine all results and deduplicate
    const allItems = [...firstPage.items];
    const seenHashes = new Set(firstPage.items.map((item) => item.hash));

    for (const [index, result] of settledResults.entries()) {
      if (result.status === 'fulfilled') {
        for (const item of result.value.items) {
          if (!seenHashes.has(item.hash)) {
            seenHashes.add(item.hash);
            allItems.push(item);
          }
        }
      } else {
        logger.warn(`Failed to fetch page`, {
          page: remainingPages[index] + 1,
          reason: result.reason,
        });
      }
    }

    const successfulPages =
      1 + settledResults.filter((r) => r.status === 'fulfilled').length;

    logger.info('Completed paginated search', {
      totalResults: allItems.length,
      pagesSearched: pagesToFetch,
      successfulPages,
    });

    this.logSkipReasons();

    return {
      results: allItems,
      downloadInfo: firstPage.downloadInfo,
    };
  }

  /**
   * Perform the actual search request for a single page
   */
  private async performSearch(
    options: EasynewsSearchOptions
  ): Promise<ParsedSearchResponse> {
    const { query, page = 1, perPage = EASYNEWS_DEFAULT_PER_PAGE } = options;

    const params = new URLSearchParams({
      gps: query, // keyword query
      pno: page.toString(), // page number
      u: '1', // server-side dedupe of identical posts (webapp always sends it)
      safeO: '0', // safe search off
      s1: 'relevance', // primary sort (server appends s2=nrfile, s3=dsize)
      s1d: '-', // descending
      'fty[]': 'VIDEO', // file type filter
    });
    if (this.apiVersion === '3.0') {
      // The 3.0 API ignores all page-size params (pby/dni are no-ops): pages
      // are fixed at 100 items and numPages reflects that.
    } else {
      params.set('pby', perPage.toString()); // page size
      // fly=2 selects the JSON response format, sb=1 marks a
      // search-button submission, st=basic is the plain keyword search mode,
      // chxu/chxgx are legacy checkbox states, vv adds video preview data.
      params.set('fly', '2');
      params.set('sb', '1');
      params.set('st', 'basic');
      params.set('chxu', '1');
      params.set('chxgx', '1');
      params.set('vv', '1');
    }

    const url =
      this.apiVersion === '3.0'
        ? `${EASYNEWS_BASE}/3.0/api/search?${params.toString()}`
        : `${EASYNEWS_BASE}/2.0/search/solr-search/?${params.toString()}`;
    const lockKey = `easynews-search:${url}`;

    const { result } = await DistributedLock.getInstance().withLock(
      lockKey,
      () =>
        getSearchLimit(
          this.auth,
          this.apiVersion
        )(() => this._performSearch(query, page, perPage, url)),
      {
        timeout: appConfig.builtins.easynews.searchTimeout,
        ttl: appConfig.builtins.easynews.searchTimeout + 1000,
      }
    );
    return result;
  }

  private async _performSearch(
    query: string,
    page: number,
    perPage: number,
    url: string
  ): Promise<ParsedSearchResponse> {
    logger.debug(`Searching Easynews page ${page} for: ${query}`);

    for (let attempt = 1; ; attempt++) {
      const result = await this._searchOnce(url);
      if (result) {
        return result;
      }
      if (attempt > EMPTY_RESPONSE_RETRIES) {
        throw new EasynewsApiError('Easynews returned an empty response');
      }
      logger.warn('Easynews returned an empty response, retrying', {
        query,
        page,
        attempt,
      });
      await new Promise((resolve) =>
        setTimeout(resolve, EMPTY_RESPONSE_RETRY_DELAY)
      );
    }
  }

  /**
   * A single search request. Resolves to null when Easynews answers with an
   * empty body.
   */
  private async _searchOnce(url: string): Promise<ParsedSearchResponse | null> {
    try {
      const response = await makeRequest(url, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${this.auth}`,
          Accept: 'application/json, text/javascript, */*; q=0.9',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: appConfig.builtins.easynews.searchTimeout,
      });

      if (response.status === 401 || response.status === 403) {
        throw new EasynewsApiError(
          'Authentication failed - check username/password',
          response.status,
          response.statusText
        );
      }

      if (!response.ok) {
        throw new EasynewsApiError(
          `Search failed: HTTP ${response.status}`,
          response.status,
          response.statusText
        );
      }

      let json;
      const raw = await response.text();
      if (raw.length === 0) {
        return null;
      }
      try {
        json = JSON.parse(raw);
      } catch (error) {
        throw new EasynewsApiError(
          `Invalid JSON response from API: ${raw.length > 50 ? raw.slice(0, 50) + '...' : raw}`
        );
      }
      const parsed = EasynewsSearchResponseSchema.safeParse(json);

      if (!parsed.success) {
        logger.warn(
          `Failed to parse Easynews response: ${formatZodError(parsed.error)}`
        );
        throw new EasynewsApiError('Invalid API response format');
      }

      return this.parseSearchResponse(parsed.data);
    } catch (error) {
      if (error instanceof EasynewsApiError) {
        throw error;
      }
      throw new EasynewsApiError(
        `Search request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Parse raw search response into structured format with metadata
   */
  private parseSearchResponse(
    response: EasynewsSearchResponse
  ): ParsedSearchResponse {
    const items: EasynewsSearchItem[] = [];

    for (const raw of response.data) {
      const item = this.parseItem(raw);
      if (item) {
        items.push(item);
      }
    }

    return {
      items,
      totalResults: response.results,
      numPages: response.numPages,
      currentPage: response.page ?? 1,
      downloadInfo: {
        dlFarm: String(response.dlFarm ?? 'auto'),
        dlPort: String(response.dlPort ?? 'auto'),
        downURL: response.downURL ?? `${EASYNEWS_BASE}/dl`,
      },
    };
  }

  /**
   * Parse a single search result item
   */
  private parseItem(raw: unknown): EasynewsSearchItem | null {
    let hash: string | null = null;
    let id: string | null = null;
    let subject: string | null = null;
    let filenameNoExt: string | null = null;
    let ext: string | null = null;
    let size: number = 0;
    let poster: string | null = null;
    let postedRaw: string | number | null = null;
    let sig: string | null = null;
    let displayFn: string | null = null;
    let durationRaw: number | string | null = null;
    let audioLangs: string[] = [];
    let subLangs: string[] = [];
    let acodec: string | undefined;
    let vcodec: string | undefined;
    let xres: number | undefined;
    let yres: number | undefined;
    let bps: number | undefined;

    const parseSize = (size: unknown): number | undefined => {
      if (typeof size === 'number') return size;
      if (typeof size === 'string') {
        return bytes.parse(size) ?? undefined;
      }
      return undefined;
    };

    const toLangArray = (v: unknown): string[] => {
      if (Array.isArray(v)) {
        return v.filter((x): x is string => typeof x === 'string');
      }
      if (typeof v === 'string') {
        return v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      return [];
    };
    const numOrUndef = (v: unknown): number | undefined => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (
        typeof v === 'string' &&
        v.trim() !== '' &&
        Number.isFinite(Number(v))
      )
        return Number(v);
      return undefined;
    };
    const strOrUndef = (v: unknown): string | undefined =>
      typeof v === 'string' && v.trim() !== '' ? v : undefined;

    if (Array.isArray(raw)) {
      if (raw.length >= 12) {
        hash = raw[0];
        subject = raw[6];
        filenameNoExt = raw[10];
        ext = raw[11];
      }
      if (raw.length > 4) size = parseSize(raw[4]) || 0;
      if (raw.length > 7) poster = raw[7];
      if (raw.length > 8) postedRaw = raw[8];
      if (raw.length > 14) durationRaw = raw[14];
    } else if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      // hash field contains the full hash, "0" also has it.
      hash = String(obj['hash'] ?? obj['0'] ?? obj['id'] ?? '');
      // 4-char suffix appended to the hash in direct download URLs; guard
      // against a missing value becoming the literal string "undefined".
      id = obj['id'] != null ? String(obj['id']) : null;
      subject = String(obj['subject'] ?? obj['6'] ?? '');
      // fn = 10
      filenameNoExt = String(obj['fn'] ?? obj['10'] ?? '');
      // extension field has dot prefix (e.g., ".mkv"), "11" is same
      ext = String(obj['extension'] ?? obj['ext'] ?? obj['11'] ?? '');
      // rawSize/size are in bytes, "4" is human readable string
      size = parseSize(obj['rawSize'] ?? obj['size'] ?? obj['4']) || 0;
      poster = obj['poster']
        ? String(obj['poster'])
        : obj['7']
          ? String(obj['7'])
          : null;
      // ts/timestamp is unix timestamp, "5" is formatted date string
      postedRaw = (obj['ts'] ?? obj['timestamp'] ?? obj['5'] ?? null) as
        | string
        | number
        | null;
      sig = obj['sig'] ? String(obj['sig']) : null;
      displayFn = obj['fn'] ? String(obj['fn']) : null;
      // runtime is in seconds, "14" is formatted string (e.g., "2h:22m:54s")
      durationRaw = (obj['runtime'] ?? obj['14'] ?? null) as
        | number
        | string
        | null;
      const firstNonEmpty = (...vals: unknown[]): string[] => {
        for (const v of vals) {
          const arr = toLangArray(v);
          if (arr.length) return arr;
        }
        return [];
      };
      audioLangs = firstNonEmpty(
        obj['audio_tracks'],
        obj['alangs'],
        obj['alang']
      );
      subLangs = firstNonEmpty(
        obj['subtitle_tracks'],
        obj['slangs'],
        obj['slang']
      );
      acodec = strOrUndef(obj['acodec']);
      vcodec = strOrUndef(obj['vcodec']);
      xres = numOrUndef(obj['xres']);
      yres = numOrUndef(obj['yres']);
      bps = numOrUndef(obj['bps']);
    }

    if (!hash || !ext) {
      this.skipReasons.set(
        'invalid',
        (this.skipReasons.get('invalid') || []).concat(JSON.stringify(raw))
      );
      return null;
    }

    // Filter by extension
    const extLower = ext.replace(/^\./, '').toLowerCase();
    if (!VIDEO_FILE_EXTENSIONS.includes(`.${extLower}`)) {
      this.skipReasons.set(
        'extension',
        (this.skipReasons.get('extension') || []).concat(
          `${filenameNoExt || hash} (.${extLower})`
        )
      );
      return null;
    }

    // Parse duration
    const duration =
      typeof durationRaw === 'number'
        ? durationRaw
        : parseDuration(String(durationRaw || ''), 's');

    // Filter samples by duration
    if (duration !== undefined && duration < MIN_DURATION_SECONDS) {
      this.skipReasons.set(
        'duration',
        (this.skipReasons.get('duration') || []).concat(
          `${filenameNoExt} (${durationRaw} parsed as ${duration}s)`
        )
      );
      return null;
    }
    // if the word sample appears in the second half of the filename, skip it
    const indexOfSample = (filenameNoExt || '').toLowerCase().indexOf('sample');
    if (indexOfSample >= 0) {
      const halfway = Math.floor((filenameNoExt || '').length / 2);
      if (indexOfSample >= halfway) {
        this.skipReasons.set(
          'sample',
          (this.skipReasons.get('sample') || []).concat(filenameNoExt || hash)
        );
        return null;
      }
    }
    // Build title
    let title: string;
    if (displayFn) {
      const cleaned = displayFn.trim();
      const sanitized = cleaned.replace(/ - /g, '-').split(' ').join('.');
      title = ext.startsWith('.')
        ? `${sanitized}${ext}`
        : `${sanitized}.${ext}`;
    } else {
      title = this.normalizeTitle(subject || `${filenameNoExt}${ext}`);
    }

    return {
      hash,
      id: id || undefined,
      filename: filenameNoExt || '',
      ext: extLower,
      sig: sig || undefined,
      size,
      title,
      poster: poster || undefined,
      posted: postedRaw ?? undefined,
      duration,
      audioLangs: audioLangs.length ? audioLangs : undefined,
      subLangs: subLangs.length ? subLangs : undefined,
      acodec,
      vcodec,
      xres,
      yres,
      bps,
    };
  }

  /**
   * Normalize title - extract clean title from subject
   */
  private normalizeTitle(raw: string): string {
    if (!raw) return raw;
    const text = raw.trim();

    // Try to extract title from parentheses (common pattern)
    const matches = text.match(/\(([^()]*)\)/g);
    if (matches && matches.length > 0) {
      for (let i = matches.length - 1; i >= 0; i--) {
        const candidate = matches[i].slice(1, -1).trim();
        if (candidate) return candidate;
      }
    }

    return text;
  }

  /**
   * Generate NZB parameters for an item - to be used with the endpoint
   */
  generateNzbParams(item: EasynewsSearchItem): EasynewsNzbParams {
    return {
      hash: item.hash,
      filename: item.filename,
      ext: item.ext,
      sig: item.sig,
    };
  }

  generateEasynewsDlUrl(
    item: EasynewsSearchItem,
    downloadInfo: EasynewsDownloadInfo
  ): string {
    return `${downloadInfo.downURL}/${downloadInfo.dlFarm}/${downloadInfo.dlPort}/${item.hash}${item.id}.${item.ext}/${item.filename}.${item.ext}`;
  }

  /**
   * Generate the internal NZB endpoint URL
   * This URL points to our server which will fetch and serve the NZB
   *
   * URL format: /builtins/easynews/nzb/:encodedAuth/:encodedParams/:aiostreamsAuth?/:filename
   *
   * @param item - Search item to generate URL for
   * @param baseUrl - Base URL of the server
   * @param aiostreamsAuth - Optional AIOStreams auth for admin bypass (base64url encoded "username:password")
   */
  generateNzbUrl(
    item: EasynewsSearchItem,
    baseUrl: string,
    aiostreamsAuth?: string
  ): string {
    const params = this.generateNzbParams(item);
    const encodedParams = Buffer.from(JSON.stringify(params)).toString(
      'base64url'
    );
    const filename = encodeURIComponent(`${item.filename}.${item.ext}.nzb`);

    // Build URL with optional aiostreamsAuth for bypass
    const authPart = aiostreamsAuth ? `/${aiostreamsAuth}` : '';
    return `${baseUrl}/builtins/easynews/nzb/${this.encodedAuth}/${encodedParams}${authPart}/${filename}`;
  }

  /**
   * Fetch NZB content from Easynews
   * Makes a POST request to the dl-nzb endpoint and returns the NZB data
   */
  async fetchNzb(params: EasynewsNzbParams): Promise<{
    content: Buffer;
    filename: string;
  }> {
    // Build the value token: "{hash}|{b64(filename)}:{b64(ext)}"
    const fnB64 = Buffer.from(params.filename)
      .toString('base64')
      .replace(/=/g, '');
    const extB64 = Buffer.from(params.ext).toString('base64').replace(/=/g, '');
    const valueToken = `${params.hash}|${fnB64}:${extB64}`;
    const filename = `${params.filename}.${params.ext}.nzb`;

    // Build form data
    const formParams = new URLSearchParams();
    formParams.set('autoNZB', '1');
    formParams.set(params.sig ? '0&sig=' + params.sig : '0', valueToken);

    const url = `${EASYNEWS_BASE}/2.0/api/dl-nzb`;
    logger.debug({ url, hash: params.hash }, 'fetching nzb from easynews');

    const response = await makeRequest(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/x-nzb, */*',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: formParams.toString(),
      timeout: appConfig.builtins.easynews.searchTimeout,
    });

    if (response.status === 401 || response.status === 403) {
      throw new EasynewsApiError(
        'Authentication failed - check username/password',
        response.status,
        response.statusText
      );
    }

    if (!response.ok) {
      throw new EasynewsApiError(
        `NZB fetch failed: HTTP ${response.status}`,
        response.status,
        response.statusText
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (!buffer.includes('<segment')) {
      throw new EasynewsApiError(
        'Easynews returned an empty NZB (no segments)'
      );
    }

    return { content: buffer, filename };
  }

  /**
   * Calculate age in hours from posted date
   */
  calculateAge(posted: string | number | undefined): number {
    if (!posted) return 0;

    let date: Date;
    if (typeof posted === 'number') {
      date = new Date(posted * 1000);
    } else {
      date = new Date(posted);
    }

    if (isNaN(date.getTime())) return 0;

    const ageMs = Date.now() - date.getTime();
    return Math.max(0, Math.ceil(ageMs / (1000 * 60 * 60)));
  }
}

export default EasynewsApi;
