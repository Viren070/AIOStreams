import {
  Addon,
  AddonCatalog,
  AddonCatalogResponse,
  AddonCatalogResponseSchema,
  AddonCatalogSchema,
  CatalogResponse,
  CatalogResponseSchema,
  Manifest,
  ManifestSchema,
  Meta,
  ParsedMeta,
  MetaPreview,
  MetaPreviewSchema,
  MetaResponse,
  MetaResponseSchema,
  MetaSchema,
  ParsedStream,
  Resource,
  Stream,
  StreamResponse,
  StreamResponseSchema,
  StreamSchema,
  Subtitle,
  SubtitleResponse,
  SubtitleResponseSchema,
  SubtitleSchema,
  ParsedMetaSchema,
} from '../db/schemas.js';
import {
  Cache,
  makeRequest,
  createLogger,
  constants,
  maskSensitiveInfo,
  makeUrlLogSafe,
  formatZodError,
  PossibleRecursiveRequestError,
  Env,
  appConfig,
  getTimeTakenSincePoint,
  RequestOptions,
} from '../utils/index.js';
import { Preset, PresetManager } from '../presets/index.js';
import {
  track,
  classifyAddonError,
  hmac,
  type AnalyticsResource,
  type AnalyticsErrorStage,
} from '../analytics/index.js';
import { z } from 'zod';

const logger = createLogger('wrappers');

// `Cache.getInstance` accepts a lazy `maxSize` resolver so the per-resource
// runtime-config override is honoured without reading it at module-load
// (runtime config is not available before `initialiseConfig()` resolves).
const manifestCache = Cache.getInstance<string, Manifest>(
  'manifest',
  () => appConfig.resources.cache.manifest.maxSize
);
const catalogCache = Cache.getInstance<string, MetaPreview[]>(
  'catalog',
  () => appConfig.resources.cache.catalog.maxSize
);
const metaCache = Cache.getInstance<string, Meta>(
  'meta',
  () => appConfig.resources.cache.meta.maxSize
);
const subtitlesCache = Cache.getInstance<string, Subtitle[]>(
  'subtitles',
  () => appConfig.resources.cache.subtitle.maxSize
);
const addonCatalogCache = Cache.getInstance<string, AddonCatalog[]>(
  'addon_catalog',
  () => appConfig.resources.cache.addonCatalog.maxSize
);
const streamsCache = Cache.getInstance<string, ParsedStream[]>(
  'streams',
  () => appConfig.resources.cache.stream.maxSize
);

/**
 * Resolves TTL value from a cacheTtls map based on priority:
 * 1. presetId match
 * 2. hostname match (from manifestUrl)
 * 3. wildcard match (*)
 */
function resolveTtl(
  ttlMap: Record<string, number>,
  presetId?: string,
  manifestUrl?: string
): number {
  let resolvedTtl = undefined;
  let hostname: string | undefined;
  try {
    if (manifestUrl) {
      hostname = new URL(manifestUrl).hostname;
    }
  } catch {}

  if (presetId && ttlMap[presetId] !== undefined) {
    resolvedTtl = ttlMap[presetId];
  }

  if (resolvedTtl === undefined && hostname && ttlMap[hostname] !== undefined) {
    resolvedTtl = ttlMap[hostname];
  }

  if (resolvedTtl === undefined && ttlMap['*'] !== undefined) {
    resolvedTtl = ttlMap['*'];
  }
  return resolvedTtl !== undefined ? resolvedTtl : -1;
}

type ResourceParams = {
  type: string;
  id: string;
  extras?: string;
};

export class Wrapper {
  private readonly baseUrl: string;
  private readonly addon: Addon;
  private readonly manifestUrl: string;
  private readonly preset: typeof Preset;

  constructor(addon: Addon) {
    this.addon = addon;
    this.manifestUrl = this.addon.manifestUrl.replace('stremio://', 'https://');
    this.baseUrl = this.manifestUrl.split('/').slice(0, -1).join('/');
    this.preset = PresetManager.fromId(this.addon.preset.type);
  }

