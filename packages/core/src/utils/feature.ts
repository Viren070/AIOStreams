import z from 'zod';
import { UserData } from '../db/schemas.js';
import { Env } from './env.js';
import { makeRequest } from './http.js';
import { createLogger } from './logger.js';
import { Cache } from './cache.js';

const DEFAULT_REASON = 'Disabled by owner of the instance';

const logger = createLogger('core');

let remotePatternCache: Cache<string, string[]> | undefined;
if (Env.REDIS_URI) {
  remotePatternCache = Cache.getInstance('remote-pattern');
}

async function fetchPatternsFromUrl(url: string): Promise<string[]> {
  try {
    if (remotePatternCache) {
      await remotePatternCache.waitUntilReady();
      const cached = await remotePatternCache.get(url);
      if (cached) {
        return cached;
      }
    }
    const response = await makeRequest(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 1000,
    });
    if (!response.ok) {
      logger.error(
        `Failed to fetch allowed regex patterns from ${url}: ${response.status} ${response.statusText}`
      );
      return [];
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
      ? parsedData.map((item) => item.pattern)
      : parsedData.values;
    if (remotePatternCache) {
      await remotePatternCache.set(
        url,
        patterns,
        Math.floor(Env.ALLOWED_REGEX_PATTERNS_URLS_REFRESH_INTERVAL / 1000)
      );
    }
    return patterns;
  } catch (error) {
    logger.error(`Error fetching or parsing patterns from ${url}:`, error);
    return [];
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
        (result): result is PromiseFulfilledResult<string[]> =>
          result.status === 'fulfilled'
      )
      .flatMap((result) => result.value);

    if (patternsFromUrls.length > 0) {
      const initialCount = this._patternState.patterns.length;
      const allPatterns = [
        ...new Set([...this._patternState.patterns, ...patternsFromUrls]),
      ];
      this._patternState.patterns = allPatterns;
      const newCount = allPatterns.length - initialCount;
      if (newCount > 0) {
        logger.info(
          `Accumulated ${newCount} new regex patterns from URLs. Total: ${allPatterns.length}`
        );
      }
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
}
