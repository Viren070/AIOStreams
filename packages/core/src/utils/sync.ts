import z from 'zod';
import { Env } from './env.js';
import { makeRequest } from './http.js';
import { createLogger } from './logger.js';
import { Cache } from './cache.js';

const logger = createLogger('core');

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
  /** Stale tolerance in seconds (0 = disabled) */
  staleTolerance: number;
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

  public readonly cache: Cache<string, { items: T[] }>;
  protected readonly config: SyncManagerConfig;

  constructor(config: SyncManagerConfig) {
    this.config = config;
    this.cache = Cache.getInstance<string, { items: T[] }>(
      config.cacheKey,
      config.maxCacheSize
    );
  }

  /**
   * Initialise the sync manager: perform initial fetch and start periodic refresh.
   */
  public initialise(): Promise<void> {
    if (!this._initialisationPromise) {
      this._initialisationPromise = this._refresh().then(() => {
        logger.info(
          `[${this.config.cacheKey}] Initialised with ${this._accumulatedKeys.size} items.`
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
      await this.cache.set(url, { items }, this.config.refreshInterval + this.config.staleTolerance);
    }
    return items;
  }

  /**
   * Fetch items from a URL, returning both items and any error.
   * Used by the API route to forward errors to the client.
   */
  public async fetchFromUrlWithError(url: string): Promise<FetchResult<T>> {
    try {
      const items = await this._fetchWithRetry(url);
      if (items.length > 0) {
        await this.cache.set(url, { items }, this.config.refreshInterval + this.config.staleTolerance);
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
   * Resolve items from the given URLs (after validation).
   * Adds URLs to the dynamic set for periodic refresh.
   */
  public async resolveItems(
    urls: string[] | undefined,
    userData?: { trusted?: boolean }
  ): Promise<T[]> {
    if (!urls?.length) return [];

    const validUrls = this.validateUrls(urls, userData);
    if (!validUrls.length) return [];

    for (const url of validUrls) {
      if (this._dynamicUrls.size >= 100) {
        const first = this._dynamicUrls.values().next().value;
        if (first) this._dynamicUrls.delete(first);
      }
      this._dynamicUrls.add(url);
    }

    const results = await Promise.all(
      validUrls.map((url) => this.fetchFromUrl(url))
    );

    return results.flat();
  }

  /**
   * Sync items from remote URLs into an existing local array.
   * Applies overrides (rename, re-score, disable) and deduplicates.
   *
   * @param urls      - URLs to fetch items from
   * @param existing  - The user's existing local items
   * @param userData  - User data for trust/access checks
   * @param transform - Convert a raw fetched item (with overrides applied) into the target type
   * @param uniqueKey - Extract a deduplication key from an existing item
   * @param overrides - User overrides to apply (disable, rename, re-score)
   */
  public async syncItems<U>(
    urls: string[] | undefined,
    existing: U[],
    userData: { trusted?: boolean },
    transform: (item: T) => U,
    uniqueKey: (item: U) => string,
    overrides?: SyncOverride[]
  ): Promise<U[]> {
    const items = await this.resolveItems(urls, userData);
    if (items.length === 0) return existing;

    const result = [...existing];
    const existingSet = new Set(existing.map(uniqueKey));

    for (const item of items) {
      const override = this._findOverride(item, overrides);

      if (override?.disabled) {
        continue;
      }

      const overriddenItem = override
        ? this._applyOverride(item, override)
        : item;

      const transformed = transform(overriddenItem);
      const key = uniqueKey(transformed);
      if (!existingSet.has(key)) {
        result.push(transformed);
        existingSet.add(key);
      }
    }

    return result;
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
        `[${this.config.cacheKey}] Accumulated ${newCount} new items. Total: ${this._accumulatedKeys.size}`
      );
    }
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  /**
   * Refresh items from all configured + dynamic URLs.
   */
  private async _refresh(): Promise<void> {
    const allUrls = [
      ...new Set([...this.config.configuredUrls, ...this._dynamicUrls]),
    ];

    if (allUrls.length === 0) return;

    logger.debug(
      `[${this.config.cacheKey}] Refreshing from ${allUrls.length} URLs...`
    );

    const results = await Promise.allSettled(
      allUrls.map((url) =>
        this._fetchWithRetry(url)
          .then((items) => {
            if (items.length > 0) {
              this.cache.set(url, { items }, this.config.refreshInterval + this.config.staleTolerance);
            }
            return items;
          })
          .catch((err) => {
            logger.error(
              `[${this.config.cacheKey}] Background refresh failed for ${url}: ${err.message}`
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
   * Fetch items from a URL with exponential backoff retry.
   */
  private async _fetchWithRetry(url: string, attempt = 1): Promise<T[]> {
    const MAX_ATTEMPTS = 2;

    if (attempt === 1) {
      logger.debug(`[${this.config.cacheKey}] Fetching from ${url}`);
    }

    try {
      const response = await makeRequest(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
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
      const isLastAttempt = attempt >= MAX_ATTEMPTS;
      logger.warn(
        `[${this.config.cacheKey}] Failed to fetch from ${url} (attempt ${attempt}/${MAX_ATTEMPTS}): ${error.message}`
      );

      if (isLastAttempt) {
        logger.error(
          `[${this.config.cacheKey}] Giving up on ${url} after ${MAX_ATTEMPTS} attempts.`
        );
        throw error;
      }

      const delay = Math.pow(2, attempt - 1) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));

      return this._fetchWithRetry(url, attempt + 1);
    }
  }

  /**
   * Convert a `values` string array into typed items using the config converter.
   */
  protected _convertValuesArray(values: string[]): T[] {
    return values.map((v) => this.config.convertValue(v) as T);
  }

  /**
   * Find a matching override for an item.
   */
  private _findOverride(
    item: T,
    overrides?: SyncOverride[]
  ): SyncOverride | undefined {
    if (!overrides?.length) return undefined;

    // Match by pattern/expression or by originalName
    const itemPattern = (item as any).pattern ?? (item as any).expression ?? '';
    const itemName = (item as any).name ?? '';

    return overrides.find(
      (o) =>
        o.pattern === itemPattern ||
        o.expression === itemPattern ||
        (itemName && o.originalName === itemName)
    );
  }

  /**
   * Apply an override to an item (rename, re-score).
   */
  private _applyOverride(item: T, override: SyncOverride): T {
    const result = { ...item };
    if (override.name !== undefined) {
      (result as any).name = override.name;
    }
    if (override.score !== undefined) {
      (result as any).score = override.score;
    }
    return result;
  }
}

// ─── Override Type ────────────────────────────────────────────────────────────

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
