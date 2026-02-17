import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDataFolder } from './general.js';
import { Template, TemplateSchema } from '../db/schemas.js';
import { ZodError } from 'zod';
import { formatZodError, applyMigrations } from './config.js';
import { RegexAccess } from './regex-access.js';
import { createLogger } from './logger.js';
import { SelAccess } from './sel-access.js';
import { Env } from './env.js';
import { makeRequest } from './http.js';

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

  /** Timer handle for the periodic refresh. */
  private static refreshTimer: ReturnType<typeof setInterval> | undefined;

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
    logger.info(`Loaded templates`, {
      totalTemplates: this.templates.length,
      detectedTemplates: builtinTemplates.detected + customTemplates.detected,
      builtinTemplates: builtinTemplates.loaded,
      customTemplates: customTemplates.loaded,
      remoteTemplates: this.remoteTemplates.length,
      errors: errors.length,
    });

    if (errors.length > 0) {
      logger.error(
        `Errors loading templates: \n${errors.map((e) => `  ${e.file} - ${e.error}`).join('\n')}`
      );
    }

    // Schedule periodic refresh if configured
    this.scheduleRefresh();
  }

  /**
   * Stop the periodic refresh timer (e.g. for graceful shutdown).
   */
  static stopRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
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
    const entries = fs.readdirSync(dirPath);
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
    const templateUrls = Env.TEMPLATE_URLS || [];
    if (templateUrls.length === 0) return [];

    logger.info(
      `Fetching templates from ${templateUrls.length} remote URL(s)...`
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
          `Failed to fetch templates from ${templateUrls[i]}: ${result.reason}`
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
      headers: { 'User-Agent': Env.DEFAULT_USER_AGENT },
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
          `Failed to validate template from ${url}: ${err instanceof ZodError ? formatZodError(err) : err}`
        );
      }
    }

    if (templates.length > 0) {
      logger.info(`Fetched ${templates.length} template(s) from ${url}`);
    }

    return templates;
  }

  // ---------------------------------------------------------------------------
  // Periodic refresh
  // ---------------------------------------------------------------------------

  /**
   * Schedule periodic re-fetching of TEMPLATE_URLS.
   * On each tick the remote templates are re-fetched, the full list is
   * rebuilt (custom + remote + builtin), and trusted access is re-registered.
   */
  private static scheduleRefresh(): void {
    const intervalSec = Env.TEMPLATE_REFRESH_INTERVAL;
    const templateUrls = Env.TEMPLATE_URLS || [];
    if (intervalSec <= 0 || templateUrls.length === 0) return;

    // Clear any previous timer (safety)
    this.stopRefresh();

    logger.info(`Scheduling remote template refresh every ${intervalSec}s`);

    this.refreshTimer = setInterval(async () => {
      try {
        logger.info('Refreshing remote templates...');
        const freshRemote = await this.fetchRemoteTemplates();

        // Reload file-based templates in case the hoster changed them too
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
          `Remote template refresh complete — ${this.templates.length} total templates`
        );
      } catch (err) {
        logger.error(`Remote template refresh failed: ${err}`);
      }
    }, intervalSec * 1000);

    // Don't prevent process exit
    this.refreshTimer.unref();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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
    const patterns = templates.flatMap((t) => [
      ...(t.config.excludedRegexPatterns || []),
      ...(t.config.includedRegexPatterns || []),
      ...(t.config.requiredRegexPatterns || []),
      ...(t.config.preferredRegexPatterns || []).map((p) => p.pattern),
      ...(t.config.rankedRegexPatterns || []).map((p) => p.pattern),
    ]);

    const syncedSelUrls = templates.flatMap((t) => [
      ...(t.config.syncedExcludedStreamExpressionUrls || []),
      ...(t.config.syncedIncludedStreamExpressionUrls || []),
      ...(t.config.syncedRequiredStreamExpressionUrls || []),
      ...(t.config.syncedPreferredStreamExpressionUrls || []),
      ...(t.config.syncedRankedStreamExpressionUrls || []),
    ]);

    const syncedRegexUrls = templates.flatMap((t) => [
      ...(t.config.syncedExcludedRegexUrls || []),
      ...(t.config.syncedIncludedRegexUrls || []),
      ...(t.config.syncedRequiredRegexUrls || []),
      ...(t.config.syncedPreferredRegexUrls || []),
      ...(t.config.syncedRankedRegexUrls || []),
    ]);

    if (patterns.length > 0) RegexAccess.addPatterns(patterns);
    if (syncedSelUrls.length > 0) SelAccess.addAllowedUrls(syncedSelUrls);
    if (syncedRegexUrls.length > 0) RegexAccess.addAllowedUrls(syncedRegexUrls);
  }
}
