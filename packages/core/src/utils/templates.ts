import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDataFolder } from './general.js';
import { Template, TemplateSchema } from '../db/schemas.js';
import { ZodError } from 'zod';
import { formatZodError, applyMigrations } from './config.js';
import { RegexAccess } from './regex-access.js';
import { createLogger } from '../logging/logger.js';
import { SelAccess } from './sel-access.js';
import { config as appConfig } from '../config/index.js';
import { makeRequest } from './http.js';
import { TaskManager } from '../tasks/index.js';
import { subscribeToConfig } from '../config/index.js';

const logger = createLogger('templates');

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESOURCE_DIR = path.join(__dirname, '../../../../', 'resources');

export class TemplateManager {
  /** The combined, deduplicated list served to users. */
  private static templates: Template[] = [];

  /** Templates fetched from TEMPLATE_URLS (kept separate so refreshes can swap them). */
  private static remoteTemplates: Template[] = [];

  static getTemplates(): Template[] {
    return TemplateManager.templates;
  }

  /**
   * Called once at startup.
   * 1. Load builtin + custom (file-based) templates.
   * 2. Fetch remote templates from TEMPLATE_URLS.
   * 3. Merge everything and register trusted patterns/URLs.
   * 4. Schedule periodic remote refreshes.
   */
  static async loadTemplates(): Promise<void> {
    const builtinTemplatePath = path.join(RESOURCE_DIR, 'templates');
    const customTemplatesPath = path.join(getDataFolder(), 'templates');

    const builtinTemplates = this.loadTemplatesFromPath(
      builtinTemplatePath,
      'builtin'
    );
    const customTemplates = this.loadTemplatesFromPath(
      customTemplatesPath,
      'custom'
    );

    // Fetch remote templates from env URLs (best-effort, errors logged)
    this.remoteTemplates = await this.fetchRemoteTemplates();

    // Merge: custom → remote → builtin, then deduplicate
    this.templates = this.deduplicateTemplates([
      ...customTemplates.templates,
      ...this.remoteTemplates,
      ...builtinTemplates.templates,
    ]);

    this.registerTrustedAccess(this.templates);

    const errors = [...builtinTemplates.errors, ...customTemplates.errors];
    // logger.info(`Loaded templates`, {
    //   totalTemplates: this.templates.length,
    //   detectedTemplates: builtinTemplates.detected + customTemplates.detected,
    //   builtinTemplates: builtinTemplates.loaded,
    //   customTemplates: customTemplates.loaded,
    //   remoteTemplates: this.remoteTemplates.length,
    //   errors: errors.length,
    // });
    logger.info(
      {
        total: this.templates.length,
        detected: builtinTemplates.detected + customTemplates.detected,
        builtin: builtinTemplates.loaded,
        custom: customTemplates.loaded,
        remote: this.remoteTemplates.length,
        errors: errors.length,
      },
      'loaded templates'
    );

    if (errors.length > 0) {
      logger.warn(`could not load some templates due to errors`, {
        count: errors.length,
        errors: errors,
      });
    }

    // Schedule periodic refresh if configured
    this.scheduleRefresh();
  }

  /**
   * Stop the periodic refresh (e.g. for graceful shutdown).
   */
  static stopRefresh(): void {
    TaskManager.unregister('template-remote-refresh');
  }

  // ---------------------------------------------------------------------------
  // File-based template loading
  // ---------------------------------------------------------------------------

  private static loadTemplatesFromPath(
    dirPath: string,
    source: 'builtin' | 'custom'
  ): {
    templates: Template[];
    detected: number;
    loaded: number;
    errors: { file: string; error: string }[];
  } {
    if (!fs.existsSync(dirPath)) {
      return { templates: [], detected: 0, loaded: 0, errors: [] };
    }
    const errors: { file: string; error: string }[] = [];
    const entries = fs.readdirSync(dirPath, { recursive: true }) as string[];
    const templateList: Template[] = [];
    for (const file of entries) {
      const filePath = path.join(dirPath, file);
      try {
        if (file.endsWith('.json')) {
          const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          const rawTemplates = Array.isArray(raw) ? raw : [raw];
          for (const rawTemplate of rawTemplates) {
            if (rawTemplate.config) {
              rawTemplate.config = applyMigrations(rawTemplate.config);
            }
            const template = TemplateSchema.parse(rawTemplate);
            templateList.push({
              ...template,
              metadata: {
                ...template.metadata,
                source,
              },
            });
          }
        }
      } catch (error) {
        errors.push({
          file,
          error:
            error instanceof ZodError
              ? `Failed to parse template:\n${formatZodError(error)
                  .split('\n')
                  .map((line) => '    ' + line)
                  .join('\n')}`
              : `Failed to load template: ${error}`,
        });
      }
    }
    return {
      templates: templateList,
      detected: entries.filter((f) => f.endsWith('.json')).length,
      loaded: templateList.length,
      errors,
    };
  }

