import z from 'zod';
import { UserData } from '../db/schemas.js';
import { config } from '../config/index.js';
import {
  SyncService,
  mergeSynced,
  denyMessage,
  isUnrestricted,
  allowedUrls,
  type FetchResult,
  type SyncOverride,
  type UrlPartition,
} from './sync/index.js';
import { createLogger } from '../logging/logger.js';

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
 * Held per request, never in module state: a URL only this caller may fetch
 * must not change what anyone else is allowed to run.
 */
export interface PermittedPatterns {
  readonly permitted: ReadonlySet<string>;
  readonly unrestricted: boolean;
}

/**
 * Manages regex pattern whitelisting, access control, and URL syncing.
 *
 * Access model:
 *   - `REGEX_FILTER_ACCESS = 'all'`     → anyone can use any regex / sync from any URL
 *   - `REGEX_FILTER_ACCESS = 'trusted'`  → trusted users can use any regex; others are limited to whitelisted patterns
 *   - `REGEX_FILTER_ACCESS = 'none'`     → no one can use regex (except whitelisted patterns)
 */
export class RegexAccess {
  private static _service: SyncService<RegexPatternItem>;

  /**
   * Patterns this instance permits for everyone. Rebuilt from the operator's
   * own sources on every refresh, never fed from a request.
   */
  private static _vouchedPatterns = new Set<string>();

  private static _sourcePatterns = new Map<string, string[]>();

  private static _urlPatterns = new Map<string, string[]>();

  private static get service(): SyncService<RegexPatternItem> {
    if (!this._service) {
      this._service = new SyncService<RegexPatternItem>({
        kind: 'regex',
        cacheKey: 'regex-patterns',
        maxCacheSize: 100,
        itemSchema: RegexPatternSchema,
        convertValue: (v) => ({ name: v, pattern: v }),
        settingsUrls: () => config.userLimits.regex.patternsUrls,
        taskId: 'regex-sync-refresh',
        taskLabel: 'Regex whitelist refresh',
        taskDescription:
          'Re-fetch the whitelisted regex pattern URLs and rebuild the set of patterns non-trusted users may use.',
        onVouchedItems: (items) => this.rebuildVouchedPatterns(items),
      });
      this.rebuildVouchedPatterns();
    }
    return this._service;
  }

  public static initialise(): Promise<void> {
    return this.service.initialise();
  }

  /**
   * Clean up resources. Safe to call before `initialise()`: the `service`
   * getter would otherwise read from `config.userLimits.regex` and trip the
   * settings-store guard if shutdown runs before `initialiseConfig()` has
   * resolved (e.g. SIGTERM during startup).
   */
  public static cleanup(): void {
    if (this._service) this._service.cleanup();
  }

  /** Takes that source's complete set, not a delta. */
  public static setSourcePatterns(
    source: 'templates' | 'community',
    patterns: string[]
  ): void {
    this._sourcePatterns.set(source, patterns);
    this.rebuildVouchedPatterns();
  }

  public static setSourceUrls(
    source: 'templates' | 'community',
    urls: string[]
  ): void {
    this.service.setSource(source, urls);
  }

  public static getAllowedUrls(): string[] {
    return this.service.allowlist.urls;
  }

  /**
   * Resolve once per request and carry the result: every consumer in the
   * pipeline gets the same answer and working it out can cost a fetch.
   */
  public static async resolvePermitted(
    userData: UserData,
    syncedUrls: string[] = []
  ): Promise<PermittedPatterns> {
    await this.initialise();

    const unrestricted = isUnrestricted('regex', userData);
    if (unrestricted) {
      return { permitted: this._vouchedPatterns, unrestricted: true };
    }

    const permitted = new Set(this._vouchedPatterns);
    if (syncedUrls.length > 0) {
      // A URL this caller may fetch permits its own contents, for this request.
      const partition = this.service.partition(syncedUrls, userData);
      const fetched = await this.service.fetchAll(partition);
      for (const items of fetched.values()) {
        for (const item of items) permitted.add(item.pattern);
      }
    }
    return { permitted, unrestricted: false };
  }

  /** Per pattern, so one unpermitted pattern does not disable the others. */
  public static partitionPatterns(
    patterns: string[],
    permitted: PermittedPatterns
  ): { allowed: string[]; denied: string[] } {
    if (permitted.unrestricted || patterns.length === 0) {
      return { allowed: patterns, denied: [] };
    }
    const allowed: string[] = [];
    const denied: string[] = [];
    for (const pattern of patterns) {
      (permitted.permitted.has(pattern) ? allowed : denied).push(pattern);
    }
    return { allowed, denied };
  }

  /** All-or-nothing form, for callers that reject rather than degrade. */
  public static async isRegexAllowed(
    userData: UserData,
    regexes?: string[]
  ): Promise<boolean> {
    const permitted = await this.resolvePermitted(userData);
    if (regexes && regexes.length > 0) {
      return this.partitionPatterns(regexes, permitted).denied.length === 0;
    }
    return permitted.unrestricted;
  }

