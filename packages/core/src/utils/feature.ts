import z from 'zod';
import { UserData } from '../db/schemas.js';
import { Env } from './env.js';
import { makeRequest } from './http.js';
import { createLogger } from './logger.js';
import { Cache } from './cache.js';

const DEFAULT_REASON = 'Disabled by owner of the instance';

const logger = createLogger('core');

const refreshingUrls = new Set<string>();

async function refreshPatternsInBackground(url: string): Promise<void> {
  if (refreshingUrls.has(url)) return;
  refreshingUrls.add(url);

  try {
    const patterns = await fetchPatternsFromUrlInternal(url);
    if (patterns.length > 0) {
      FeatureControl.patternCache.set(
        url,
        { patterns },
        Env.ALLOWED_REGEX_PATTERNS_URLS_REFRESH_INTERVAL / 1000
      );
    }
  } catch (error) {
    logger.warn(`Background refresh failed for ${url}:`, error);
  } finally {
    refreshingUrls.delete(url);
  }
}

async function fetchPatternsFromUrl(url: string): Promise<{ name: string; pattern: string }[]> {
  const cached = await FeatureControl.patternCache.get(url);
  if (cached) {
    return cached.patterns;
  }

  const patterns = await fetchPatternsFromUrlInternal(url);
  if (patterns.length > 0) {
    await FeatureControl.patternCache.set(
      url,
      { patterns },
      Env.ALLOWED_REGEX_PATTERNS_URLS_REFRESH_INTERVAL / 1000
    );
  }
  return patterns;
}

async function fetchPatternsFromUrlInternal(
  url: string,
  attempt = 1
): Promise<{ name: string; pattern: string }[]> {
  const MAX_ATTEMPTS = 3;

  if (attempt === 1) {
    logger.debug(`Fetching regex patterns from ${url}`);
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
    const patterns = Array.isArray(parsedData)
      ? parsedData
      : parsedData.values.map((pattern) => ({ name: pattern, pattern: pattern }));

    return patterns;
  } catch (error: any) {
    const isLastAttempt = attempt >= MAX_ATTEMPTS;
    logger.warn(
      `Failed to fetch patterns from ${url} (attempt ${attempt}/${MAX_ATTEMPTS}): ${error.message}`
    );

    if (isLastAttempt) {
      logger.error(`Giving up on ${url} after ${MAX_ATTEMPTS} attempts.`);
      return [];
    }

    const delay = Math.pow(2, attempt - 1) * 1000;
    await new Promise((resolve) => setTimeout(resolve, delay));

    return fetchPatternsFromUrlInternal(url, attempt + 1);
  }
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

  public static patternCache = Cache.getInstance<string, { patterns: { name: string; pattern: string }[] }>(
    'regex-patterns',
    100,
    undefined
  );

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
        if (Env.ALLOWED_REGEX_PATTERNS_URLS_REFRESH_INTERVAL > 0) {
          this._refreshInterval = setInterval(
            () => this._refreshPatterns(),
            Env.ALLOWED_REGEX_PATTERNS_URLS_REFRESH_INTERVAL
          );
        }
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
      FeatureControl._addPatterns(patternsFromUrls.map((regex) => regex.pattern));
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
    return {
      ...this._patternState,
      urls: Env.ALLOWED_REGEX_PATTERNS_URLS || [],
    };
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

  public static async syncPatterns<T>(
    urls: string[] | undefined,
    existing: T[],
    userData: UserData,
    transform: (item: { name: string; pattern: string }) => T,
    uniqueKey: (item: T) => string
  ): Promise<T[]> {
    if (!urls?.length) return existing;

    const isUnrestricted =
      userData.trusted || Env.REGEX_FILTER_ACCESS === 'all';
    
    const validUrls = urls.filter(
      (url) => isUnrestricted || (Env.ALLOWED_REGEX_PATTERNS_URLS || []).includes(url)
    );

    if (!validUrls.length) return existing;

    const result = [...existing];
    const existingSet = new Set(existing.map(uniqueKey));

    const allPatterns = await Promise.all(
      validUrls.map((url) => this.getPatternsForUrl(url))
    );

    for (const regexes of allPatterns) {
      for (const regex of regexes) {
        const item = transform(regex);
        const key = uniqueKey(item);
        if (!existingSet.has(key)) {
          result.push(item);
          existingSet.add(key);
        }
      }
    }
    return result;
  }
}
