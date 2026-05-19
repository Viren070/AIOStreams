import z from 'zod';
import { makeRequest } from './http.js';
import { createLogger } from '../logging/logger.js';
import { Cache } from './cache.js';

const logger = createLogger('sync');

/**
 * Configuration for a SyncManager instance.
 */
export interface SyncManagerConfig {
  /** Unique cache key prefix for this manager */
  cacheKey: string;
  /** Max items in the cache */
  maxCacheSize: number;
  /** Refresh interval in seconds (0 = no refresh) */
  refreshInterval: number;
  /** Statically configured URLs from env vars */
  configuredUrls: string[];
  /** Zod schema to validate items fetched from URLs */
  itemSchema: z.ZodType<any>;
  /** Extract the unique key string from a raw fetched item */
  itemKey: (item: any) => string;
  /** Convert a plain string from a `values` array into a typed item */
  convertValue: (value: string) => any;
}

/**
 * A raw item as fetched from a sync URL.
 * All sync URLs must return either:
 *   - An array of objects matching the itemSchema
 *   - An object with a `values` array of strings
 */
export type RawSyncItem =
  | { name: string; pattern: string; score?: number }
  | {
      expression: string;
      name?: string;
      score?: number;
    };

/**
 * Result of fetching items from a single URL, including any error.
 */
export interface FetchResult<T> {
  url: string;
  items: T[];
  error?: string;
}

/**
 * Base class for managing synced items from remote URLs.
 * Handles fetching, caching, periodic refresh, accumulation, and override logic.
 */
export class SyncManager<T extends Record<string, any>> {
  private _initialisationPromise: Promise<void> | null = null;
  private _refreshInterval: ReturnType<typeof setInterval> | null = null;
  private _dynamicUrls = new Set<string>();
  private _accumulatedKeys = new Set<string>();
  private _allowedUrls = new Set<string>();

  public readonly cache: Cache<string, { items: T[] }>;
  protected readonly config: SyncManagerConfig;

  /**
   * Cache TTL is set to max(3× refresh interval, 24 hours) so that if a
   * scheduled refresh fails, the previously-cached data survives and
   * continues to be served during normal usage. Minimum 24 hours ensures
   * sufficient buffer even for short refresh intervals.
   */
  private readonly _cacheTTL: number;

  constructor(config: SyncManagerConfig) {
    this.config = config;
    this._cacheTTL =
      config.refreshInterval > 0
        ? Math.max(config.refreshInterval * 3, 86400)
        : 86400;
    this.cache = Cache.getInstance<string, { items: T[] }>(
      config.cacheKey,
      config.maxCacheSize
    );
    this._allowedUrls = new Set(config.configuredUrls);
  }

  /**
   * Initialise the sync manager: perform initial fetch and start periodic refresh.
   */
  public initialise(): Promise<void> {
    if (!this._initialisationPromise) {
      this._initialisationPromise = this._refresh().then(() => {
        logger.info(
          {
            items: this._accumulatedKeys.size,
            type: this.config.cacheKey,
            refreshInterval: this.config.refreshInterval,
          },
          `initialised sync manager`
        );
        if (this.config.refreshInterval > 0) {
          this._refreshInterval = setInterval(
            () => this._refresh(),
            this.config.refreshInterval * 1000
          );
        }
      });
    }
    return this._initialisationPromise;
  }

