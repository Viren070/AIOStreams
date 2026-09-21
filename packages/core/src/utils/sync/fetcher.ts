import z from 'zod';
import { makeRequest } from '../http.js';
import { createLogger } from '../../logging/logger.js';
import { Cache } from '../cache.js';
import { config as appConfig } from '../../config/index.js';
import type { FetchResult, SyncFetcherConfig } from './types.js';

const logger = createLogger('sync');

/** Fetches, validates and caches one remote list. Holds no access policy. */
export class SyncFetcher<T extends Record<string, any>> {
  public readonly cache: Cache<string, { items: T[] }>;
  private readonly config: SyncFetcherConfig;

  /** Coalesces concurrent misses for one URL into a single upstream call. */
  private readonly inFlight = new Map<string, Promise<T[]>>();

  constructor(config: SyncFetcherConfig) {
    this.config = config;
    // Must outlive the process: a boot with the upstream down reads from here.
    this.cache = Cache.getInstance<string, { items: T[] }>(
      config.cacheKey,
      config.maxCacheSize,
      appConfig.bootstrap.redisUri ? undefined : 'sql'
    );
  }

  public async fetch(
    url: string,
    opts: { ttl: number; forceRefresh?: boolean }
  ): Promise<T[]> {
    if (!opts.forceRefresh) {
      const cached = await this.cache.get(url);
      if (cached) return cached.items;
    }
    return this.fetchCoalesced(url, opts.ttl);
  }

  public async fetchSettled(
    url: string,
    opts: { ttl: number }
  ): Promise<FetchResult<T>> {
    try {
      return { url, items: await this.fetch(url, opts) };
    } catch (error: any) {
      return { url, items: [], error: error.message };
    }
  }

  /** Whatever is already cached, without touching the network. */
  public async readCached(urls: string[]): Promise<Map<string, T[]>> {
    const found = new Map<string, T[]>();
    if (urls.length === 0) return found;
    const values = await this.cache.getMany(urls);
    urls.forEach((url, index) => {
      const cached = values[index];
      if (cached) found.set(url, cached.items);
    });
    return found;
  }

  /** Bypasses the cache on the way in, still writes through on the way out. */
  public async refetch(url: string, ttl: number): Promise<T[]> {
    return this.fetchCoalesced(url, ttl);
  }

  private fetchCoalesced(url: string, ttl: number): Promise<T[]> {
    const existing = this.inFlight.get(url);
    if (existing) return existing;

    const pending = this.fetchOnce(url)
      .then(async (items) => {
        // An empty list is a valid answer, so it is cached like any other.
        // `forceWrite`: the SQL backend buffers writes and cannot read its own
        // buffer, so without it a restart inside the flush window loses this.
        await this.cache.set(url, { items }, ttl, true);
        return items;
      })
      .finally(() => {
        this.inFlight.delete(url);
      });

    this.inFlight.set(url, pending);
    return pending;
  }

  private async fetchOnce(url: string): Promise<T[]> {
    logger.debug({ type: this.config.cacheKey, url }, 'fetching from URL');

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
      return valuesResult.data.values.map(
        (v) => this.config.convertValue(v) as T
      );
    }

    throw new Error(this.formatMismatch(data));
  }

  /** Format mismatch detection: give helpful error messages. */
  private formatMismatch(data: any): string {
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0];
      if (typeof first === 'object' && first !== null) {
        const keys = Object.keys(first);
        const mismatched = !this.config.itemSchema.safeParse(first).success;
        // Detect ranked-format data in a non-ranked slot
        if (
          keys.includes('expression') &&
          keys.includes('score') &&
          mismatched
        ) {
          return (
            `Format mismatch: URL returns ranked data ({expression, score}) but this section expects {values: string[]}. ` +
            `Did you put this URL in the wrong section? Try the Ranked section instead.`
          );
        }
        if (keys.includes('pattern') && keys.includes('score') && mismatched) {
          return (
            `Format mismatch: URL returns ranked data ({pattern, score}) but this section expects {values: string[]}. ` +
            `Did you put this URL in the wrong section? Try the Ranked section instead.`
          );
        }
        // Detect values-format data in a ranked slot
        if (keys.includes('values')) {
          return (
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
      return `Invalid format: 'values' field must be an array of strings.`;
    }
    return `Unexpected format from URL. Expected either an array of items or {values: string[]}. Got: ${JSON.stringify(data).slice(0, 200)}`;
  }
}