  /** The whitelisted regex patterns info (for the status endpoint). */
  public static async allowedRegexPatterns(): Promise<{
    patterns: string[];
    description?: string;
    urls: string[];
  }> {
    await this.initialise();
    return {
      patterns: [...this._vouchedPatterns],
      description: config.userLimits.regex.patternsDescription ?? undefined,
      urls: this.service.allowlist.urls,
    };
  }

  public static partition(urls: string[], userData?: UserData): UrlPartition {
    return this.service.partition(urls, userData);
  }

  /**
   * Validate sync URLs based on access level and user trust.
   * - `all`     → any URL allowed
   * - `trusted` → trusted users can use any URL; others limited to vouched URLs
   * - `none`    → only vouched URLs
   */
  public static validateUrls(urls: string[], userData?: UserData): string[] {
    return allowedUrls(this.service.partition(urls, userData));
  }

  /**
   * Fetch patterns from a single URL (for direct access).
   */
  public static async getPatternsForUrl(
    url: string
  ): Promise<RegexPatternItem[]> {
    return this.service.fetch(url, this.service.allowlist.has(url));
  }

  /**
   * Resolve patterns from URLs with validation.
   */
  public static async resolvePatterns(
    urls: string[] | undefined,
    userData?: UserData
  ): Promise<RegexPatternItem[]> {
    if (!urls?.length) return [];
    const fetched = await this.service.fetchAll(
      this.service.partition(urls, userData)
    );
    return [...fetched.values()].flat();
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
    const partition = this.service.partition(urls, userData);
    const denied = new Map(partition.denied.map((d) => [d.url, d.reason]));
    const vouched = new Set(partition.vouched);

    return Promise.all(
      urls.map((url) => {
        const reason = denied.get(url);
        if (reason) {
          return {
            url,
            items: [] as RegexPatternItem[],
            error: denyMessage('regex', reason),
          } satisfies FetchResult<RegexPatternItem>;
        }
        return this.service.fetchSettled(url, vouched.has(url));
      })
    );
  }

  /**
   * Sync regex patterns from URLs into the user's existing patterns.
   * This is the main method called by the middleware.
   *
   * Resolves `<SYNCED: url>` inline placeholders in-place; unplaced URLs
   * are appended at the end. Dangling placeholders are stripped.
   */
  public static async syncRegexPatterns<U>(
    urls: string[] | undefined,
    existing: U[],
    userData: UserData,
    transform: (item: RegexPatternItem) => U,
    getField: (item: U) => string
  ): Promise<U[]> {
    const partition = urls?.length
      ? this.service.partition(urls, userData)
      : { allowed: [], vouched: [], userScoped: [], denied: [] };
    const usable = allowedUrls(partition);

    return mergeSynced<RegexPatternItem, U>({
      urls: usable,
      existing,
      fetched: usable.length
        ? await this.service.fetchAll(partition)
        : new Map(),
      overrides: userData.regexOverrides || [],
      findOverride: (regex, overrides) =>
        overrides.find(
          (o) =>
            o.pattern === regex.pattern ||
            (regex.name && o.originalName === regex.name)
        ),
      applyOverride: (regex, override) => ({
        ...regex,
        name: override.name ?? regex.name,
        score: override.score !== undefined ? override.score : regex.score,
      }),
      transform,
      getField,
    });
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

  public static syncedUrlsOf(userData: UserData): string[] {
    return [
      ...(userData.syncedIncludedRegexUrls || []),
      ...(userData.syncedExcludedRegexUrls || []),
      ...(userData.syncedRequiredRegexUrls || []),
      ...(userData.syncedPreferredRegexUrls || []),
      ...(userData.syncedRankedRegexUrls || []),
    ];
  }

  private static rebuildVouchedPatterns(
    urlItems?: Map<string, RegexPatternItem[]>
  ): void {
    if (urlItems) {
      this._urlPatterns = new Map(
        [...urlItems].map(([url, items]) => [
          url,
          items.map((item) => item.pattern),
        ])
      );
    }

    // Read live so an edit to the static list takes effect without a restart.
    const rebuilt = new Set<string>(config.userLimits.regex.patterns);
    for (const patterns of this._sourcePatterns.values()) {
      for (const pattern of patterns) rebuilt.add(pattern);
    }
    for (const patterns of this._urlPatterns.values()) {
      for (const pattern of patterns) rebuilt.add(pattern);
    }

    const before = this._vouchedPatterns.size;
    this._vouchedPatterns = rebuilt;
    if (before !== rebuilt.size) {
      logger.info(
        { before, total: rebuilt.size },
        'rebuilt vouched regex patterns'
      );
    }
  }
}