  /**
   * Clean up resources (clear refresh interval).
   */
  public cleanup(): void {
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = null;
    }
  }

  /**
   * Fetch items from a single URL with caching and retry.
   */
  public async fetchFromUrl(url: string, forceRefresh = false): Promise<T[]> {
    if (!forceRefresh) {
      const cached = await this.cache.get(url);
      if (cached) {
        return cached.items;
      }
    }

    const items = await this._fetchWithRetry(url);
    if (items.length > 0) {
      await this.cache.set(url, { items }, this._cacheTTL);
    }
    return items;
  }

  /**
   * Fetch items from a URL, returning both items and any error.
   * Used by the API route to forward errors to the client.
   */
  public async fetchFromUrlWithError(url: string): Promise<FetchResult<T>> {
    try {
      const cached = await this.cache.get(url);
      if (cached) {
        return { url, items: cached.items };
      }
      const items = await this._fetchWithRetry(url);
      if (items.length > 0) {
        await this.cache.set(url, { items }, this._cacheTTL);
      }
      return { url, items };
    } catch (error: any) {
      return { url, items: [], error: error.message };
    }
  }

  /**
   * Validate URLs against the whitelist and user trust level.
   * Subclasses override this to implement their own access logic.
   */
  public validateUrls(
    urls: string[],
    _userData?: { trusted?: boolean }
  ): string[] {
    return urls.filter((url) => this.config.configuredUrls.includes(url));
  }

  /**
   * Get all accumulated item keys (used for whitelist checks).
   */
  public get accumulatedKeys(): Set<string> {
    return this._accumulatedKeys;
  }

  /**
   * Add items to the accumulated set.
   */
  public addItems(items: T[]): void {
    const initialCount = this._accumulatedKeys.size;
    for (const item of items) {
      this._accumulatedKeys.add(this.config.itemKey(item));
    }
    const newCount = this._accumulatedKeys.size - initialCount;
    if (newCount > 0) {
      logger.info(
        {
          newCount,
          total: this._accumulatedKeys.size,
          type: this.config.cacheKey,
        },
        `accumulated new items`
      );
    }
  }

  /**
   * Add URLs to the allowed list.
   * URLs added this way are considered trusted and can be used for syncing.
   */
  public addAllowedUrls(urls: string[]): void {
    const initialCount = this._allowedUrls.size;
    for (const url of urls) {
      if (this.isValidUrl(url)) {
        this._allowedUrls.add(url);
      } else {
        logger.warn(
          { url, type: this.config.cacheKey },
          'skipping invalid URL'
        );
      }
    }
    const newCount = this._allowedUrls.size - initialCount;
    if (newCount > 0) {
      logger.info(
        { newCount, total: this._allowedUrls.size, type: this.config.cacheKey },
        `added ${newCount} new allowed URLs`
      );
    }
  }

  /**
   * Get all allowed URLs (configured + dynamically added).
   */
  public get allowedUrls(): string[] {
    return Array.from(this._allowedUrls);
  }

  /**
   * Check if a URL is valid.
   */
  public isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Check if a URL is in the allowed list.
   */
  public isAllowedUrl(url: string): boolean {
    return this._allowedUrls.has(url);
  }

  /**
   * Refresh items from all configured + dynamic URLs.
   */
  private async _refresh(): Promise<void> {
    const allUrls = [
      ...new Set([...this.config.configuredUrls, ...this._dynamicUrls]),
    ];

    if (allUrls.length === 0) return;

    logger.debug(
      { count: allUrls.length, type: this.config.cacheKey },
      'refresh started for all URLs'
    );

    const results = await Promise.allSettled(
      allUrls.map((url) =>
        this._fetchWithRetry(url)
          .then((items) => {
            if (items.length > 0) {
              this.cache.set(url, { items }, this._cacheTTL);
            }
            return items;
          })
          .catch((err) => {
            logger.error(
              { url, type: this.config.cacheKey, error: err.message },
              'background refresh failed'
            );
            return [] as T[];
          })
      )
    );

    const items = results
      .filter((r): r is PromiseFulfilledResult<T[]> => r.status === 'fulfilled')
      .flatMap((r) => r.value);

    if (items.length > 0) {
      this.addItems(items);
    }
  }

  /**
   * Fetch items from a URL.
   */
  private async _fetchWithRetry(url: string): Promise<T[]> {
    logger.debug(
      {
        type: this.config.cacheKey,
        url,
      },
      'fetching from URL'
    );

    try {
      const response = await makeRequest(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      });

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} ${response.statusText} during sync of ${url}`
        );
      }

      const data = await response.json();

      // Try parsing as array of items first
      const arrayResult = z.array(this.config.itemSchema).safeParse(data);
      if (arrayResult.success) {
        return arrayResult.data as T[];
      }

      // Try parsing as { values: string[] }
      const valuesResult = z
        .object({ values: z.array(z.string()) })
        .safeParse(data);
      if (valuesResult.success) {
        return this._convertValuesArray(valuesResult.data.values);
      }

      // Format mismatch detection: give helpful error messages
      if (Array.isArray(data) && data.length > 0) {
        const first = data[0];
        if (typeof first === 'object' && first !== null) {
          const keys = Object.keys(first);
          // Detect ranked-format data in a non-ranked slot
          if (
            keys.includes('expression') &&
            keys.includes('score') &&
            !this.config.itemSchema.safeParse(first).success
          ) {
            throw new Error(
              `Format mismatch: URL returns ranked data ({expression, score}) but this section expects {values: string[]}. ` +
                `Did you put this URL in the wrong section? Try the Ranked section instead.`
            );
          }
          if (
            keys.includes('pattern') &&
            keys.includes('score') &&
            !this.config.itemSchema.safeParse(first).success
          ) {
            throw new Error(
              `Format mismatch: URL returns ranked data ({pattern, score}) but this section expects {values: string[]}. ` +
                `Did you put this URL in the wrong section? Try the Ranked section instead.`
            );
          }
          // Detect values-format data in a ranked slot
          if (keys.includes('values')) {
            throw new Error(
              `Format mismatch: URL returns simple data ({values: string[]}) but this section expects [{expression, score}]. ` +
                `Did you put this URL in the wrong section? Try the Required/Excluded/Included/Preferred section instead.`
            );
          }
        }
      }
      if (
        typeof data === 'object' &&
        data !== null &&
        'values' in data &&
        !Array.isArray(data.values)
      ) {
        throw new Error(
          `Invalid format: 'values' field must be an array of strings.`
        );
      }

      throw new Error(
        `Unexpected format from URL. Expected either an array of items or {values: string[]}. Got: ${JSON.stringify(data).slice(0, 200)}`
      );
    } catch (error: any) {
      logger.error(
        { url, type: this.config.cacheKey, error: error.message },
        'failed to fetch from URL'
      );
      throw error;
    }
  }

  /**
   * Convert a `values` string array into typed items using the config converter.
   */
  protected _convertValuesArray(values: string[]): T[] {
    return values.map((v) => this.config.convertValue(v) as T);
  }
}

export interface SyncOverride {
  /** For regex overrides */
  pattern?: string;
  /** For SEL overrides */
  expression?: string;
  name?: string;
  score?: number;
  originalName?: string;
  /** Extracted names from SEL expression comments, used for matching */
  exprNames?: string[];
  disabled?: boolean;
}

/** Parse a `<SYNCED: url>` placeholder, returning the URL or null. */
export function parseSyncedUrl(value: string): string | null {
  if (!value.startsWith('<SYNCED: ') || !value.endsWith('>')) return null;
  const url = value.slice(9, -1).trim();
  return url.length > 0 ? url : null;
}
