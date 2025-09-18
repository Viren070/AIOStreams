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
} from './db/schemas.js';
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
  getTimeTakenSincePoint,
  RequestOptions,
} from './utils/index.js';
import { Preset, PresetManager } from './presets/index.js';
import { StreamParser } from './parser/index.js';
import { z } from 'zod';

const logger = createLogger('wrappers');

const manifestCache = Cache.getInstance<string, Manifest>(
  'manifest',
  Env.MANIFEST_CACHE_MAX_SIZE || Env.DEFAULT_MAX_CACHE_SIZE
);
const catalogCache = Cache.getInstance<string, MetaPreview[]>(
  'catalog',
  Env.CATALOG_CACHE_MAX_SIZE || Env.DEFAULT_MAX_CACHE_SIZE
);
const metaCache = Cache.getInstance<string, Meta>(
  'meta',
  Env.META_CACHE_MAX_SIZE || Env.DEFAULT_MAX_CACHE_SIZE
);
const subtitlesCache = Cache.getInstance<string, Subtitle[]>(
  'subtitles',
  Env.SUBTITLE_CACHE_MAX_SIZE || Env.DEFAULT_MAX_CACHE_SIZE
);
const addonCatalogCache = Cache.getInstance<string, AddonCatalog[]>(
  'addon_catalog',
  Env.ADDON_CATALOG_CACHE_MAX_SIZE || Env.DEFAULT_MAX_CACHE_SIZE
);
const streamsCache = Cache.getInstance<string, ParsedStream[]>(
  'streams',
  Env.STREAM_CACHE_MAX_SIZE || Env.DEFAULT_MAX_CACHE_SIZE
);