  /**
   * Validates an array of items against a schema, filtering out invalid ones
   * @param data The data to validate
   * @param schema The Zod schema to validate against
   * @param resourceName Name of the resource for error messages
   * @returns Array of validated items
   * @throws Error if all items are invalid
   */
  private validateArray<T>(
    data: unknown,
    schema: z.ZodSchema<T>,
    resourceName: string
  ): T[] {
    if (!Array.isArray(data)) {
      throw new Error(`${resourceName} is not an array`);
    }

    if (data.length === 0) {
      // empty array is valid
      return [];
    }

    const validItems = data
      .map((item) => {
        const parsed = schema.safeParse(item);
        if (!parsed.success) {
          logger.error(
            { resourceName, err: formatZodError(parsed.error) },
            'invalid item in response, filtering it out'
          );
          return null;
        }
        return parsed.data;
      })
      .filter((item): item is T => item !== null);

    if (validItems.length === 0) {
      throw new Error(`No valid ${resourceName} found`);
    }

    return validItems;
  }

  async getManifest(options?: {
    timeout?: number;
    bypassCache?: boolean;
  }): Promise<Manifest> {
    const cacheKey =
      this.preset.getCacheKey({
        resource: 'manifest',
        type: 'manifest',
        id: 'manifest',
        options: this.addon.preset.options,
      }) || this.manifestUrl;

    const requestFn = async (): Promise<Manifest> => {
      logger.debug(
        { addon: this.addon.name, url: makeUrlLogSafe(this.manifestUrl) },
        'fetching manifest'
      );
      try {
        const backgroundTimeout =
          appConfig.resources.background.timeout ??
          appConfig.userLimits.timeouts.maxTimeout;
        const res = await makeRequest(this.manifestUrl, {
          timeout: backgroundTimeout,
          headers: this.addon.headers,
          forwardIp: this.addon.ip,
        });
        if (!res.ok) {
          throw new Error(`${res.status} - ${res.statusText}`);
        }
        const data = await res.json();
        const manifest = ManifestSchema.safeParse(data);
        if (!manifest.success) {
          logger.error(
            { addon: this.getAddonName(this.addon), err: formatZodError(manifest.error) },
            'manifest response could not be parsed'
          );
          throw new Error(
            `Manifest response could not be parsed: ${formatZodError(manifest.error)}`
          );
        }
        return manifest.data;
      } catch (error: any) {
        if (!(error instanceof PossibleRecursiveRequestError)) {
          logger.error(
            { addon: this.getAddonName(this.addon), err: error.message },
            'failed to fetch manifest'
          );
        }
        if (error instanceof PossibleRecursiveRequestError) {
          throw error;
        }
        throw new Error(
          `Failed to fetch manifest for ${this.getAddonName(this.addon)}: ${error.message}`
        );

      }
    };

    return this._request({
      requestFn,
      timeout: options?.timeout ?? appConfig.resources.timeouts.manifest,
      resourceName: 'manifest',
      cacher: manifestCache,
      cacheKey,
      cacheTtl: resolveTtl(
        appConfig.resources.cache.manifest.ttl,
        this.addon.preset.type,
        this.manifestUrl
      ),
      bypassCache: options?.bypassCache,
    });
  }

