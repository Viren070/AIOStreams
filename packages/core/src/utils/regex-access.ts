import z from 'zod';
import { UserData } from '../db/schemas.js';
import { Env } from './env.js';
import { SyncManager, type SyncOverride, type FetchResult } from './sync.js';
import { createLogger } from './logger.js';

const logger = createLogger('core');

/**
 * Schema for a regex pattern item fetched from a sync URL.
 */
const RegexPatternSchema = z.object({
  name: z.string().optional(),
  pattern: z.string(),
  score: z.number().optional(),
});

export type RegexPatternItem = z.infer<typeof RegexPatternSchema> & {
  name: string;
};

/**
 * Manages regex pattern whitelisting, access control, and URL syncing.
 *
 * Access model:
 *   - `REGEX_FILTER_ACCESS = 'all'`     → anyone can use any regex / sync from any URL
 *   - `REGEX_FILTER_ACCESS = 'trusted'`  → trusted users can use any regex; others are limited to whitelisted patterns
 *   - `REGEX_FILTER_ACCESS = 'none'`     → no one can use regex (except whitelisted patterns)
 */
export class RegexAccess {
  private static _instance: SyncManager<RegexPatternItem>;
  private static _whitelistedPatterns: string[] = [];
  private static _description?: string;

  /**
   * Get or create the singleton SyncManager instance.
   */
  private static get manager(): SyncManager<RegexPatternItem> {
    if (!this._instance) {
      this._whitelistedPatterns =
        Env.WHITELISTED_REGEX_PATTERNS ?? Env.ALLOWED_REGEX_PATTERNS ?? [];
      this._description =
        Env.WHITELISTED_REGEX_PATTERNS_DESCRIPTION ??
        Env.ALLOWED_REGEX_PATTERNS_DESCRIPTION;

      const configuredUrls =
        Env.WHITELISTED_REGEX_PATTERNS_URLS ??
        Env.ALLOWED_REGEX_PATTERNS_URLS ??
        [];

      // WHITELISTED_SYNC_REFRESH_INTERVAL (seconds), fallback to old ms value converted to seconds
      const refreshInterval =
        Env.WHITELISTED_SYNC_REFRESH_INTERVAL ??
        Math.floor(Env.ALLOWED_REGEX_PATTERNS_URLS_REFRESH_INTERVAL / 1000);

      const staleTolerance = Env.WHITELISTED_SYNC_STALE_TOLERANCE;

      this._instance = new SyncManager<RegexPatternItem>({
        cacheKey: 'regex-patterns',
        maxCacheSize: 100,
        refreshInterval,
        staleTolerance,
        configuredUrls,
        itemSchema: RegexPatternSchema,
        itemKey: (item) => item.pattern,
        convertValue: (v) => ({ name: v, pattern: v }),
      });
    }
    return this._instance;
  }

  /**
   * Initialise the regex access service.
   */
  public static initialise(): Promise<void> {
    // Seed the manager with statically configured patterns
    if (this._whitelistedPatterns.length > 0 || !this._instance) {
      // Ensure manager is created
      const mgr = this.manager;
      if (this._whitelistedPatterns.length > 0) {
        mgr.addItems(
          this._whitelistedPatterns.map((p) => ({ name: p, pattern: p }))
        );
      }
    }
    return this.manager.initialise();
  }

  /**
   * Clean up resources.
   */
  public static cleanup(): void {
    this.manager.cleanup();
  }

  /**
   * Add patterns to the accumulated whitelist.
   * Used by templates to register regex patterns that should be allowed
   * (any pattern in an instance-owner template is automatically trusted).
   */
  public static addPatterns(patterns: string[]): void {
    this.manager.addItems(patterns.map((pattern) => ({ pattern, name: '' })));
  }

  /**
   * Check if a user is allowed to use regex filters.
   * If specific regexes are provided, checks if they're all in the whitelist.
   */
  public static async isRegexAllowed(
    userData: UserData,
    regexes?: string[]
  ): Promise<boolean> {
    await this.initialise();

    // If specific patterns are provided, check if all are whitelisted
    if (regexes && regexes.length > 0) {
      const whitelisted = this.manager.accumulatedKeys;
      const allWhitelisted = regexes.every((r) => whitelisted.has(r));
      if (allWhitelisted) return true;
    }

    switch (Env.REGEX_FILTER_ACCESS) {
      case 'trusted':
        return userData.trusted ?? false;
      case 'all':
        return true;
      default:
        return false;
    }
  }

  /**
   * Get the whitelisted regex patterns info (for status endpoint).
   */
  public static async allowedRegexPatterns(): Promise<{
    patterns: string[];
    description?: string;
    urls: string[];
  }> {
    await this.initialise();
    return {
      patterns: [...this.manager.accumulatedKeys],
      description: this._description,
      urls:
        Env.WHITELISTED_REGEX_PATTERNS_URLS ??
        Env.ALLOWED_REGEX_PATTERNS_URLS ??
        [],
    };
  }

  /**
   * Validate sync URLs based on access level and user trust.
   * - `all`     → any URL allowed
   * - `trusted` → trusted users can use any URL; others limited to configured URLs
   * - `none`    → only configured URLs
   */
  public static validateUrls(urls: string[], userData?: UserData): string[] {
    const isUnrestricted =
      Env.REGEX_FILTER_ACCESS === 'all' ||
      (Env.REGEX_FILTER_ACCESS === 'trusted' && userData?.trusted);

    if (isUnrestricted) return urls;

    const allowedUrls =
      Env.WHITELISTED_REGEX_PATTERNS_URLS ??
      Env.ALLOWED_REGEX_PATTERNS_URLS ??
      [];
    return urls.filter((url) => allowedUrls.includes(url));
  }

