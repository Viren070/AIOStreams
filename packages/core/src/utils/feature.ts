import z from 'zod';
import { UserData } from '../db/schemas.js';
import { Env } from './env.js';
import { makeRequest } from './http.js';
import { createLogger } from './logger.js';
import { Cache } from './cache.js';

const DEFAULT_REASON = 'Disabled by owner of the instance';

const logger = createLogger('core');

let remotePatternCache: Cache<string, { name: string; pattern: string }[]> | undefined;
if (Env.REDIS_URI) {
  remotePatternCache = Cache.getInstance('remote-pattern');
}

const inMemoryPatternCache = new Map<
  string,
  { patterns: { name: string; pattern: string }[]; expiresAt: number }
>();
const refreshingUrls = new Set<string>();

async function refreshPatternsInBackground(url: string): Promise<void> {
  if (refreshingUrls.has(url)) return;
  refreshingUrls.add(url);

  try {
    const patterns = await fetchPatternsFromUrlInternal(url);
    if (patterns.length > 0) {
      inMemoryPatternCache.set(url, {
        patterns,
        expiresAt: Date.now() + Env.ALLOWED_REGEX_PATTERNS_URLS_REFRESH_INTERVAL,
      });
    }
  } catch (error) {
    logger.warn(`Background refresh failed for ${url}:`, error);
  } finally {
    refreshingUrls.delete(url);
  }
}

async function fetchPatternsFromUrl(url: string): Promise<{ name: string; pattern: string }[]> {
  if (!remotePatternCache) {
    const memCached = inMemoryPatternCache.get(url);
    if (memCached) {
      if (memCached.expiresAt <= Date.now()) {
        refreshPatternsInBackground(url);
      }
      return memCached.patterns;
    }
    const patterns = await fetchPatternsFromUrlInternal(url);
    if (patterns.length > 0) {
      inMemoryPatternCache.set(url, {
        patterns,
        expiresAt: Date.now() + Env.ALLOWED_REGEX_PATTERNS_URLS_REFRESH_INTERVAL,
      });
    }
    return patterns;
  }
  return fetchPatternsFromUrlInternal(url);
}