  async getStreams(type: string, id: string): Promise<ParsedStream[]> {
    const validator = (data: any): Stream[] => {
      return this.validateArray(data.streams, StreamSchema, 'streams');
    };

    const cacheKey =
      this.preset.getCacheKey({
        resource: 'stream',
        type,
        id,
        options: this.addon.preset.options,
      }) || this.buildResourceUrl('stream', type, id);
    const streamTtl = resolveTtl(
      appConfig.resources.cache.stream.ttl,
      this.addon.preset.type,
      this.manifestUrl
    );
    const streams = await this.makeResourceRequest(
      'stream',
      { type, id },
      this.addon.timeout,
      validator,
      streamTtl != -1 ? streamsCache : undefined,
      streamTtl,
      this.preset.getCacheKey({
        resource: 'stream',
        type,
        id,
        options: this.addon.preset.options,
      })
    );
    const start = Date.now();
    const parser = new (this.preset.getParser())(this.addon);
    let invalidateCache: boolean = false;
    try {
      const parsedStreams = streams
        .flatMap((stream: Stream) => parser.parse(stream))
        .filter((stream: any) => !stream.skip);
      if (parsedStreams.every((stream) => 'skip' in stream || stream.error)) {
        invalidateCache = true;
      }
      logger.debug(
        { addon: this.getAddonName(this.addon), count: parsedStreams.length, took: getTimeTakenSincePoint(start) },
        'parsed streams'
      );
      return parsedStreams as ParsedStream[];
    } catch (error) {
      invalidateCache = true;
      throw error;
    } finally {
      if (invalidateCache) {
        logger.debug(
          { addon: this.getAddonName(this.addon) },
          'invalidating stream cache entry'
        );
        streamsCache
          .delete(cacheKey)
          .catch((error) =>
            logger.error(
              { err: error instanceof Error ? error.message : error },
              'failed to invalidate stream cache entry'
            )
          );
      }
    }
  }

  async getCatalog(
    type: string,
    id: string,
    extras?: string
  ): Promise<MetaPreview[]> {
    const validator = (data: any): MetaPreview[] => {
      return this.validateArray(data.metas, MetaPreviewSchema, 'catalog items');
    };

    const catalogTtl = resolveTtl(
      appConfig.resources.cache.catalog.ttl,
      this.addon.preset.type,
      this.manifestUrl
    );
    return await this.makeResourceRequest(
      'catalog',
      { type, id, extras },
      appConfig.resources.timeouts.catalog,
      validator,
      catalogTtl != -1 ? catalogCache : undefined,
      catalogTtl,
      this.preset.getCacheKey({
        resource: 'catalog',
        type,
        id,
        options: this.addon.preset.options,
        extras,
      })
    );
  }

  async getMeta(type: string, id: string): Promise<ParsedMeta> {
    const validator = (data: any): Meta => {
      const parsed = MetaSchema.safeParse(data.meta);
      if (!parsed.success) {
        logger.error(
          { addon: this.getAddonName(this.addon), err: formatZodError(parsed.error) },
          'failed to parse meta'
        );
        throw new Error(
          `Failed to parse meta for ${this.getAddonName(this.addon)}`
        );
      }
      return parsed.data;
    };
    const metaTtl = resolveTtl(
      appConfig.resources.cache.meta.ttl,
      this.addon.preset.type,
      this.manifestUrl
    );
    const meta: Meta = await this.makeResourceRequest(
      'meta',
      { type, id },
      appConfig.resources.timeouts.meta,
      validator,
      metaTtl != -1 ? metaCache : undefined,
      metaTtl,
      this.preset.getCacheKey({
        resource: 'meta',
        type,
        id,
        options: this.addon.preset.options,
      })
    );
    // parse streams in meta.videos.streams if present
    const parser = new (this.preset.getParser())(this.addon);
    if (meta.videos) {
      meta.videos = meta.videos.map((video) => {
        const parsedStreams = video.streams
          ?.map((stream) => parser.parse(stream))
          .filter((stream) => ('skip' in stream ? !stream.skip : true));
        if (parsedStreams) {
          video.streams = parsedStreams as ParsedStream[];
        }
        return video;
      });
    }
    return ParsedMetaSchema.parse(meta);
  }

