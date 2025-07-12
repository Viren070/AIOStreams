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
} from './db/schemas';
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
} from './utils';
import { PresetManager } from './presets';
import { StreamParser } from './parser';
import { z } from 'zod';

const logger = createLogger('wrappers');
// const cache = Cache.getInstance<string, any>('wrappers');
const manifestCache = Cache.getInstance<string, Manifest>('manifest');
const resourceCache = Cache.getInstance<string, any>('resources');

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

  constructor(addon: Addon) {
    this.addon = addon;
    this.manifestUrl = this.addon.manifestUrl.replace('stremio://', 'https://');
    this.baseUrl = this.manifestUrl.split('/').slice(0, -1).join('/');
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

  async getManifest(): Promise<Manifest> {
    return await manifestCache.wrap(
      async () => {
        logger.debug(
          `Fetching manifest for ${this.addon.name} ${this.addon.displayIdentifier || this.addon.identifier} (${makeUrlLogSafe(this.manifestUrl)})`
        );
        try {
          const res = await makeRequest(
            this.manifestUrl,
            Env.MANIFEST_TIMEOUT,
            this.addon.headers,
            this.addon.ip
          );
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
      },
      this.manifestUrl,
      Env.MANIFEST_CACHE_TTL
    );
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
      Env.STREAM_CACHE_TTL != -1,
      Env.STREAM_CACHE_TTL
    );
    const Parser = this.addon.presetType
      ? PresetManager.fromId(this.addon.presetType).getParser()
      : StreamParser;
    const parser = new Parser(this.addon);
    return streams
      .flatMap((stream: Stream) => parser.parse(stream))
      .filter((stream: any) => !stream.skip);
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
      Env.CATALOG_CACHE_TTL != -1,
      Env.CATALOG_CACHE_TTL
    );
  }

  async getMeta(type: string, id: string): Promise<Meta> {
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
      Env.META_CACHE_TTL != -1,
      Env.META_CACHE_TTL
    );
    return meta;
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
      Env.SUBTITLE_CACHE_TTL != -1,
      Env.SUBTITLE_CACHE_TTL
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
      Env.ADDON_CATALOG_CACHE_TTL != -1,
      Env.ADDON_CATALOG_CACHE_TTL
    );
  }

  async makeRequest(url: string, timeout: number = this.addon.timeout) {
    return await makeRequest(url, timeout, this.addon.headers, this.addon.ip);
  }

  private async makeResourceRequest<T>(
    resource: Resource,
    params: ResourceParams,
    timeout: number,
    validator: (data: unknown) => T,
    cache: boolean = false,
    cacheTtl: number = RESOURCE_TTL
  ) {
    const { type, id, extras } = params;
    const url = this.buildResourceUrl(resource, type, id, extras);
    if (cache) {
      const cached = resourceCache.get(url);
      if (cached) {
        logger.info(
          `Returning cached ${resource} for ${this.getAddonName(this.addon)} (${makeUrlLogSafe(url)})`
        );
        return cached;
      }
    }
    logger.info(
      `Fetching ${resource} of type ${type} with id ${id} and extras ${extras} (${makeUrlLogSafe(url)})`
    );
    try {
      const res = await makeRequest(
        url,
        timeout,
        this.addon.headers,
        this.addon.ip
      );
      if (!res.ok) {
        logger.error(
          `Failed to fetch ${resource} resource for ${this.getAddonName(this.addon)}: ${res.status} - ${res.statusText}`
        );

        throw new Error(`${res.status} - ${res.statusText}`);
      }
      const data: unknown = await res.json();

      const validated = validator(data);

      if (cache) {
        resourceCache.set(url, validated, cacheTtl);
      }
      return validated;
    } catch (error: any) {
      logger.error(
        `Failed to fetch ${resource} resource for ${this.getAddonName(this.addon)}: ${error.message}`
      );
      throw error;
    }
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
