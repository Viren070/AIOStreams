import z from 'zod';
import { UserData } from '../db/schemas.js';
import { config } from '../config/index.js';
import {
  SyncService,
  mergeSynced,
  denyMessage,
  allowedUrls,
  type FetchResult,
  type SyncOverride,
  type UrlPartition,
} from './sync/index.js';
import { extractNamesFromExpression } from '../parser/streamExpression.js';

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
  private static _service: SyncService<StreamExpressionItem>;

  private static get service(): SyncService<StreamExpressionItem> {
    if (!this._service) {
      this._service = new SyncService<StreamExpressionItem>({
        kind: 'sel',
        cacheKey: 'sel-expressions',
        maxCacheSize: 100,
        itemSchema: StreamExpressionSchema,
        convertValue: (v) => ({ expression: v }),
        settingsUrls: () => config.userLimits.sel.urls,
        taskId: 'sel-sync-refresh',
        taskLabel: 'SEL whitelist refresh',
        taskDescription:
          'Re-fetch the whitelisted stream expression URLs so synced expressions stay current.',
      });
    }
    return this._service;
  }

  public static initialise(): Promise<void> {
    return this.service.initialise();
  }

  /**
   * Clean up resources. Safe to call before `initialise()`: the `service`
   * getter would otherwise read from `config.userLimits.sel` and trip the
   * settings-store guard if shutdown runs before `initialiseConfig()` has
   * resolved (e.g. SIGTERM during startup).
   */
  public static cleanup(): void {
    if (this._service) this._service.cleanup();
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

  public static partition(urls: string[], userData?: UserData): UrlPartition {
    return this.service.partition(urls, userData);
  }

  /**
   * Validate sync URLs based on access level and user trust.
   * - `all`     → any URL allowed
   * - `trusted` → trusted users can use any URL; others limited to vouched URLs
   */
  public static validateUrls(urls: string[], userData?: UserData): string[] {
    return allowedUrls(this.service.partition(urls, userData));
  }

  /**
   * Fetch expressions from a single URL.
   */
  public static async getExpressionsForUrl(
    url: string
  ): Promise<StreamExpressionItem[]> {
    return this.service.fetch(url, this.service.allowlist.has(url));
  }

  /**
   * Resolve expressions from URLs with validation.
   */
  public static async resolveExpressions(
    urls: string[] | undefined,
    userData?: UserData
  ): Promise<StreamExpressionItem[]> {
    if (!urls?.length) return [];
    const fetched = await this.service.fetchAll(
      this.service.partition(urls, userData)
    );
    return [...fetched.values()].flat();
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
    const partition = this.service.partition(urls, userData);
    const denied = new Map(partition.denied.map((d) => [d.url, d.reason]));
    const vouched = new Set(partition.vouched);

    return Promise.all(
      urls.map((url) => {
        const reason = denied.get(url);
        if (reason) {
          return {
            url,
            items: [] as StreamExpressionItem[],
            error: denyMessage('sel', reason),
          } satisfies FetchResult<StreamExpressionItem>;
        }
        return this.service.fetchSettled(url, vouched.has(url));
      })
    );
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
   *
   * Resolves `<SYNCED: url>` inline placeholders in-place; unplaced URLs
   * are appended at the end. Dangling placeholders are stripped.
   */
  public static async syncStreamExpressions<U>(
    urls: string[] | undefined,
    existing: U[],
    userData: UserData,
    transform: (item: StreamExpressionItem) => U,
    getField: (item: U) => string
  ): Promise<U[]> {
    const partition = urls?.length
      ? this.service.partition(urls, userData)
      : { allowed: [], vouched: [], userScoped: [], denied: [] };
    const usable = allowedUrls(partition);

    return mergeSynced<StreamExpressionItem, U>({
      urls: usable,
      existing,
      fetched: usable.length
        ? await this.service.fetchAll(partition)
        : new Map(),
      overrides: userData.selOverrides || [],
      findOverride: (expr, overrides) => this._findSelOverride(expr, overrides),
      applyOverride: (expr, override) => this._applySelOverride(expr, override),
      transform,
      getField,
    });
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
    return overrides.find((o) => {
      // Match by exact expression
      if (o.expression && o.expression === expr.expression) return true;

      // Match by extracted names vs stored exprNames
      if (o.exprNames && o.exprNames.length > 0) {
        const names = extractNamesFromExpression(expr.expression, false);
        const matches = (list?: string[]) =>
          !!list &&
          list.length === o.exprNames!.length &&
          list.every((n, i) => n === o.exprNames![i]);

        if (matches(names)) {
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

  public static syncedUrlsOf(userData: UserData): string[] {
    return [
      ...(userData.syncedIncludedStreamExpressionUrls || []),
      ...(userData.syncedExcludedStreamExpressionUrls || []),
      ...(userData.syncedRequiredStreamExpressionUrls || []),
      ...(userData.syncedPreferredStreamExpressionUrls || []),
      ...(userData.syncedRankedStreamExpressionUrls || []),
    ];
  }

  /**
   * Helper method to resolve all synced stream expressions from URLs for temporary validation.
   * Returns expressions without modifying the userData config.
   * Used by config validation to merge synced expressions temporarily.
   */
  public static async resolveSyncedExpressionsForValidation(
    userData: UserData
  ): Promise<{
    included: { expression: string; enabled: boolean }[];
    excluded: { expression: string; enabled: boolean }[];
    required: { expression: string; enabled: boolean }[];
    preferred: { expression: string; enabled: boolean }[];
    ranked: { expression: string; score: number; enabled: boolean }[];
  }> {
    const plain = (item: StreamExpressionItem) => ({
      expression: item.expression,
      enabled: item.enabled ?? true,
    });
    try {
      const [included, excluded, required, preferred, ranked] =
        await Promise.all([
          this.syncStreamExpressions(
            userData.syncedIncludedStreamExpressionUrls,
            [],
            userData,
            plain,
            (item) => item.expression
          ),
          this.syncStreamExpressions(
            userData.syncedExcludedStreamExpressionUrls,
            [],
            userData,
            plain,
            (item) => item.expression
          ),
          this.syncStreamExpressions(
            userData.syncedRequiredStreamExpressionUrls,
            [],
            userData,
            plain,
            (item) => item.expression
          ),
          this.syncStreamExpressions(
            userData.syncedPreferredStreamExpressionUrls,
            [],
            userData,
            plain,
            (item) => item.expression
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