  async getSubtitles(
    type: string,
    id: string,
    extras?: string
  ): Promise<Subtitle[]> {
    const validator = (data: any): Subtitle[] => {
      return this.validateArray(data.subtitles, SubtitleSchema, 'subtitles');
    };

    const subtitleTtl = resolveTtl(
      appConfig.resources.cache.subtitle.ttl,
      this.addon.preset.type,
      this.manifestUrl
    );
    return await this.makeResourceRequest(
      'subtitles',
      { type, id, extras },
      this.addon.timeout,
      validator,
      subtitleTtl != -1 ? subtitlesCache : undefined,
      subtitleTtl,
      this.preset.getCacheKey({
        resource: 'subtitles',
        type,
        id,
        options: this.addon.preset.options,
      })
    );
  }

  async getAddonCatalog(type: string, id: string): Promise<AddonCatalog[]> {
    const validator = (data: any): AddonCatalog[] => {
      return this.validateArray(
        data.addons,
        AddonCatalogSchema,
        'addon catalog items'
      );
    };

    const addonCatalogTtl = resolveTtl(
      appConfig.resources.cache.addonCatalog.ttl,
      this.addon.preset.type,
      this.manifestUrl
    );
    return await this.makeResourceRequest(
      'addon_catalog',
      { type, id },
      appConfig.resources.timeouts.catalog,
      validator,
      addonCatalogTtl != -1 ? addonCatalogCache : undefined,
      addonCatalogTtl,
      this.preset.getCacheKey({
        resource: 'addon_catalog',
        type,
        id,
        options: this.addon.preset.options,
      })
    );
  }

  async makeRequest(url: string, options: RequestOptions) {
    return await makeRequest(url, {
      headers: this.addon.headers,
      forwardIp: this.addon.ip,
      ...options,
    });
  }