async function fetchPatternsFromUrlInternal(url: string): Promise<{ name: string; pattern: string }[]> {
  const ttlMs = Env.ALLOWED_REGEX_PATTERNS_URLS_REFRESH_INTERVAL;

  let patterns: { name: string; pattern: string }[] | undefined;
  for (let i = 0; i < 3; i++) {
    logger.debug(
      `Fetching allowed regex patterns from ${url}${i > 0 ? ` (attempt ${i + 1} of 3)` : ''}`
    );
    try {
      if (remotePatternCache) {
        await remotePatternCache.waitUntilReady();
        const cached = await remotePatternCache.get(url);
        if (cached) {
          patterns = cached;
          break;
        }
      }
      const response = await makeRequest(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      });
      if (!response.ok) {
        logger.error(
          `Failed to fetch allowed regex patterns from ${url}: ${response.status} ${response.statusText}`
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      const schema = z.union([
        z.array(
          z.object({
            name: z.string(),
            pattern: z.string(),
          })
        ),
        z.object({
          values: z.array(z.string()),
        }),
      ]);
      const data = await response.json();
      const parsedData = schema.parse(data);
      patterns = Array.isArray(parsedData)
        ? parsedData
        : parsedData.values.map((p) => ({ name: p, pattern: p }));

      // Cache the result
      if (remotePatternCache) {
        await remotePatternCache.set(url, patterns, Math.floor(ttlMs / 1000));
      } else {
        inMemoryPatternCache.set(url, {
          patterns,
          expiresAt: Date.now() + ttlMs,
        });
      }
      break;
    } catch (error) {
      logger.error(`Error fetching or parsing patterns from ${url}:`, error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
  }
  if (!patterns) {
    logger.error(
      `Exhausted all attempts to fetch patterns from ${url}, will retry on next interval`
    );
    return [];
  }
  return patterns;
}

export class FeatureControl {
  private static _patternState: {
    patterns: string[];
    description?: string;
  } = {
    patterns: Env.ALLOWED_REGEX_PATTERNS || [],
    description: Env.ALLOWED_REGEX_PATTERNS_DESCRIPTION,
  };
  private static _initialisationPromise: Promise<void> | null = null;
  private static _refreshInterval: NodeJS.Timeout | null = null;

  /**
   * Initialises the FeatureControl service, performing the initial pattern fetch
   * and setting up periodic refreshes.
   */
  public static initialise() {
    if (!this._initialisationPromise) {
      this._initialisationPromise = this._refreshPatterns().then(() => {
        logger.info(
          `Initialised with ${this._patternState.patterns.length} regex patterns.`
        );
        this._refreshInterval = setInterval(
          () => this._refreshPatterns(),
          Env.ALLOWED_REGEX_PATTERNS_URLS_REFRESH_INTERVAL
        );
      });
    }
    return this._initialisationPromise;
  }

  /**
   * Cleans up resources for graceful shutdown.
   */
  public static cleanup() {
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = null;
    }
  }

  public static _addPatterns(patterns: string[]): void {
    const initialCount = this._patternState.patterns.length;
    const allPatterns = [
      ...new Set([...this._patternState.patterns, ...patterns]),
    ];
    this._patternState.patterns = allPatterns;
    const newCount = allPatterns.length - initialCount;
    if (newCount > 0) {
      logger.info(
        `Accumulated ${newCount} new regex patterns. Total: ${allPatterns.length}`
      );
    }
  }

  /**
   * Fetches patterns from all configured URLs and accumulates them.
   */
  private static async _refreshPatterns(): Promise<void> {
    const urls = Env.ALLOWED_REGEX_PATTERNS_URLS;
    if (!urls || urls.length === 0) {
      return;
    }

    logger.debug(`Refreshing regex patterns from ${urls.length} URLs...`);
    const fetchPromises = await Promise.allSettled(
      urls.map(fetchPatternsFromUrl)
    );

    const patternsFromUrls = fetchPromises
      .filter(
        (result): result is PromiseFulfilledResult<{ name: string; pattern: string }[]> =>
          result.status === 'fulfilled'
      )
      .flatMap((result) => result.value);

    if (patternsFromUrls.length > 0) {
      FeatureControl._addPatterns(patternsFromUrls.map((p) => p.pattern));
    }
  }

  private static readonly _disabledHosts: Map<string, string> = (() => {
    const map = new Map<string, string>();
    if (Env.DISABLED_HOSTS) {
      for (const disabledHost of Env.DISABLED_HOSTS.split(',')) {
        const [host, reason] = disabledHost.split(':');
        map.set(host, reason || DEFAULT_REASON);
      }
    }
    return map;
  })();

  private static readonly _disabledAddons: Map<string, string> = (() => {
    const map = new Map<string, string>();
    if (Env.DISABLED_ADDONS) {
      for (const disabledAddon of Env.DISABLED_ADDONS.split(',')) {
        const [addon, reason] = disabledAddon.split(':');
        map.set(addon, reason || DEFAULT_REASON);
      }
    }
    return map;
  })();

  private static readonly _disabledServices: Map<string, string> = (() => {
    const map = new Map<string, string>();
    if (Env.DISABLED_SERVICES) {
      for (const disabledService of Env.DISABLED_SERVICES.split(',')) {
        const [service, reason] = disabledService.split(':');
        map.set(service, reason || DEFAULT_REASON);
      }
    }
    return map;
  })();

  public static readonly regexFilterAccess: 'none' | 'trusted' | 'all' =
    Env.REGEX_FILTER_ACCESS;

  public static get disabledHosts() {
    return this._disabledHosts;
  }

  public static get disabledAddons() {
    return this._disabledAddons;
  }

  public static get disabledServices() {
    return this._disabledServices;
  }

  public static async allowedRegexPatterns() {
    await this.initialise();
    return this._patternState;
  }

  public static async isRegexAllowed(userData: UserData, regexes?: string[]) {
    const { patterns } = await this.allowedRegexPatterns();
    if (regexes && regexes.length > 0) {
      const areAllRegexesAllowed = regexes.every((regex) =>
        patterns.includes(regex)
      );
      if (areAllRegexesAllowed) {
        return true;
      }
    }
    switch (this.regexFilterAccess) {
      case 'trusted':
        return userData.trusted ?? false;
      case 'all':
        return true;
      default:
        return false;
    }
  }

  public static async getPatternsForUrl(
    url: string
  ): Promise<{ name: string; pattern: string }[]> {
    return fetchPatternsFromUrl(url);
  }
}