const RESOURCE_TTL = 5 * 60;

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
            `An item in the response for ${resourceName} was invalid, filtering it out: ${formatZodError(parsed.error)}`
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
        `Fetching manifest for ${this.addon.name} ${this.addon.displayIdentifier || this.addon.identifier} (${makeUrlLogSafe(this.manifestUrl)})`
      );
      try {
        const backgroundTimeout =
          Env.BACKGROUND_RESOURCE_REQUEST_TIMEOUT ?? Env.MAX_TIMEOUT;
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
          logger.error(`Manifest response was unexpected`);
          logger.error(formatZodError(manifest.error));
          logger.error(JSON.stringify(data, null, 2));
          throw new Error(
            `Manifest response could not be parsed: ${formatZodError(manifest.error)}`
          );
        }
        return manifest.data;
      } catch (error: any) {
        logger.error(
          `Failed to fetch manifest for ${this.getAddonName(this.addon)}: ${error.message}`
        );
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
      timeout: options?.timeout ?? Env.MANIFEST_TIMEOUT,
      resourceName: 'manifest',
      cacher: manifestCache,
      cacheKey,
      cacheTtl: Env.MANIFEST_CACHE_TTL,
      bypassCache: options?.bypassCache,
    });
  }

  async getStreams(type: string, id: string): Promise<ParsedStream[]> {
    const validator = (data: any): Stream[] => {
      return this.validateArray(data.streams, StreamSchema, 'streams');
    };

    const streams = await this.makeResourceRequest(
      'stream',
      { type, id },
      this.addon.timeout,
      validator,
      Env.STREAM_CACHE_TTL != -1 ? streamsCache : undefined,
      Env.STREAM_CACHE_TTL,
      this.preset.getCacheKey({
        resource: 'stream',
        type,
        id,
        options: this.addon.preset.options,
      })
    );
    const start = Date.now();
    const parser = new (this.preset.getParser())(this.addon);
    const parsedStreams = streams
      .flatMap((stream: Stream) => parser.parse(stream))
      .filter((stream: any) => !stream.skip);
    logger.debug(
      `Parsed ${parsedStreams.length} streams for ${this.getAddonName(this.addon)} in ${getTimeTakenSincePoint(start)}`
    );
    return parsedStreams as ParsedStream[];
  }

  async getCatalog(
    type: string,
    id: string,
    extras?: string
  ): Promise<MetaPreview[]> {
    const validator = (data: any): MetaPreview[] => {
      return this.validateArray(data.metas, MetaPreviewSchema, 'catalog items');
    };

    return await this.makeResourceRequest(
      'catalog',
      { type, id, extras },
      Env.CATALOG_TIMEOUT,
      validator,
      Env.CATALOG_CACHE_TTL != -1 ? catalogCache : undefined,
      Env.CATALOG_CACHE_TTL,
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
        logger.error(formatZodError(parsed.error));
        throw new Error(
          `Failed to parse meta for ${this.getAddonName(this.addon)}`
        );
      }
      return parsed.data;
    };
    const meta: Meta = await this.makeResourceRequest(
      'meta',
      { type, id },
      Env.META_TIMEOUT,
      validator,
      Env.META_CACHE_TTL != -1 ? metaCache : undefined,
      Env.META_CACHE_TTL,
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

    return await this.makeResourceRequest(
      'subtitles',
      { type, id, extras },
      this.addon.timeout,
      validator,
      Env.SUBTITLE_CACHE_TTL != -1 ? subtitlesCache : undefined,
      Env.SUBTITLE_CACHE_TTL,
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

    return await this.makeResourceRequest(
      'addon_catalog',
      { type, id },
      Env.CATALOG_TIMEOUT,
      validator,
      Env.ADDON_CATALOG_CACHE_TTL != -1 ? addonCatalogCache : undefined,
      Env.ADDON_CATALOG_CACHE_TTL,
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

    if (cacher && !bypassCache) {
      const cached = await cacher.get(cacheKey);
      if (cached) {
        logger.debug(
          `Returning cached ${resourceName} for ${this.getAddonName(this.addon)}`
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

    const timeoutPromise = new Promise<T>((_, reject) =>
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
      if (error.message.includes('timed out')) {
        logger.warn(
          `Request for ${resourceName} for ${this.getAddonName(this.addon)} timed out. Will process in background.`
        );
        requestPromise.catch((bgError) => {
          logger.warn(
            `Background request for ${resourceName} for ${this.getAddonName(this.addon)} failed: ${bgError.message}`
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
    cacheTtl: number = RESOURCE_TTL,
    cacheKey?: string
  ) {
    const { type, id, extras } = params;
    const url = this.buildResourceUrl(resource, type, id, extras);
    const effectiveCacheKey = cacheKey || url;

    logger.info(
      `Fetching ${resource} of type ${type} with id ${id} and extras ${extras} (${makeUrlLogSafe(url)})`,
      {
        cacheKey: cacheKey ? makeUrlLogSafe(cacheKey) : undefined,
      }
    );

    const requestFn = async (): Promise<T> => {
      try {
        const backgroundTimeout =
          Env.BACKGROUND_RESOURCE_REQUEST_TIMEOUT ?? Env.MAX_TIMEOUT;
        const res = await makeRequest(url, {
          timeout: backgroundTimeout,
          headers: this.addon.headers,
          forwardIp: this.addon.ip,
        });

        if (!res.ok) {
          logger.error(
            `Failed to fetch ${resource} resource for ${this.getAddonName(this.addon)}: ${res.status} - ${res.statusText}`
          );
          throw new Error(`${res.status} - ${res.statusText}`);
        }

        const data: unknown = await res.json();
        return validator(data);
      } catch (error: any) {
        logger.error(
          `Failed to fetch ${resource} resource for ${this.getAddonName(this.addon)}: ${error.message}`
        );
        throw error;
      }
    };

    return this._request({
      requestFn,
      timeout,
      resourceName: resource,
      cacher,
      cacheKey: effectiveCacheKey,
      cacheTtl,
      shouldCache: (data: T) =>
        resource !== 'stream' || (Array.isArray(data) && data.length > 0),
    });
  }

  private buildResourceUrl(
    resource: Resource,
    type: string,
    id: string,
    extras?: string
  ): string {
    const extrasPath = extras ? `/${extras}` : '';
    return `${this.baseUrl}/${resource}/${type}/${encodeURIComponent(id)}${extrasPath}.json`;
  }

  private getAddonName(addon: Addon): string {
    return `${addon.name}${addon.displayIdentifier || addon.identifier ? ` ${addon.displayIdentifier || addon.identifier}` : ''}`;
  }
}