  /**
   * Fetch all TEMPLATE_URLS and return the parsed templates.
   * Each URL is fetched independently — failures are logged and skipped.
   */
  private static async fetchRemoteTemplates(): Promise<Template[]> {
    const templateUrls = appConfig.templates.urls || [];
    if (templateUrls.length === 0) return [];

    logger.info(
      { count: templateUrls.length },
      `fetching templates from remote URL(s)`
    );

    const results = await Promise.allSettled(
      templateUrls.map((url) => this.fetchTemplatesFromUrl(url))
    );

    const templates: Template[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        templates.push(...result.value);
      } else {
        logger.error(
          { url: templateUrls[i], error: result.reason },
          'failed to fetch templates from URL'
        );
      }
    }

    return templates;
  }

  /**
   * Fetch a single template URL and return validated Template objects.
   */
  private static async fetchTemplatesFromUrl(url: string): Promise<Template[]> {
    const response = await makeRequest(url, {
      method: 'GET',
      headers: { 'User-Agent': appConfig.http.defaultUserAgent },
      timeout: 30000,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const rawTemplates = Array.isArray(data) ? data : [data];
    const templates: Template[] = [];

    for (const rawTemplate of rawTemplates) {
      try {
        if (rawTemplate.config) {
          rawTemplate.config = applyMigrations(rawTemplate.config);
        }
        const template = TemplateSchema.parse(rawTemplate);
        templates.push({
          ...template,
          metadata: {
            ...template.metadata,
            source: 'custom',
            sourceUrl: url,
          },
        });
      } catch (err) {
        logger.error(
          { url, error: err },
          `failed to validate template from URL`
        );
      }
    }

    if (templates.length > 0) {
      logger.info(
        {
          url,
          templates: templates.length,
        },
        `fetched templates from URL`
      );
    }

    return templates;
  }

  // ---------------------------------------------------------------------------
  // Periodic refresh
  // ---------------------------------------------------------------------------

  /**
   * Re-fetch remote templates and rebuild the full template list. Extracted
   * from `scheduleRefresh` so the TaskManager can call it on demand from the
   * dashboard.
   */
  public static async refreshRemoteTemplates(): Promise<{ count: number }> {
    logger.info('Refreshing remote templates...');
    const freshRemote = await this.fetchRemoteTemplates();

    const builtinTemplatePath = path.join(RESOURCE_DIR, 'templates');
    const customTemplatesPath = path.join(getDataFolder(), 'templates');

    const builtinTemplates = this.loadTemplatesFromPath(
      builtinTemplatePath,
      'builtin'
    );
    const customTemplates = this.loadTemplatesFromPath(
      customTemplatesPath,
      'custom'
    );

    this.remoteTemplates = freshRemote;
    this.templates = this.deduplicateTemplates([
      ...customTemplates.templates,
      ...this.remoteTemplates,
      ...builtinTemplates.templates,
    ]);
    this.registerTrustedAccess(this.templates);

    logger.info(
      { count: this.templates.length },
      `remote template refresh complete`
    );
    return { count: this.templates.length };
  }

  /** Tracks whether the config-change subscription has been wired up. */
  private static configSubscribed = false;

  /**
   * Register the remote-refresh task with the central TaskManager and wire up
   * a one-time subscription so that UI-driven changes to TEMPLATE_URLS /
   * TEMPLATE_REFRESH_INTERVAL re-register the task (with the new interval)
   * and kick an immediate refresh.
   *
   * The task is always registered so it shows up on the dashboard even when
   * no URLs are configured yet — its `run` is a no-op in that case.
   */
  private static scheduleRefresh(): void {
    this.registerRefreshTask();
    if (!this.configSubscribed) {
      this.configSubscribed = true;
      subscribeToConfig(async ({ changed }) => {
        if (
          !changed.has('templates.urls') &&
          !changed.has('templates.refreshInterval')
        ) {
          return;
        }
        logger.info(
          { changed: [...changed] },
          're-scheduling remote template refresh after config change'
        );
        this.registerRefreshTask();
        // Kick an immediate refresh so newly-added URLs take effect without
        // waiting for the next scheduled tick.
        if ((appConfig.templates.urls ?? []).length > 0) {
          try {
            await this.refreshRemoteTemplates();
          } catch (err) {
            logger.error(
              { err: err instanceof Error ? err.message : String(err) },
              'immediate template refresh after config change failed'
            );
          }
        }
      });
    }
  }

  /**
   * (Re)register the `template-remote-refresh` task with the current interval.
   * Always registers — even when no URLs are configured — so the dashboard can
   * surface the task and users can trigger it manually. Switches between
   * `scheduled` and `manual` kinds based on whether URLs + a positive interval
   * are configured.
   */
  private static registerRefreshTask(): void {
    const intervalSec = appConfig.templates.refreshInterval;
    const templateUrls = appConfig.templates.urls || [];
    const scheduled = intervalSec > 0 && templateUrls.length > 0;

    TaskManager.register({
      id: 'template-remote-refresh',
      label: 'Template remote refresh',
      description:
        'Re-fetch remote template definitions and rebuild the merged template list.',
      category: 'templates',
      kind: scheduled ? 'scheduled' : 'manual',
      intervalMs: scheduled ? intervalSec * 1000 : undefined,
      enabled: true,
      destructive: false,
      multiReplica: 'all',
      run: async () => {
        if ((appConfig.templates.urls ?? []).length === 0) {
          return { ok: true, message: 'no remote template URLs configured' };
        }
        const { count } = await this.refreshRemoteTemplates();
        return { ok: true, message: `${count} templates loaded` };
      },
    });

    if (scheduled) {
      logger.info({ intervalSec }, 'scheduled remote template refresh');
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Extract all possible string leaf values from a template config field that
   * may contain template directives
   */
  private static extractTemplateStrings(value: any): string[] {
    if (typeof value === 'string') return value ? [value] : [];
    if (Array.isArray(value))
      return value.flatMap((v) => this.extractTemplateStrings(v));
    if (value === null || typeof value !== 'object') return [];

    // __if + __value  OR  bare __value
    if ('__value' in value) {
      return this.extractTemplateStrings(value.__value);
    }

    // __switch: extract from every case and the default
    if ('__switch' in value) {
      const caseVals = Object.values(value.cases ?? {});
      const def = value.default ?? null;
      return [
        ...caseVals.flatMap((v) => this.extractTemplateStrings(v)),
        ...(def !== null ? this.extractTemplateStrings(def) : []),
      ];
    }

    // __remove: nothing to extract
    if ((value as any).__remove === true) return [];

    // Regex pattern object: { pattern: string, … }
    if (typeof value.pattern === 'string') return [value.pattern];

    return [];
  }

  /**
   * Ensure every template has a unique ID.
   * First occurrence of an ID wins; subsequent duplicates get a `-2`, `-3`, … suffix.
   */
  private static deduplicateTemplates(templates: Template[]): Template[] {
    const seenIds = new Map<string, number>(); // id → count
    const result: Template[] = [];

    for (const template of templates) {
      const originalId = template.metadata.id;
      let id = originalId;
      const count = seenIds.get(id) ?? 0;
      if (count > 0) {
        id = `${originalId}-${count + 1}`;
        // Edge case: the suffixed id might also collide — keep incrementing
        while (seenIds.has(id)) {
          seenIds.set(originalId, (seenIds.get(originalId) ?? 0) + 1);
          id = `${originalId}-${(seenIds.get(originalId) ?? 0) + 1}`;
        }
        logger.debug(
          `Duplicate template ID "${originalId}" renamed to "${id}"`
        );
      }
      seenIds.set(originalId, (seenIds.get(originalId) ?? 0) + 1);
      seenIds.set(id, 1); // mark the suffixed id as used too

      result.push({
        ...template,
        metadata: { ...template.metadata, id },
      });
    }

    return result;
  }

  /**
   * Register regex patterns and synced URLs from templates as trusted.
   */
  private static registerTrustedAccess(templates: Template[]): void {
    const ex = (v: any) => this.extractTemplateStrings(v);

    const patterns = templates.flatMap((t) => [
      ...ex(t.config.excludedRegexPatterns),
      ...ex(t.config.includedRegexPatterns),
      ...ex(t.config.requiredRegexPatterns),
      ...ex(t.config.preferredRegexPatterns),
      ...ex(t.config.rankedRegexPatterns),
    ]);

    const syncedSelUrls = templates.flatMap((t) => [
      ...ex(t.config.syncedExcludedStreamExpressionUrls),
      ...ex(t.config.syncedIncludedStreamExpressionUrls),
      ...ex(t.config.syncedRequiredStreamExpressionUrls),
      ...ex(t.config.syncedPreferredStreamExpressionUrls),
      ...ex(t.config.syncedRankedStreamExpressionUrls),
    ]);

    const syncedRegexUrls = templates.flatMap((t) => [
      ...ex(t.config.syncedExcludedRegexUrls),
      ...ex(t.config.syncedIncludedRegexUrls),
      ...ex(t.config.syncedRequiredRegexUrls),
      ...ex(t.config.syncedPreferredRegexUrls),
      ...ex(t.config.syncedRankedRegexUrls),
    ]);

    if (patterns.length > 0) RegexAccess.addPatterns(patterns);
    if (syncedSelUrls.length > 0) SelAccess.addAllowedUrls(syncedSelUrls);
    if (syncedRegexUrls.length > 0) RegexAccess.addAllowedUrls(syncedRegexUrls);
  }
}
