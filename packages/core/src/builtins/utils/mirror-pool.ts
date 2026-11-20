import { z } from 'zod';
import { Cache } from '../../utils/cache.js';
import {
  createLogger,
  DistributedLock,
  formatZodError,
  makeRequest,
  parseRetryAfter,
  RateLimitedError,
  registerLockErrorClass,
} from '../../utils/index.js';
import type { Logger } from '../../logging/logger.js';

// a failing mirror is skipped for 5m, doubling per consecutive failure up to 24h
const BACKOFF_BASE_SECONDS = 5 * 60;
const BACKOFF_CAP_SECONDS = 24 * 60 * 60;

// it can escape getJson's lock when the last mirror is rate limited
registerLockErrorClass(RateLimitedError);

interface GetJsonOptions<T> {
  schema: z.ZodType<T>;
  headers: Record<string, string>;
  timeout: number;
}

interface MirrorState {
  failures: number;
  retryAt: number;
}

/**
 * Fetches JSON from a builtin's URLs in configured order, trying the ones that
 * recently failed last.
 */
export class MirrorPool {
  private static readonly pools = new Map<string, MirrorPool>();

  private readonly logger: Logger;
  private readonly state: Cache<string, MirrorState>;

  private constructor(
    private readonly id: string,
    private readonly getUrls: () => string[]
  ) {
    this.logger = createLogger(id);
    this.state = Cache.getInstance<string, MirrorState>(`${id}:mirror-pool`);
  }

  static for(id: string, getUrls: () => string[]): MirrorPool {
    let pool = MirrorPool.pools.get(id);
    if (!pool) {
      pool = new MirrorPool(id, getUrls);
      MirrorPool.pools.set(id, pool);
    }
    return pool;
  }

  /**
   * GETs `path` from each URL until one returns JSON matching `schema`. A 429
   * moves on without counting as a failure. Concurrent identical requests
   * share one fetch.
   */
  async getJson<T>(path: string, options: GetJsonOptions<T>): Promise<T> {
    const { timeout } = options;
    const { result } = await DistributedLock.getInstance().withLock(
      `${this.id}:${path}`,
      () => this.tryMirrors(path, options),
      { timeout, ttl: timeout + 1000 }
    );
    return result;
  }

  private async tryMirrors<T>(
    path: string,
    options: GetJsonOptions<T>
  ): Promise<T> {
    const { timeout } = options;
    const urls = [...new Set(this.getUrls())];
    if (urls.length === 1) {
      try {
        return await this.fetchJson(new URL(path, urls[0]), options);
      } catch (error) {
        this.logger.error(`Request to ${urls[0]} failed: ${message(error)}`);
        throw error;
      }
    }

    const states = await this.state.getMany(urls);
    const now = Date.now();
    const mirrors = urls.map((url, i) => ({ url, state: states[i] }));
    const isBackingOff = (m: (typeof mirrors)[number]) =>
      (m.state?.retryAt ?? 0) > now;
    const order = [
      ...mirrors.filter((m) => !isBackingOff(m)),
      ...mirrors
        .filter(isBackingOff)
        .sort((a, b) => a.state!.retryAt - b.state!.retryAt),
    ];

    const deadline = now + timeout;
    let lastError: unknown;
    for (const [i, { url, state }] of order.entries()) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const isLast = i === order.length - 1;
      // leave half for the rest, so one hanging mirror can't use it all up
      const attemptTimeout = isLast ? remaining : Math.floor(remaining / 2);
      try {
        const result = await this.fetchJson(new URL(path, url), {
          ...options,
          timeout: attemptTimeout,
        });
        if (state) await this.state.delete(url);
        return result;
      } catch (error) {
        lastError = error;
        const next = isLast ? '' : ', trying next mirror';
        if (error instanceof RateLimitedError) {
          this.logger.warn(`${url} is rate limited${next}`);
          continue;
        }
        const failures = (state?.failures ?? 0) + 1;
        const backoff = Math.min(
          BACKOFF_BASE_SECONDS * 2 ** (failures - 1),
          BACKOFF_CAP_SECONDS
        );
        this.logger.warn(
          `Request to ${url} failed (${failures}x, deprioritising it for ${backoff}s): ${message(error)}${next}`
        );
        // outlive the backoff, so the failure count survives until the retry
        await this.state.set(
          url,
          { failures, retryAt: Date.now() + backoff * 1000 },
          BACKOFF_CAP_SECONDS * 2
        );
      }
    }

    this.logger.error(`All ${order.length} ${this.id} mirrors failed`);
    throw lastError ?? new Error(`${this.id} request timed out`);
  }

  private async fetchJson<T>(url: URL, options: GetJsonOptions<T>): Promise<T> {
    this.logger.debug(`Making GET request to ${url.host}${url.pathname}`);
    const response = await makeRequest(url.toString(), {
      method: 'GET',
      headers: options.headers,
      timeout: options.timeout,
    });

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      // makeRequest returns a 429 as-is
      if (response.status === 429) {
        throw new RateLimitedError(
          parseRetryAfter(response.headers.get('retry-after')) ?? 1
        );
      }
      throw new Error(
        `${url.host} API error (${response.status}): ${response.statusText}`
      );
    }

    const data = (await response.json()) as unknown;
    try {
      return options.schema.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to parse ${url.host} API response: ${formatZodError(error as z.ZodError)}`
      );
    }
  }
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