  /**
   * Fetch patterns from a single URL (for direct access).
   */
  public static async getPatternsForUrl(
    url: string
  ): Promise<RegexPatternItem[]> {
    return this.manager.fetchFromUrl(url);
  }

  /**
   * Resolve patterns from URLs with validation.
   */
  public static async resolvePatterns(
    urls: string[] | undefined,
    userData?: UserData
  ): Promise<RegexPatternItem[]> {
    if (!urls?.length) return [];

    const validUrls = this.validateUrls(urls, userData);
    if (!validUrls.length) return [];

    // Track dynamic URLs
    const mgr = this.manager;
    for (const url of validUrls) {
      (mgr as any)._dynamicUrls ??= new Set();
    }

    const allPatterns = await Promise.all(
      validUrls.map((url) => this.getPatternsForUrl(url))
    );

    const patterns = allPatterns.flat();

    // Add fetched patterns to the accumulated whitelist
    if (patterns.length > 0) {
      mgr.addItems(patterns);
    }

    return patterns;
  }

  /**
   * Resolve patterns from URLs, returning per-URL results with errors.
   * Used by the API route to forward errors to the frontend.
   */
  public static async resolvePatternsWithErrors(
    urls: string[] | undefined,
    userData?: UserData
  ): Promise<FetchResult<RegexPatternItem>[]> {
    if (!urls?.length) return [];

    const validUrls = new Set(this.validateUrls(urls, userData));

    const results = await Promise.all(
      urls.map((url) => {
        if (!validUrls.has(url)) {
          return {
            url,
            items: [] as RegexPatternItem[],
            error:
              Env.REGEX_FILTER_ACCESS === 'none'
                ? 'Regex sync is disabled on this instance.'
                : Env.REGEX_FILTER_ACCESS === 'trusted' && !userData?.trusted
                  ? 'This URL is not in the allowed list. Contact the instance owner to whitelist it, or ask to be marked as a trusted user.'
                  : 'This URL is not allowed by the server configuration.',
          } satisfies FetchResult<RegexPatternItem>;
        }
        return this.manager.fetchFromUrlWithError(url);
      })
    );

    // Add successful patterns to the whitelist
    const allPatterns = results.flatMap((r) => r.items);
    if (allPatterns.length > 0) {
      this.manager.addItems(allPatterns);
    }

    return results;
  }

  /**
   * Sync regex patterns from URLs into the user's existing patterns.
   * This is the main method called by the middleware.
   */
  public static async syncRegexPatterns<U>(
    urls: string[] | undefined,
    existing: U[],
    userData: UserData,
    transform: (item: RegexPatternItem) => U,
    uniqueKey: (item: U) => string
  ): Promise<U[]> {
    const patterns = await this.resolvePatterns(urls, userData);
    if (patterns.length === 0) return existing;

    const result = [...existing];
    const existingSet = new Set(existing.map(uniqueKey));
    const overrides: SyncOverride[] = userData.regexOverrides || [];

    for (const regex of patterns) {
      const override = overrides.find(
        (o) =>
          o.pattern === regex.pattern ||
          (regex.name && o.originalName === regex.name)
      );

      if (override?.disabled) continue;

      const item = transform(
        override
          ? {
              ...regex,
              name: override.name ?? regex.name,
              score:
                override.score !== undefined ? override.score : regex.score,
            }
          : regex
      );

      const key = uniqueKey(item);
      if (!existingSet.has(key)) {
        result.push(item);
        existingSet.add(key);
      }
    }

    return result;
  }

  /**
   * Helper method to resolve all synced regex patterns from URLs for temporary validation.
   * Returns patterns without modifying the userData config.
   * Used by config validation to merge synced patterns temporarily.
   */
  public static async resolveSyncedRegexesForValidation(
    userData: UserData
  ): Promise<{
    included: string[];
    excluded: string[];
    required: string[];
    preferred: { name: string; pattern: string; score?: number }[];
    ranked: { name?: string; pattern: string; score: number }[];
  }> {
    try {
      const [included, excluded, required, preferred, ranked] =
        await Promise.all([
          this.syncRegexPatterns(
            userData.syncedIncludedRegexUrls,
            [],
            userData,
            (regex) => regex.pattern,
            (pattern) => pattern
          ),
          this.syncRegexPatterns(
            userData.syncedExcludedRegexUrls,
            [],
            userData,
            (regex) => regex.pattern,
            (pattern) => pattern
          ),
          this.syncRegexPatterns(
            userData.syncedRequiredRegexUrls,
            [],
            userData,
            (regex) => regex.pattern,
            (pattern) => pattern
          ),
          this.syncRegexPatterns(
            userData.syncedPreferredRegexUrls,
            [],
            userData,
            (regex) => regex,
            (regex) => regex.pattern
          ),
          this.syncRegexPatterns(
            userData.syncedRankedRegexUrls,
            [],
            userData,
            (regex) => ({
              pattern: regex.pattern,
              name: regex.name,
              score: regex.score || 0,
            }),
            (item) => item.pattern
          ),
        ]);

      return { included, excluded, required, preferred, ranked };
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? `Failed to resolve one or more synced regex patterns: ${err.message}`
          : 'Failed to resolve one or more synced regex patterns'
      );
    }
  }
}