  private async _request<T>(options: {
    requestFn: () => Promise<T>;
    timeout: number;
    resourceName: string;
    cacher?: Cache<string, T>;
    cacheKey: string;
    cacheTtl: number;
    shouldCache?: (data: T) => boolean;
    bypassCache?: boolean;
  }): Promise<T> {
    const {
      requestFn,
      timeout,
      resourceName,
      cacher,
      cacheKey,
      cacheTtl,
      shouldCache,
      bypassCache,
    } = options;

    let doBackground = appConfig.resources.background.enabled && cacher;

    let cached = null;

    if (cacher) {
      cached = await cacher.get(cacheKey);
      if (cached && !bypassCache) {
        logger.debug(
          { addon: this.getAddonName(this.addon), resource: resourceName },
          'returning cached resource'
        );
        return cached;
      }
    }

    const processRequest = async () => {
      const result = await requestFn();
      const doCache = shouldCache ? shouldCache(result) : true;
      // bypass cache only skips retrieving from cache, it still caches the result
      if (cacher && doCache) {
        await cacher.set(cacheKey, result, cacheTtl);
      }
      return result;
    };

    const requestPromise = processRequest();

    if (!doBackground) {
      return await requestPromise;
    }

    const timeoutPromise: Promise<T> = new Promise<T>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Request for ${resourceName} for ${this.getAddonName(this.addon)} timed out after ${timeout}ms`
            )
          ),
        timeout
      )
    );

    try {
      return await Promise.race([requestPromise, timeoutPromise]);
    } catch (error: any) {
      if (cached) {
        logger.warn(
          { addon: this.getAddonName(this.addon), resource: resourceName, err: error.message },
          'returning stale cache after request failure'
        );
        return cached;
      }
      if (error.message.includes('timed out')) {
        logger.warn(
          { addon: this.getAddonName(this.addon), resource: resourceName },
          'request timed out, continuing in background'
        );
        requestPromise.catch((bgError) => {
          logger.warn(
            { addon: this.getAddonName(this.addon), resource: resourceName, err: bgError.message },
            'background request failed'
          );
        });
      }
      throw error;
    }
  }

  private async makeResourceRequest<T>(
    resource: Resource,
    params: ResourceParams,
    timeout: number,
    validator: (data: unknown) => T,
    cacher: Cache<string, T> | undefined,
    cacheTtl: number,
    cacheKey?: string
  ) {
    const { type, id, extras } = params;
    const url = this.buildResourceUrl(resource, type, id, extras);
    const effectiveCacheKey = cacheKey || url;
    let doBackground = appConfig.resources.background.enabled && cacher;

    logger.debug(
      { addon: this.getAddonName(this.addon), resource, type, id, url: makeUrlLogSafe(url) },
      'fetching resource'
    );

    const requestFn = async (): Promise<T> => {
      const timeout = doBackground
        ? (appConfig.resources.background.timeout ??
          appConfig.userLimits.timeouts.maxTimeout)
        : this.addon.timeout;
      const res = await makeRequest(url, {
        timeout,
        headers: this.addon.headers,
        forwardIp: this.addon.ip,
      });

      if (!res.ok) {
        throw new Error(`${res.status} - ${res.statusText}`);
      }

      const data: unknown = await res.json();
      return validator(data);
    };

    const started = Date.now();
    try {
      const data = await this._request({
        requestFn,
        timeout,
        resourceName: resource,
        cacher,
        cacheKey: effectiveCacheKey,
        cacheTtl,
        shouldCache: (data: T) =>
          resource !== 'stream' || (Array.isArray(data) && data.length > 0),
      });
      const count = this.resultCountOf(data);
      track({
        event_type: 'addon_request',
        resource: resource as AnalyticsResource,
        preset_id: this.addon.preset.type,
        url_overridden: this.isUrlOverridden(),
        addon_instance_hash: hmac(this.manifestUrl),
        status: count === 0 ? 'empty' : 'ok',
        latency_ms: Date.now() - started,
        result_count: count,
      });
      return data;
    } catch (error) {
      const { error_stage, error_kind } = classifyAddonError(
        resource as AnalyticsErrorStage,
        error
      );
      track({
        event_type: 'addon_request',
        resource: resource as AnalyticsResource,
        preset_id: this.addon.preset.type,
        url_overridden: this.isUrlOverridden(),
        addon_instance_hash: hmac(this.manifestUrl),
        status: 'error',
        error_stage,
        error_kind,
        latency_ms: Date.now() - started,
      });
      throw error;
    }
  }

  /** Result count for analytics (arrays + {streams|metas|subtitles} shapes). */
  private resultCountOf(data: unknown): number | null {
    if (Array.isArray(data)) return data.length;
    if (data && typeof data === 'object') {
      for (const k of ['streams', 'metas', 'subtitles', 'catalogs']) {
        const v = (data as Record<string, unknown>)[k];
        if (Array.isArray(v)) return v.length;
      }
    }
    return null;
  }

  /**
   * True if the resolved manifest URL is not one of the preset's known
   * marketplace default URLs (a custom / full-manifest override). Used so
   * addon stats are only attributed to the named addon when trustworthy.
   */
  private isUrlOverridden(): boolean {
    try {
      const known: string[] =
        ((this.preset as unknown as typeof Preset).METADATA?.URL as
          | string[]
          | undefined) ?? [];
      if (known.length === 0) return false;
      const norm = (u: string) => u.replace(/\/+$/, '').toLowerCase();
      const m = norm(this.manifestUrl);
      return !known.some((k) => k && m.startsWith(norm(k)));
    } catch {
      return false;
    }
  }

  private buildResourceUrl(
    resource: Resource,
    type: string,
    id: string,
    extras?: string
  ): string {
    const extrasPath = extras ? `/${extras}` : '';
    const queryParams = new URL(this.manifestUrl).search;
    return `${this.baseUrl}/${resource}/${type}/${encodeURIComponent(id)}${extrasPath}.json${queryParams ? `?${queryParams.slice(1)}` : ''}`;
  }

  private getAddonName(addon: Addon): string {
    return `${addon.name}${addon.displayIdentifier || addon.identifier ? ` ${addon.displayIdentifier || addon.identifier}` : ''}`;
  }
}
