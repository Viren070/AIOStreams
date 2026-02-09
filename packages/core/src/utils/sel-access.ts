import z from 'zod';
import { UserData } from '../db/schemas.js';
import { Env } from './env.js';
import { SyncManager, type SyncOverride, type FetchResult } from './sync.js';
import { extractNamesFromExpression } from '../parser/streamExpression.js';
import { createLogger } from './logger.js';

const logger = createLogger('core');

/**
 * Schema for a stream expression item fetched from a sync URL.
 */
const StreamExpressionSchema = z.object({
  expression: z.string().min(1),
  name: z.string().optional(),
  score: z.number().optional(),
  enabled: z.boolean().optional(),
});

export type StreamExpressionItem = z.infer<typeof StreamExpressionSchema>;

/**
 * Manages stream expression (SEL) URL syncing and access control.
 *
 * Access model (controls which sync URLs can be used, NOT which expressions can be entered):
 *   - `SEL_SYNC_ACCESS = 'all'`       → anyone can sync from any URL
 *   - `SEL_SYNC_ACCESS = 'trusted'`   → trusted users can sync from any URL;
 *                                       others can only sync from WHITELISTED_SEL_URLS
 *
 * Users can always enter any SEL expression locally - access control only applies to sync URLs.
 */
export class SelAccess {
  private static _instance: SyncManager<StreamExpressionItem>;

  /**
   * Get or create the singleton SyncManager instance.
   */
  private static get manager(): SyncManager<StreamExpressionItem> {
    if (!this._instance) {
      const configuredUrls = Env.WHITELISTED_SEL_URLS || [];

      // WHITELISTED_SYNC_REFRESH_INTERVAL (seconds), fallback to old ms value converted to seconds
      const refreshInterval =
        Env.WHITELISTED_SYNC_REFRESH_INTERVAL ??
        Math.floor(
          (Env.ALLOWED_REGEX_PATTERNS_URLS_REFRESH_INTERVAL ?? 86400000) / 1000
        );

      this._instance = new SyncManager<StreamExpressionItem>({
        cacheKey: 'sel-expressions',
        maxCacheSize: 100,
        refreshInterval,
        configuredUrls,
        itemSchema: StreamExpressionSchema,
        itemKey: (item) => item.expression,
        convertValue: (v) => ({ expression: v }),
      });
    }
    return this._instance;
  }

  /**
   * Initialise the SEL access service.
   */
  public static initialise(): Promise<void> {
    return this.manager.initialise();
  }

  /**
   * Clean up resources.
   */
  public static cleanup(): void {
    this.manager.cleanup();
  }

  /**
   * Validate sync URLs based on access level and user trust.
   * - `all`     → any URL allowed
   * - `trusted` → trusted users can use any URL; others limited to whitelisted SEL URLs
   */
  public static validateUrls(urls: string[], userData?: UserData): string[] {
    const isUnrestricted =
      Env.SEL_SYNC_ACCESS === 'all' ||
      (Env.SEL_SYNC_ACCESS === 'trusted' && userData?.trusted);

    if (isUnrestricted) return urls;

    // Non-trusted users can only use whitelisted SEL URLs
    const allowedUrls = Env.WHITELISTED_SEL_URLS || [];
    return urls.filter((url) => allowedUrls.includes(url));
  }

  /**
   * Fetch expressions from a single URL.
   */
  public static async getExpressionsForUrl(
    url: string
  ): Promise<StreamExpressionItem[]> {
    return this.manager.fetchFromUrl(url);
  }

  /**
   * Resolve expressions from URLs with validation.
   */
  public static async resolveExpressions(
    urls: string[] | undefined,
    userData?: UserData
  ): Promise<StreamExpressionItem[]> {
    if (!urls?.length) return [];

    const validUrls = this.validateUrls(urls, userData);
    if (!validUrls.length) return [];

    const results = await Promise.all(
      validUrls.map((url) => this.getExpressionsForUrl(url))
    );

    return results.flat();
  }

  /**
   * Resolve expressions from URLs, returning per-URL results with errors.
   * Used by the API route to forward errors to the frontend.
   */
  public static async resolveExpressionsWithErrors(
    urls: string[] | undefined,
    userData?: UserData
  ): Promise<FetchResult<StreamExpressionItem>[]> {
    if (!urls?.length) return [];

    const validUrls = new Set(this.validateUrls(urls, userData));

    const results = await Promise.all(
      urls.map((url) => {
        if (!validUrls.has(url)) {
          return {
            url,
            items: [] as StreamExpressionItem[],
            error:
              Env.SEL_SYNC_ACCESS === 'trusted' && !userData?.trusted
                ? 'This URL is not in the allowed list. Contact the instance owner to whitelist it, or ask to be marked as a trusted user.'
                : 'This URL is not allowed by the server configuration.',
          } satisfies FetchResult<StreamExpressionItem>;
        }
        return this.manager.fetchFromUrlWithError(url);
      })
    );

    return results;
  }

  /**
   * Sync stream expressions from URLs into the user's existing expressions.
   * This is the main method called by the middleware.
   *
   * Override logic for SEL:
   * - **disabled**: skip the expression entirely
   * - **score override (ranked only)**: override the score value
   *
   * Override matching:
   * - By exact expression string match (`override.expression === item.expression`)
   * - By extracted names match: names extracted from expression comments vs `override.exprNames`
   */
  public static async syncStreamExpressions<U>(
    urls: string[] | undefined,
    existing: U[],
    userData: UserData,
    transform: (item: StreamExpressionItem) => U,
    uniqueKey: (item: U) => string
  ): Promise<U[]> {
    const expressions = await this.resolveExpressions(urls, userData);
    if (expressions.length === 0) return existing;

    const result = [...existing];
    const existingSet = new Set(existing.map(uniqueKey));
    const overrides: SyncOverride[] = userData.selOverrides || [];

    for (const expr of expressions) {
      const override = this._findSelOverride(expr, overrides);

      if (override?.disabled) continue;

      const overriddenExpr = override
        ? this._applySelOverride(expr, override)
        : expr;

      const item = transform(overriddenExpr);
      const key = uniqueKey(item);
      if (!existingSet.has(key)) {
        result.push(item);
        existingSet.add(key);
      }
    }

    return result;
  }

  /**
   * Find a matching SEL override for an expression.
   * Matches by exact expression string or by comparing extracted names
   * from the expression against the override's stored `exprNames` array.
   */
  private static _findSelOverride(
    expr: StreamExpressionItem,
    overrides: SyncOverride[]
  ): SyncOverride | undefined {
    if (!overrides.length) return undefined;

    return overrides.find((o) => {
      // Match by exact expression
      if (o.expression && o.expression === expr.expression) return true;

      // Match by extracted names vs stored exprNames
      if (o.exprNames && o.exprNames.length > 0) {
        const names = extractNamesFromExpression(expr.expression);
        if (
          names &&
          names.length === o.exprNames.length &&
          names.every((n, i) => n === o.exprNames![i])
        ) {
          return true;
        }
      }

      return false;
    });
  }

  /**
   * Apply an SEL override to an expression item.
   * Supports score overrides and enabled state overrides.
   */
  private static _applySelOverride(
    expr: StreamExpressionItem,
    override: SyncOverride
  ): StreamExpressionItem {
    const result = { ...expr };
    if (override.score !== undefined) {
      result.score = override.score;
    }
    // If the user explicitly set disabled=false, override enabled to true
    if (override.disabled === false && expr.enabled === false) {
      result.enabled = true;
    }
    return result;
  }

  /**
   * Helper method to resolve all synced stream expressions from URLs for temporary validation.
   * Returns expressions without modifying the userData config.
   * Used by config validation to merge synced expressions temporarily.
   */
  public static async resolveSyncedExpressionsForValidation(
    userData: UserData
  ): Promise<{
    included: string[];
    excluded: string[];
    required: string[];
    preferred: string[];
    ranked: { expression: string; score: number; enabled: boolean }[];
  }> {
    try {
      const [included, excluded, required, preferred, ranked] =
        await Promise.all([
          this.syncStreamExpressions(
            userData.syncedIncludedStreamExpressionUrls,
            [],
            userData,
            (item) => item.expression,
            (expr) => expr
          ),
          this.syncStreamExpressions(
            userData.syncedExcludedStreamExpressionUrls,
            [],
            userData,
            (item) => item.expression,
            (expr) => expr
          ),
          this.syncStreamExpressions(
            userData.syncedRequiredStreamExpressionUrls,
            [],
            userData,
            (item) => item.expression,
            (expr) => expr
          ),
          this.syncStreamExpressions(
            userData.syncedPreferredStreamExpressionUrls,
            [],
            userData,
            (item) => item.expression,
            (expr) => expr
          ),
          this.syncStreamExpressions(
            userData.syncedRankedStreamExpressionUrls,
            [],
            userData,
            (item) => ({
              expression: item.expression,
              score: item.score || 0,
              enabled: item.enabled ?? true,
            }),
            (item) => item.expression
          ),
        ]);

      return { included, excluded, required, preferred, ranked };
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? `Failed to resolve one or more synced stream expressions: ${err.message}`
          : 'Failed to resolve one or more synced stream expressions'
      );
    }
  }
}
