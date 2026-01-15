import {
  Addon,
  Manifest,
  Resource,
  StrictManifestResource,
  UserData,
} from './db/index.js';
import {
  constants,
  createLogger,
  Env,
  getSimpleTextHash,
  getTimeTakenSincePoint,
  maskSensitiveInfo,
  Cache,
  ExtrasParser,
  makeUrlLogSafe,
  AnimeDatabase,
  ParsedId,
  IdParser,
} from './utils/index.js';
import { Wrapper } from './wrapper.js';
import { PresetManager } from './presets/index.js';
import {
  AddonCatalog,
  MergedCatalog,
  Meta,
  MetaPreview,
  ParsedMeta,
  ParsedStream,
  Preset,
  Subtitle,
} from './db/schemas.js';
import { createProxy } from './proxy/index.js';
import { TopPoster } from './utils/top-poster.js';
import { RPDB } from './utils/rpdb.js';
import { FeatureControl } from './utils/feature.js';
import Proxifier from './streams/proxifier.js';
import StreamLimiter from './streams/limiter.js';
import {
  StreamFetcher as Fetcher,
  StreamFilterer as Filterer,
  StreamSorter as Sorter,
  StreamDeduplicator as Deduplicator,
  StreamPrecomputer as Precomputer,
  StreamUtils,
} from './streams/index.js';
import { getAddonName } from './utils/general.js';
import { TMDBMetadata } from './metadata/tmdb.js';
import { MetadataService } from './metadata/service.js';
import { Metadata } from './metadata/utils.js';
const logger = createLogger('core');

const shuffleCache = Cache.getInstance<string, MetaPreview[]>('shuffle');

type MergedCatalogSkipState = {
  sourceSkips: Record<string, number>; // What skip to send to each upstream source
};
const mergedCatalogCache = Cache.getInstance<string, MergedCatalogSkipState>(
  'merged_catalog'
);

const precacheCache = Cache.getInstance<string, boolean>(
  'precache',
  undefined,
  'memory'
);

export interface AIOStreamsError {
  title?: string;
  description?: string;
}

export interface AIOStreamsResponse<T> {
  success: boolean;
  data: T;
  errors: AIOStreamsError[];
}

export interface AIOStreamsOptions {
  skipFailedAddons?: boolean;
  increasedManifestTimeout?: boolean;
  bypassManifestCache?: boolean;
}

export class AIOStreams {
  private userData: UserData;
  private options: AIOStreamsOptions | undefined;
  private manifestUrl: string;
  private manifests: Record<string, Manifest | null>;
  private supportedResources: Record<string, StrictManifestResource[]>;
  private finalResources: StrictManifestResource[] = [];
  private finalCatalogs: Manifest['catalogs'] = [];
  private finalAddonCatalogs: Manifest['addonCatalogs'] = [];
  private isInitialised: boolean = false;
  private addons: Addon[] = [];
  private proxifier: Proxifier;
  private limiter: StreamLimiter;
  private fetcher: Fetcher;
  private filterer: Filterer;
  private deduplicator: Deduplicator;
  private sorter: Sorter;
  private precomputer: Precomputer;

  private addonInitialisationErrors: {
    addon: Addon | Preset;
    error: string;
  }[] = [];

  constructor(userData: UserData, options?: AIOStreamsOptions) {
    this.addonInitialisationErrors = [];
    this.userData = userData;
    this.manifestUrl = `${Env.BASE_URL}/stremio/${this.userData.uuid}/${this.userData.encryptedPassword}/manifest.json`;
    this.manifests = {};
    this.supportedResources = {};
    this.options = options;
    this.proxifier = new Proxifier(userData);
    this.limiter = new StreamLimiter(userData);
    this.filterer = new Filterer(userData);
    this.precomputer = new Precomputer(userData);
    this.fetcher = new Fetcher(userData, this.filterer, this.precomputer);
    this.deduplicator = new Deduplicator(userData);
    this.sorter = new Sorter(userData);
  }

  private setUserData(userData: UserData) {
    this.userData = userData;
  }

  public async initialise(): Promise<AIOStreams> {
    if (this.isInitialised) return this;
    await this.applyPresets();
    await this.assignPublicIps();
    await this.fetchManifests();
    await this.fetchResources();
    this.isInitialised = true;
    return this;
  }

  private checkInitialised() {
    if (!this.isInitialised) {
      throw new Error(
        'AIOStreams is not initialised. Call initialise() first.'
      );
    }
  }

  public async getStreams(
    id: string,
    type: string,
    preCaching: boolean = false
  ): Promise<
    AIOStreamsResponse<{
      streams: ParsedStream[];
      statistics: { title: string; description: string }[];
    }>
  > {
    logger.info(`Handling stream request`, { type, id });
    const statistics: { title: string; description: string }[] = [];
    // get a list of all addons that support the stream resource with the given type and id.
    const supportedAddons = [];
    for (const [instanceId, addonResources] of Object.entries(
      this.supportedResources
    )) {
      const resource = addonResources.find(
        (r) =>
          r.name === 'stream' &&
          r.types.includes(type) &&
          (r.idPrefixes
            ? r.idPrefixes?.some((prefix) => id.startsWith(prefix))
            : true) // if no id prefixes are defined, assume it supports all IDs
      );
      if (resource) {
        const addon = this.getAddon(instanceId);
        if (addon) {
          supportedAddons.push(addon);
        }
      }
    }

    logger.info(
      `Found ${supportedAddons.length} addons that support the stream resource`,
      {
        supportedAddons: supportedAddons.map((a) => a.name),
      }
    );

    // Fetch metadata for the stream and attach it to the addons
    const parsedId = IdParser.parse(id, type);
    if (parsedId) {
      const metadataService = new MetadataService({
        tmdbAccessToken: this.userData.tmdbAccessToken,
        tmdbApiKey: this.userData.tmdbApiKey,
        tvdbApiKey: this.userData.tvdbApiKey,
      });
      const metadata = await metadataService.getMetadata(parsedId, type as any);
      if (metadata) {
        supportedAddons.forEach((addon) => {
          addon.metadata = metadata;
        });
      }
    }

    const {
      streams,
      errors,
      statistics: addonStatistics,
    } = await this.fetcher.fetch(supportedAddons, type, id);

    if (
      this.userData.statistics?.enabled &&
      this.userData.statistics?.statsToShow?.includes('addon')
    ) {
      statistics.push(...addonStatistics);
    }

    // append initialisation errors to the errors array
    errors.push(
      ...this.addonInitialisationErrors.map((e) => ({
        title: `[❌] ${getAddonName(e.addon)}`,
        description: e.error,
      }))
    );

    const processResults = await this._processStreams(streams, type, id);
    let finalStreams = processResults.streams;
    errors.push(...processResults.errors);

    // if this.userData.precacheNextEpisode is true, start a new thread to request the next episode, check if
    // all provider streams are uncached, and only if so, then send a request to the first uncached stream in the list.
    if (this.userData.precacheNextEpisode && !preCaching) {
      // only precache if the same user hasn't previously cached the next episode of the current episode
      // within the last 24 hours (Env.PRECACHE_NEXT_EPISODE_MIN_INTERVAL)
      let precache = false;
      const cacheKey = `precache-${type}-${id}-${this.userData.uuid}`;
      const cachedNextEpisode = await precacheCache.get(cacheKey, false);
      if (cachedNextEpisode) {
        logger.info(
          `The current request for ${type} ${id} has already had the next episode precached within the last ${Env.PRECACHE_NEXT_EPISODE_MIN_INTERVAL} seconds (${precacheCache.getTTL(cacheKey)} seconds left). Skipping precaching.`
        );
        precache = false;
      } else {
        precache = true;
      }
      if (precache) {
        setImmediate(() => {
          this.precacheNextEpisode(type, id).catch((error) => {
            logger.error('Error during precaching:', {
              error: error instanceof Error ? error.message : String(error),
              type,
              id,
            });
          });
        });
      }
    }

    const { filterDetails, includedDetails } =
      this.filterer.getFormattedFilterDetails();

    // append formatted filter statistics to the statistics array
    // Helper to split details array into groups by 📌
    function splitByPin(details: string[]): string[][] {
      const groups: string[][] = [];
      let currentGroup: string[] = [];
      for (const line of details) {
        if (line.trim().startsWith('📌')) {
          if (currentGroup.length > 0) {
            groups.push(currentGroup);
          }
          currentGroup = [line];
        } else {
          currentGroup.push(line);
        }
      }
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }
      return groups;
    }

    if (
      this.userData.statistics?.enabled &&
      this.userData.statistics?.statsToShow?.includes('filter')
    ) {
      if (filterDetails.length > 0) {
        const removalGroups = splitByPin(filterDetails);
        for (const group of removalGroups) {
          statistics.push({
            title: '🔍 Removal Reasons',
            description: group.join('\n').trim(),
          });
        }
      }
      if (includedDetails.length > 0) {
        const includedGroups = splitByPin(includedDetails);
        for (const group of includedGroups) {
          statistics.push({
            title: '🔍 Included Reasons',
            description: group.join('\n').trim(),
          });
        }
      }
    }
    // return the final list of streams, followed by the error streams.
    logger.info(
      `Returning ${finalStreams.length} streams and ${errors.length} errors and ${statistics.length} statistic`
    );
    return {
      success: true,
      data: {
        streams: finalStreams,
        statistics: statistics,
      },
      errors: errors,
    };
  }

  /**
   * Fetches raw catalog items from a specific addon without applying any modifications.
   * Returns the raw items from the upstream addon.
   */
  private async fetchRawCatalogItems(
    addonInstanceId: string,
    catalogId: string,
    type: string,
    parsedExtras?: ExtrasParser
  ): Promise<{
    success: boolean;
    items: MetaPreview[];
    error?: { title: string; description: string };
  }> {
    const addon = this.getAddon(addonInstanceId);

    if (!addon) {
      const initError = (
        this.addonInitialisationErrors as { addon: Preset; error: string }[]
      ).find((e) => addonInstanceId.startsWith(e.addon.instanceId || ''));
      if (initError) {
        return {
          success: false,
          items: [],
          error: {
            title: `[❌] ${initError.error}`,
            description: `Addon ${addonInstanceId} failed to initialise. Try reinstalling/disabling/uninstalling the addon.`,
          },
        };
      }
      return {
        success: false,
        items: [],
        error: {
          title: `Addon ${addonInstanceId} not found. Try reinstalling the addon.`,
          description: 'Addon not found',
        },
      };
    }

    // Check for type override in modifications
    let actualType = type;
    const modification = this.userData.catalogModifications?.find(
      (mod) =>
        mod.id === `${addonInstanceId}.${catalogId}` &&
        (mod.type === type || mod.overrideType === type)
    );
    if (modification?.overrideType) {
      actualType = modification.type;
    }

    if (parsedExtras?.genre === 'None') {
      parsedExtras.genre = undefined;
    }
    const extrasString = parsedExtras?.toString();

    try {
      const start = Date.now();
      const catalog = await new Wrapper(addon).getCatalog(
        actualType,
        catalogId,
        extrasString
      );
      logger.info(
        `Received catalog ${catalogId} of type ${actualType} from ${addon.name} in ${getTimeTakenSincePoint(start)}`
      );
      return { success: true, items: catalog };
    } catch (error) {
      return {
        success: false,
        items: [],
        error: {
          title: `[❌] ${addon.name}`,
          description: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  public async getCatalog(
    type: string,
    id: string,
    extras?: string
  ): Promise<AIOStreamsResponse<MetaPreview[]>> {
    logger.info(`Handling catalog request`, { type, id, extras });

    if (id.startsWith('aiostreams.merged.')) {
      return this.getMergedCatalog(type, id, extras);
    }

    // Get the addon instance id and actual catalog id from the id
    const addonInstanceId = id.split('.', 2)[0];
    const actualCatalogId = id.split('.').slice(1).join('.');

    const parsedExtras = new ExtrasParser(extras);

    // Fetch raw catalog items
    const result = await this.fetchRawCatalogItems(
      addonInstanceId,
      actualCatalogId,
      type,
      parsedExtras
    );

    if (!result.success) {
      // If there's a skip in extras, return empty on error (pagination end)
      if (extras && extras.includes('skip')) {
        return { success: true, data: [], errors: [] };
      }
      return {
        success: false,
        data: [],
        errors: result.error ? [result.error] : [],
      };
    }

    // // Use extras as part of cache key so different extras get different shuffle
    const shuffleCacheKey = `${type}-${actualCatalogId}-${parsedExtras?.toString() || ''}-${this.userData.uuid}`;

    // Apply catalog modifications (shuffle, reverse, RPDB, etc.)
    const catalog = await this.applyCatalogModifications(
      result.items,
      id,
      type,
      parsedExtras,
      shuffleCacheKey
    );

    return { success: true, data: catalog, errors: [] };
  }

  /**
   * Applies catalog modifications like shuffle, reverse, RPDB posters, etc.
   * Used by getCatalog for standalone catalogs and getMergedCatalog for source catalogs.
   */
  private async applyCatalogModifications(
    items: MetaPreview[],
    catalogId: string,
    type: string,
    parsedExtras?: ExtrasParser,
    shuffleCacheKey?: string
  ): Promise<MetaPreview[]> {
    let catalog = [...items];
    const isSearch = parsedExtras?.search;

    const modification = this.userData.catalogModifications?.find(
      (mod) =>
        mod.id === catalogId && (mod.type === type || mod.overrideType === type)
    );
    const applyShuffle = modification?.shuffle && !isSearch && shuffleCacheKey;
    const applyReverse = !applyShuffle && modification?.reverse && !isSearch;

    logger.debug(`Applying catalog modifications`, {
      catalogId,
      type,
      modificationFound: !!modification,
      posterService:
        modification?.usePosterService === true &&
        this.userData.posterService !== 'none'
          ? this.userData.posterService
          : false,
      shuffle: !!applyShuffle,
      reverse: !!applyReverse,
    });

    // Apply shuffle if enabled (not for search requests)
    if (applyShuffle) {
      // const actualCatalogId = catalogId.split('.').slice(1).join('.');
      // // Use extras as part of cache key so different extras get different shuffle
      // const cacheKey = `${type}-${actualCatalogId}-${parsedExtras?.toString() || ''}-${this.userData.uuid}`;
      const cachedShuffle = await shuffleCache.get(shuffleCacheKey);
      if (cachedShuffle) {
        catalog = cachedShuffle;
      } else {
        for (let i = catalog.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [catalog[i], catalog[j]] = [catalog[j], catalog[i]];
        }
        if (modification.persistShuffleFor) {
          await shuffleCache.set(
            shuffleCacheKey,
            catalog,
            modification.persistShuffleFor * 3600
          );
        }
      }
    } else if (applyReverse) {
      catalog = catalog.reverse();
    }

    // Apply poster modifications (usePosterService only if modification has usePosterService enabled)
    const applyPosterService = modification?.usePosterService === true;
    catalog = await this.applyPosterModifications(
      catalog,
      type,
      applyPosterService
    );

    return catalog;
  }

  private async getMergedCatalog(
    type: string,
    id: string,
    extras?: string
  ): Promise<AIOStreamsResponse<MetaPreview[]>> {
    const start = Date.now();
    const mergedCatalog = this.userData.mergedCatalogs?.find(
      (mc) => mc.id === id
    );

    if (!mergedCatalog) {
      logger.error(`Merged catalog ${id} not found`);
      return {
        success: false,
        data: [],
        errors: [
          {
            title: `Merged catalog ${id} not found`,
            description: 'Try reinstalling the addon.',
          },
        ],
      };
    }

    if (mergedCatalog.type !== type) {
      logger.error(
        `Merged catalog ${id} type mismatch: expected ${mergedCatalog.type}, got ${type}`
      );
      return {
        success: false,
        data: [],
        errors: [
          {
            title: `Type mismatch for merged catalog ${id}`,
            description: `Expected ${mergedCatalog.type}, got ${type}`,
          },
        ],
      };
    }

    const parsedExtras = new ExtrasParser(extras);
    const requestedSkip = parsedExtras.skip || 0;
    const isSearchRequest = !!parsedExtras.search;
    const requestedGenre = parsedExtras.genre;

    // Build base cache key from extras (excluding skip) and merged catalog config
    const extrasForCacheKey = new ExtrasParser(extras);
    extrasForCacheKey.skip = undefined;
    const extrasCacheKeyPart = extrasForCacheKey.toString();

    // Include a hash of the merged catalog config in the cache key
    const configHash = getSimpleTextHash(
      JSON.stringify({
        catalogIds: mergedCatalog.catalogIds,
        deduplicationMethods: mergedCatalog.deduplicationMethods,
        mergeMethod: mergedCatalog.mergeMethod,
      })
    );
    const baseCacheKey = `${id}-${this.userData.uuid}-${configHash}${extrasCacheKeyPart ? `-${extrasCacheKeyPart}` : ''}`;
    const skipCacheKey = `${baseCacheKey}-skip=${requestedSkip}`;

    let skipState: MergedCatalogSkipState | undefined;

    if (requestedSkip === 0) {
      // For skip=0, always start fresh with all sources at skip=0
      skipState = { sourceSkips: {} };
      for (const encodedCatalogId of mergedCatalog.catalogIds) {
        skipState.sourceSkips[encodedCatalogId] = 0;
      }
    } else {
      skipState = await mergedCatalogCache.get(skipCacheKey);
      if (!skipState) {
        // No cached state for this skip value - either cache expired or invalid skip
        // Return empty to signal end of pagination
        logger.warn(
          `No cached state for merged catalog ${id} at skip=${requestedSkip}. ` +
            `Cache may have expired or skip value is invalid.`
        );
        return { success: true, data: [], errors: [] };
      }
    }

    // Track next skip values for each source (to store for the next page)
    const nextSourceSkips: Record<string, number> = {
      ...skipState.sourceSkips,
    };

    const fetchPromises = mergedCatalog.catalogIds.map(
      async (encodedCatalogId: string) => {
        logger.debug(`Handling merged catalog source`, { encodedCatalogId });
        const params = new URLSearchParams(encodedCatalogId);
        const catalogId = params.get('id');
        const catalogType = params.get('type');
        if (!catalogId || !catalogType) {
          return {
            encodedCatalogId,
            items: [],
            fetched: 0,
            success: false,
            skipped: false,
          };
        }

        const addonInstanceId = catalogId.split('.', 2)[0];
        const actualCatalogId = catalogId.split('.').slice(1).join('.');

        // Smart filtering: check if this source supports the requested extras
        const catalogExtras = this.getCatalogExtras(
          addonInstanceId,
          actualCatalogId,
          catalogType
        );

        // If search is requested but catalog doesn't support search, skip it
        if (
          isSearchRequest &&
          !catalogExtras?.some((e) => e.name === 'search')
        ) {
          logger.debug(
            `Skipping source ${encodedCatalogId} for merged catalog ${mergedCatalog.name}: doesn't support search`
          );
          return {
            encodedCatalogId,
            items: [],
            fetched: 0,
            success: true,
            skipped: true,
          };
        }

        // If genre is requested, check if catalog supports it and has the genre option
        if (requestedGenre && requestedGenre !== 'None') {
          const genreExtra = catalogExtras?.find((e) => e.name === 'genre');
          if (!genreExtra) {
            logger.debug(
              `Skipping source ${encodedCatalogId} for merged catalog ${mergedCatalog.name}: doesn't support genre extra`
            );
            return {
              encodedCatalogId,
              items: [],
              fetched: 0,
              success: true,
              skipped: true,
            };
          }
          // If the genre extra has specific options, check if the requested genre is available
          if (genreExtra.options && genreExtra.options.length > 0) {
            const hasGenre = genreExtra.options.some(
              (opt) => opt === requestedGenre || opt === null // null can mean "all genres"
            );
            if (!hasGenre) {
              logger.debug(
                `Skipping source ${encodedCatalogId} for merged catalog ${mergedCatalog.name}: doesn't have genre "${requestedGenre}"`
              );
              return {
                encodedCatalogId,
                items: [],
                fetched: 0,
                success: true,
                skipped: true,
              };
            }
          }
        }

        const sourceSkip = skipState!.sourceSkips[encodedCatalogId] || 0;
        const supportsSkip = catalogExtras?.some((e) => e.name === 'skip');

        // If this catalog doesn't support skip and we've already fetched from it once,
        // mark it as exhausted to prevent returning the same items repeatedly
        if (!supportsSkip && sourceSkip > 0) {
          logger.debug(
            `Skipping source ${encodedCatalogId} for merged catalog ${mergedCatalog.name}: doesn't support skip and already fetched (exhausted)`
          );
          return {
            encodedCatalogId,
            items: [],
            fetched: 0,
            success: true,
            skipped: true,
          };
        }

        // Build source extras - copy all extras and set the appropriate skip for this source
        // Only include skip if the catalog supports it
        const sourceExtras = new ExtrasParser(extras);
        if (supportsSkip) {
          sourceExtras.skip = sourceSkip > 0 ? sourceSkip : undefined;
        } else {
          sourceExtras.skip = undefined; // Don't send skip to catalogs that don't support it
        }

        // now check whether the catalog requires an extra but we dont have it - in which case we skip it
        const requiredExtras = catalogExtras?.filter((e) => e.isRequired);
        if (requiredExtras && requiredExtras.length > 0) {
          for (const reqExtra of requiredExtras) {
            if (!sourceExtras.has(reqExtra.name)) {
              logger.debug(
                `Skipping source ${encodedCatalogId} for merged catalog ${mergedCatalog.name}: missing required extra "${reqExtra.name}"`
              );
              return {
                encodedCatalogId,
                items: [],
                fetched: 0,
                success: true,
                skipped: true,
              };
            }
          }
        }

        logger.debug('Fetching merged catalog source', {
          encodedCatalogId,
          addonInstanceId,
          catalogType,
          constructedExtras: sourceExtras.toString(),
        });

        const result = await this.fetchRawCatalogItems(
          addonInstanceId,
          actualCatalogId,
          catalogType,
          sourceExtras
        );

        if (!result.success) {
          logger.warn(
            `Failed to fetch source catalog ${encodedCatalogId} for merged catalog ${mergedCatalog.name} at skip=${requestedSkip}: ${
              result.error
                ? maskSensitiveInfo(result.error.description || '')
                : 'Unknown error'
            }`
          );
          return {
            encodedCatalogId,
            items: [],
            fetched: 0,
            success: false,
            skipped: false,
          };
        }

        return {
          encodedCatalogId,
          items: result.items,
          fetched: result.items.length,
          success: true,
          skipped: false,
        };
      }
    );

    logger.debug(
      `Fetching merged catalog ${mergedCatalog.name} at skip=${requestedSkip}`,
      {
        upstreamAddons: fetchPromises.length,
      }
    );

    const fetchResults = await Promise.all(fetchPromises);

    // Check if ALL non-skipped sources failed
    const nonSkippedResults = fetchResults.filter((r) => !r.skipped);
    const allFailed =
      nonSkippedResults.length > 0 &&
      nonSkippedResults.every((r) => !r.success);
    if (allFailed) {
      logger.error(
        `All sources failed for merged catalog ${mergedCatalog.name}`
      );
      return {
        success: false,
        data: [],
        errors: [
          {
            title: `All sources failed for merged catalog ${mergedCatalog.name}`,
            description:
              'Unable to fetch items from any source catalog. Please try again later.',
          },
        ],
      };
    }

    // Collect items per source for merge method processing
    const itemsBySource: MetaPreview[][] = [];
    for (const { encodedCatalogId, items, fetched, skipped } of fetchResults) {
      // Don't update skip tracking for skipped sources - they weren't queried
      if (skipped) continue;

      // Update next skip for this source (current skip + items returned)
      nextSourceSkips[encodedCatalogId] =
        (skipState.sourceSkips[encodedCatalogId] || 0) + fetched;
      itemsBySource.push(items);
    }

    // Apply merge method
    let allItems: MetaPreview[] = this.applyMergeMethod(
      itemsBySource,
      mergedCatalog.mergeMethod
    );

    logger.debug(
      `Merged catalog ${mergedCatalog.name} collected ${allItems.length} items before deduplication`
    );

    // Deduplicate the collected items
    allItems = this.deduplicateMergedCatalog(
      allItems,
      mergedCatalog.deduplicationMethods
    );

    const shuffleCacheKey = `${baseCacheKey}-skip=${requestedSkip}-shuffle`;

    // Apply catalog modifications (shuffle, reverse, RPDB) to the merged catalog
    allItems = await this.applyCatalogModifications(
      allItems,
      id,
      type,
      parsedExtras,
      shuffleCacheKey
    );

    // Calculate the next skip value (current skip + items we're returning)
    const nextSkip = requestedSkip + allItems.length;

    // Cache the state for the next page (keyed by the next skip value)
    // This creates a chain: skip=0 stores state for skip=35, skip=35 stores state for skip=73, etc.
    if (allItems.length > 0) {
      const nextSkipCacheKey = `${baseCacheKey}-skip=${nextSkip}`;
      await mergedCatalogCache.set(
        nextSkipCacheKey,
        { sourceSkips: nextSourceSkips },
        3600 // 1 hour expiry, this should be fine
      );
    }

    logger.info(
      `Merged catalog ${mergedCatalog.name} fetched ${allItems.length} items at skip=${requestedSkip}, next skip=${nextSkip} in ${getTimeTakenSincePoint(start)}`
    );

    return { success: true, data: allItems, errors: [] };
  }

  /**
   * Applies merge method to combine items from multiple source catalogs.
   */
  private applyMergeMethod(
    itemsBySource: MetaPreview[][],
    method?: MergedCatalog['mergeMethod']
  ): MetaPreview[] {
    const mergeMethod = method || 'sequential';

    switch (mergeMethod) {
      case 'interleave': {
        // Interleave: take 1st from each source, then 2nd from each, etc.
        const result: MetaPreview[] = [];
        const maxLength = Math.max(
          0,
          ...itemsBySource.map((arr) => arr.length)
        );
        for (let i = 0; i < maxLength; i++) {
          for (const sourceItems of itemsBySource) {
            if (i < sourceItems.length) {
              result.push(sourceItems[i]);
            }
          }
        }
        return result;
      }

      case 'imdbRating': {
        // Merge all and sort by IMDB rating (descending)
        const allItems = itemsBySource.flat();
        return allItems.sort((a, b) => {
          const ratingA = parseFloat(a.imdbRating?.toString() ?? '0');
          const ratingB = parseFloat(b.imdbRating?.toString() ?? '0');
          if (isNaN(ratingA) && isNaN(ratingB)) return 0;
          if (isNaN(ratingA)) return 1;
          if (isNaN(ratingB)) return -1;
          return ratingB - ratingA;
        });
      }

      case 'releaseDateAsc': {
        // Merge all and sort by release date (oldest first)
        const allItems = itemsBySource.flat();
        return allItems.sort((a, b) => {
          const yearA = this.extractYear(a.releaseInfo);
          const yearB = this.extractYear(b.releaseInfo);
          return yearA - yearB;
        });
      }

      case 'releaseDateDesc': {
        // Merge all and sort by release date (newest first)
        const allItems = itemsBySource.flat();
        return allItems.sort((a, b) => {
          const yearA = this.extractYear(a.releaseInfo);
          const yearB = this.extractYear(b.releaseInfo);
          return yearB - yearA;
        });
      }

      case 'sequential':
      default:
        // Just concatenate in order of catalogIds
        return itemsBySource.flat();
    }
  }

  /**
   * Extracts a year from releaseInfo which can be a number (year) or string (year or year-year range).
   * For ranges like "2020-2024", returns the first year.
   */
  private extractYear(releaseInfo: number | string | undefined | null): number {
    if (releaseInfo === undefined || releaseInfo === null) return 0;
    if (typeof releaseInfo === 'number') return releaseInfo;
    // Handle string formats: "2020" or "2020-2024"
    const match = String(releaseInfo).match(/^(\d{4})/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Gets the extras configuration for a specific catalog from an addon's manifest.
   * Used to determine what extras (search, genre, etc.) a catalog supports.
   */
  private getCatalogExtras(
    addonInstanceId: string,
    catalogId: string,
    catalogType: string
  ): Manifest['catalogs'][number]['extra'] | undefined {
    const manifest = this.manifests[addonInstanceId];
    if (!manifest) return undefined;

    const catalog = manifest.catalogs?.find(
      (c) => c.id === catalogId && c.type === catalogType
    );
    return catalog?.extra;
  }

  /**
   * Applies poster modifications to catalog items.
   * @param items - The catalog items to modify
   * @param type - The catalog type (movie, series, etc.)
   * @param applyRpdb - Whether to apply RPDB poster modifications (requires user to have API key configured)
   */
  private async applyPosterModifications(
    items: MetaPreview[],
    type: string,
    applyPosterService: boolean = true
  ): Promise<MetaPreview[]> {
    const posterService = applyPosterService
      ? this.userData.posterService ||
        (this.userData.rpdbApiKey ? 'rpdb' : undefined)
      : undefined;
    const posterApiKey =
      posterService === 'rpdb'
        ? this.userData.rpdbApiKey
        : posterService === 'top-poster'
          ? this.userData.topPosterApiKey
          : undefined;
    const posterApi = posterApiKey
      ? posterService === 'rpdb'
        ? new RPDB(posterApiKey)
        : posterService === 'top-poster'
          ? new TopPoster(posterApiKey)
          : undefined
      : undefined;

    return Promise.all(
      items.map(async (item) => {
        if (posterApi && item.poster) {
          let posterUrl = item.poster;
          if (
            posterUrl.includes('api.ratingposterdb.com') ||
            posterUrl.includes('api.top-streaming.stream')
          ) {
            // already a poster from a poster service, do nothing.
          } else if (this.userData.usePosterRedirectApi) {
            const itemId = (item as any).imdb_id || item.id;
            const url = new URL(Env.BASE_URL);
            url.pathname =
              posterService === 'rpdb' ? '/api/v1/rpdb' : '/api/v1/top-poster';
            url.searchParams.set('id', itemId);
            url.searchParams.set('type', type);
            url.searchParams.set('fallback', item.poster);
            url.searchParams.set('apiKey', posterApiKey!);
            posterUrl = url.toString();
          } else if (posterApi) {
            const servicePosterUrl = await posterApi.getPosterUrl(
              type,
              (item as any).imdb_id || item.id,
              false
            );
            if (servicePosterUrl) {
              posterUrl = servicePosterUrl;
            }
          }
          item.poster = posterUrl;
        }

        if (this.userData.enhancePosters && Math.random() < 0.2) {
          item.poster = Buffer.from(
            constants.DEFAULT_POSTERS[
              Math.floor(Math.random() * constants.DEFAULT_POSTERS.length)
            ],
            'base64'
          ).toString('utf-8');
        }

        if (item.links) {
          item.links = this.convertDiscoverDeepLinks(item.links);
        }
        return item;
      })
    );
  }

  private deduplicateMergedCatalog(
    items: MetaPreview[],
    methods?: ('id' | 'title')[]
  ): MetaPreview[] {
    if (!methods || methods.length === 0) {
      return items;
    }

    const seenIds = new Set<string>();
    const seenTitles = new Set<string>();

    return items.filter((item) => {
      const itemIds = [item.id, (item as any).imdb_id].filter(Boolean);
      const title = (item.name || item.id).toLowerCase();

      const isDuplicateById =
        methods.includes('id') && itemIds.some((id) => seenIds.has(id));
      const isDuplicateByTitle =
        methods.includes('title') && seenTitles.has(title);

      if (isDuplicateById || isDuplicateByTitle) {
        return false;
      }

      itemIds.forEach((id) => seenIds.add(id));
      seenTitles.add(title);
      return true;
    });
  }

  public async getMeta(
    type: string,
    id: string
  ): Promise<AIOStreamsResponse<ParsedMeta | null>> {
    logger.info(`Handling meta request`, { type, id });

    // Build prioritized list of candidate addons (naturally ordered by priority)
    const candidates: Array<{
      instanceId: string;
      addon: any;
      reason: string;
    }> = [];

    // Step 1: Find addons with matching idPrefix (added first = higher priority)
    for (const [instanceId, resources] of Object.entries(
      this.supportedResources
    )) {
      const resource = resources.find(
        (r) =>
          r.name === 'meta' &&
          r.types.includes(type) &&
          r.idPrefixes?.some((prefix) => id.startsWith(prefix))
      );

      if (resource) {
        const addon = this.getAddon(instanceId);
        if (addon) {
          candidates.push({
            instanceId,
            addon,
            reason: 'matching id prefix',
          });
        }
      }
    }

    // Step 2: Find addons that support meta for this type (added second = lower priority)
    for (const [instanceId, resources] of Object.entries(
      this.supportedResources
    )) {
      // Skip if already added with higher priority
      if (candidates.some((c) => c.instanceId === instanceId)) {
        continue;
      }

      // look for addons that support the type, but don't have an id prefix
      const resource = resources.find(
        (r) =>
          r.name === 'meta' && r.types.includes(type) && !r.idPrefixes?.length
      );

      if (resource) {
        const addon = this.getAddon(instanceId);
        if (addon) {
          candidates.push({
            instanceId,
            addon,
            reason: 'general type support',
          });
        }
      }
    }

    if (candidates.length === 0) {
      logger.warn(`No supported addon was found for the requested meta`, {
        type,
        id,
      });
      return {
        success: false,
        data: null,
        errors: [],
      };
    }

    // Try each candidate in order, collecting errors
    const errors: Array<{ title: string; description: string }> = [];

    for (const candidate of candidates) {
      logger.info(`Trying addon for meta resource`, {
        addonName: candidate.addon.name,
        addonInstanceId: candidate.instanceId,
        reason: candidate.reason,
      });

      try {
        const meta = await new Wrapper(candidate.addon).getMeta(type, id);
        logger.info(`Successfully got meta from addon`, {
          addonName: candidate.addon.name,
          addonInstanceId: candidate.instanceId,
        });
        if (this.userData.usePosterServiceForMeta) {
          await this.applyPosterModifications([meta], type, true);
        } else {
          meta.links = this.convertDiscoverDeepLinks(meta.links);
        }

        if (meta.videos) {
          meta.videos = await Promise.all(
            meta.videos.map(async (video) => {
              if (!video.streams) {
                return video;
              }
              video.streams = (
                await this._processStreams(video.streams, type, id, true)
              ).streams;
              return video;
            })
          );
        }
        return {
          success: true,
          data: meta,
          errors: [], // Clear errors on success
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to get meta from addon ${candidate.addon.name}`, {
          error: errorMessage,
          reason: candidate.reason,
        });

        // don't push errors if the reason for trying was general type support
        // this is to ensure that we don't block stremio from making requests to other addons
        // which may potentially be the intended addon
        if (candidate.reason === 'general type support') {
          continue;
        }

        errors.push({
          title: `[❌] ${candidate.addon.name}`,
          description: errorMessage,
        });
      }
    }

    // If we reach here, all addons failed
    logger.error(
      `All ${candidates.length} candidate addons failed for meta request`,
      {
        type,
        id,
        candidateCount: candidates.length,
      }
    );

    return {
      success: false,
      data: null,
      errors,
    };
  }
  // subtitle resource
  public async getSubtitles(
    type: string,
    id: string,
    extras?: string
  ): Promise<AIOStreamsResponse<Subtitle[]>> {
    logger.info(`Handling subtitle request`, { type, id, extras });

    // Find all addons that support subtitles for this type and id prefix
    const supportedAddons = [];
    for (const [instanceId, addonResources] of Object.entries(
      this.supportedResources
    )) {
      const resource = addonResources.find(
        (r) =>
          r.name === 'subtitles' &&
          r.types.includes(type) &&
          (r.idPrefixes
            ? r.idPrefixes.some((prefix) => id.startsWith(prefix))
            : true)
      );
      if (resource) {
        const addon = this.getAddon(instanceId);
        if (addon) {
          supportedAddons.push(addon);
        }
      }
    }
    const parsedExtras = new ExtrasParser(extras);
    logger.debug(`Parsed extras: ${JSON.stringify(parsedExtras)}`);

    // Request subtitles from all supported addons in parallel
    let errors: AIOStreamsError[] = this.addonInitialisationErrors.map(
      (error) => ({
        title: `[❌] ${getAddonName(error.addon)}`,
        description: error.error,
      })
    );
    let allSubtitles: Subtitle[] = [];

    await Promise.all(
      supportedAddons.map(async (addon) => {
        try {
          const subtitles = await new Wrapper(addon).getSubtitles(
            type,
            id,
            parsedExtras.toString()
          );
          if (subtitles) {
            allSubtitles.push(...subtitles);
          }
        } catch (error) {
          errors.push({
            title: `[❌] ${getAddonName(addon)}`,
            description: error instanceof Error ? error.message : String(error),
          });
        }
      })
    );

    return {
      success: true,
      data: allSubtitles,
      errors: errors,
    };
  }

  // addon_catalog resource
  public async getAddonCatalog(
    type: string,
    id: string
  ): Promise<AIOStreamsResponse<AddonCatalog[]>> {
    logger.info(`getAddonCatalog: ${id}`);
    // step 1
    // get the addon instance id from the id
    const addonInstanceId = id.split('.', 2)[0];
    const addon = this.getAddon(addonInstanceId);
    if (!addon) {
      return {
        success: false,
        data: [],
        errors: [
          {
            title: `Addon ${addonInstanceId} not found`,
            description: 'Addon not found',
          },
        ],
      };
    }

    // step 2
    // get the actual addon catalog id from the id
    const actualAddonCatalogId = id.split('.').slice(1).join('.');

    // step 3
    // get the addon catalog from the addon
    let addonCatalogs: AddonCatalog[] = [];
    try {
      addonCatalogs = await new Wrapper(addon).getAddonCatalog(
        type,
        actualAddonCatalogId
      );
    } catch (error) {
      return {
        success: false,
        data: [],
        errors: [
          {
            title: `[❌] ${getAddonName(addon)}`,
            description: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
    // step 4
    return {
      success: true,
      data: addonCatalogs,
      errors: [],
    };
  }
  // converts all addons to
  private async applyPresets() {
    if (!this.userData.presets) {
      return;
    }

    for (const preset of this.userData.presets.filter((p) => p.enabled)) {
      try {
        const Preset = PresetManager.fromId(preset.type);
        if (Preset.METADATA.DISABLED) {
          throw new Error(
            `${Preset.METADATA.NAME} has been ${Preset.METADATA.DISABLED.removed ? 'removed' : 'disabled'}: ${Preset.METADATA.DISABLED.reason}`
          );
        }
        const addons = await Preset.generateAddons(
          this.userData,
          preset.options
        );
        this.addons.push(
          ...addons.map(
            (a): Addon => ({
              ...a,
              preset: {
                ...a.preset,
                id: preset.instanceId,
              },
              // if no identifier is present, we can assume that the preset can only generate one addon at a time and so no
              // unique identifier is needed as the preset instance id is enough to identify the addon
              instanceId: `${preset.instanceId}${getSimpleTextHash(`${a.identifier ?? ''}`).slice(0, 4)}`,
            })
          )
        );
      } catch (error) {
        if (this.options?.skipFailedAddons !== false) {
          this.addonInitialisationErrors.push({
            addon: preset,
            error: error instanceof Error ? error.message : String(error),
          });
          logger.error(
            `${error instanceof Error ? error.message : String(error)}, skipping`
          );
        } else {
          throw error;
        }
      }
    }

    if (this.addons.length > Env.MAX_ADDONS) {
      throw new Error(
        `Your current configuration requires ${this.addons.length} addons, but the maximum allowed is ${Env.MAX_ADDONS}. Please reduce the number of addons installed or services enabled. If you own the instance or know the owner, increase the value of the MAX_ADDONS environment variable.`
      );
    }
  }

  private async fetchManifests() {
    this.manifests = Object.fromEntries(
      await Promise.all(
        this.addons.map(async (addon) => {
          try {
            this.validateAddon(addon);
            return [
              addon.instanceId,
              await new Wrapper(addon).getManifest({
                timeout: this.options?.increasedManifestTimeout
                  ? Env.MANIFEST_INCREASED_TIMEOUT
                  : undefined,
                bypassCache: this.options?.bypassManifestCache,
              }),
            ];
          } catch (error: any) {
            if (this.options?.skipFailedAddons !== false) {
              this.addonInitialisationErrors.push({
                addon: addon,
                error: error.message,
              });
              logger.error(`${error.message}, skipping`);
              return [addon.instanceId, null];
            }
            throw error;
          }
        })
      )
    );
  }

  private async fetchResources() {
    for (const [instanceId, manifest] of Object.entries(this.manifests)) {
      if (!manifest) continue;

      // Convert string resources to StrictManifestResource objects
      let addonResources = manifest.resources.map((resource) => {
        if (typeof resource === 'string') {
          return {
            name: resource as Resource,
            types: manifest.types,
            idPrefixes: manifest.idPrefixes,
          };
        }
        return resource;
      });

      if (manifest.catalogs) {
        const existing = addonResources.find((r) => r.name === 'catalog');
        if (existing) {
          existing.types = [
            ...new Set([
              ...manifest.catalogs.map((c) => {
                const type = c.type;
                const modification = this.userData.catalogModifications?.find(
                  (m) => m.id === `${instanceId}.${c.id}` && m.type === type
                );
                return modification?.overrideType ?? type;
              }),
            ]),
          ];
        } else {
          addonResources.push({
            name: 'catalog',
            types: manifest.catalogs.map((c) => {
              const type = c.type;
              const modification = this.userData.catalogModifications?.find(
                (m) => m.id === `${instanceId}.${c.id}` && m.type === type
              );
              return modification?.overrideType ?? type;
            }),
          });
        }
      }

      const addon = this.getAddon(instanceId);

      if (!addon) {
        logger.error(`Addon with instanceId ${instanceId} not found`);
        continue;
      }

      // Filter and merge resources
      for (const resource of addonResources) {
        if (
          addon.resources &&
          addon.resources.length > 0 &&
          !addon.resources.includes(resource.name)
        ) {
          addonResources = addonResources.filter(
            (r) => r.name !== resource.name
          );
          continue;
        }

        const existing = this.finalResources.find(
          (r) => r.name === resource.name
        );
        // NOTE: we cannot push idPrefixes in the scenario that the user adds multiple addons that provide meta for example,
        // and one of them has defined idPrefixes, while the other hasn't
        // in this case, stremio assumes we only support that resource for the specified id prefix and then
        // will not send a request to AIOStreams for other id prefixes even though our other addon that didn't specify
        // an id prefix technically says it supports all ids

        // leaving idPrefixes as null/undefined causes various odd issues with stremio even though it says it is optional.
        // therefore, we set it as normal, but if there comes an addon that doesn't support any id prefixes, we set it to undefined
        // this fixes issues in most cases as most addons do provide idPrefixes
        if (existing) {
          existing.types = [...new Set([...existing.types, ...resource.types])];
          if (
            existing.idPrefixes &&
            existing.idPrefixes.length > 0 &&
            resource.idPrefixes &&
            resource.idPrefixes.length > 0
          ) {
            existing.idPrefixes = [
              ...new Set([...existing.idPrefixes, ...resource.idPrefixes]),
            ];
          } else {
            if (resource.name !== 'catalog' && !resource.idPrefixes?.length) {
              logger.warn(
                `Addon ${getAddonName(addon)} does not provide idPrefixes for type ${resource.name}, setting idPrefixes to undefined`
              );
            }
            // if an addon for this type does not provide idPrefixes, we set it to undefined
            // to ensure it works with at least some platforms on stremio rather than none.
            existing.idPrefixes = undefined;
          }
        } else {
          if (!resource.idPrefixes?.length && resource.name !== 'catalog') {
            logger.warn(
              `Addon ${getAddonName(addon)} does not provide idPrefixes for type ${resource.name}, setting idPrefixes to undefined`
            );
          }
          this.finalResources.push({
            ...resource,
            // explicitly set to null
            idPrefixes: resource.idPrefixes?.length
              ? resource.idPrefixes
              : undefined,
            // idPrefixes: resource.idPrefixes
            //   ? [...resource.idPrefixes]
            //   : undefined,
          });
        }
      }

      logger.verbose(
        `Determined that ${getAddonName(addon)} (Instance ID: ${instanceId}) has support for the following resources: ${JSON.stringify(
          addonResources
        )}`
      );

      // Add catalogs with prefixed  IDs (ensure to check that if addon.resources is defined and does not have catalog
      // then we do not add the catalogs)

      if (
        !addon.resources?.length ||
        (addon.resources && addon.resources.includes('catalog'))
      ) {
        this.finalCatalogs.push(
          ...manifest.catalogs.map((catalog) => ({
            ...catalog,
            id: `${addon.instanceId}.${catalog.id}`,
          }))
        );
      }

      // add all addon catalogs, prefixing id with index
      if (manifest.addonCatalogs) {
        this.finalAddonCatalogs!.push(
          ...(manifest.addonCatalogs || []).map((catalog) => ({
            ...catalog,
            id: `${addon.instanceId}.${catalog.id}`,
          }))
        );
      }

      this.supportedResources[instanceId] = addonResources;
    }

    logger.verbose(
      `Parsed all catalogs and determined the following catalogs: ${JSON.stringify(
        this.finalCatalogs.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
        }))
      )}`
    );

    logger.verbose(
      `Parsed all addon catalogs and determined the following catalogs: ${JSON.stringify(
        this.finalAddonCatalogs?.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
        }))
      )}`
    );

    logger.verbose(
      `Parsed all resources and determined the following resources: ${JSON.stringify(
        this.finalResources.map((r) => ({
          name: r.name,
          types: r.types,
          idPrefixes: r.idPrefixes,
        }))
      )}`
    );

    // if meta resouce exists, and aiostreamserror to idPrefixes only if idPrefixes is defined
    const metaResource = this.finalResources.find((r) => r.name === 'meta');
    if (metaResource) {
      if (metaResource.idPrefixes) {
        metaResource.idPrefixes = [
          ...metaResource.idPrefixes,
          'aiostreamserror',
        ];
      }
    }

    // Build set of source catalog IDs that are part of enabled merged catalogs
    // This is done BEFORE overrideType is applied so we use the original catalog types
    const catalogsInMergedCatalogs = new Set<string>();
    if (this.userData.mergedCatalogs?.length) {
      const enabledMergedCatalogs = this.userData.mergedCatalogs.filter(
        (mc) => mc.enabled !== false
      );
      for (const mc of enabledMergedCatalogs) {
        for (const encodedCatalogId of mc.catalogIds) {
          const params = new URLSearchParams(encodedCatalogId);
          const catalogId = params.get('id');
          const catalogType = params.get('type');
          if (catalogId && catalogType) {
            catalogsInMergedCatalogs.add(`${catalogId}-${catalogType}`);
          }
        }
      }
    }

    // Add enabled merged catalogs to finalCatalogs BEFORE sorting
    // so they participate in the natural catalogModifications-based sort
    if (this.userData.mergedCatalogs?.length) {
      const enabledMergedCatalogs = this.userData.mergedCatalogs.filter(
        (mc) => mc.enabled !== false
      );
      for (const mc of enabledMergedCatalogs) {
        const mergedExtras = this.buildMergedCatalogExtras(mc.catalogIds);
        this.finalCatalogs.push({
          id: mc.id,
          name: mc.name,
          type: mc.type,
          extra: mergedExtras.length > 0 ? mergedExtras : undefined,
        });
      }
    }

    if (this.userData.catalogModifications) {
      this.finalCatalogs = this.finalCatalogs
        // Sort catalogs based on catalogModifications order, with non-modified catalogs at the end
        .sort((a, b) => {
          const aModIndex = this.userData.catalogModifications!.findIndex(
            (mod) => mod.id === a.id && mod.type === a.type
          );
          const bModIndex = this.userData.catalogModifications!.findIndex(
            (mod) => mod.id === b.id && mod.type === b.type
          );

          // If neither catalog is in modifications, maintain original order
          if (aModIndex === -1 && bModIndex === -1) {
            return (
              this.finalCatalogs.indexOf(a) - this.finalCatalogs.indexOf(b)
            );
          }

          // If only one catalog is in modifications, it should come first
          if (aModIndex === -1) return 1;
          if (bModIndex === -1) return -1;

          // If both are in modifications, sort by their order in modifications
          return aModIndex - bModIndex;
        })
        // filter out any catalogs that are disabled OR are source catalogs of enabled merged catalogs
        .filter((catalog) => {
          // Don't filter out merged catalogs themselves
          if (catalog.id.startsWith('aiostreams.merged.')) {
            const modification = this.userData.catalogModifications!.find(
              (mod) => mod.id === catalog.id && mod.type === catalog.type
            );
            return modification?.enabled !== false;
          }

          // Check if this catalog is a source of an enabled merged catalog
          const key = `${catalog.id}-${catalog.type}`;
          if (catalogsInMergedCatalogs.has(key)) {
            logger.debug(
              `Filtering out catalog ${catalog.id} of type ${catalog.type} as it is part of an enabled merged catalog`
            );
            return false;
          }

          const modification = this.userData.catalogModifications!.find(
            (mod) => mod.id === catalog.id && mod.type === catalog.type
          );
          return modification?.enabled !== false; // only if explicitly disabled i.e. enabled is true or undefined
        })
        // rename any catalogs if necessary and apply the onlyOnDiscover modification
        .map((catalog) => {
          const modification = this.userData.catalogModifications!.find(
            (mod) => mod.id === catalog.id && mod.type === catalog.type
          );
          if (modification?.name) {
            catalog.name = modification.name;
          }

          // checking that no extras are required already
          // if its a non genre extra, then its just not possible as it would lead to having 2 required extras.
          // if it is the genre extra that is required, then there isnt a need to apply the modification as its already only on discover
          // if there are no extras, we can also apply the modification
          const canApplyOnlyOnDiscover = catalog.extra
            ? catalog.extra.every((e) => !e.isRequired)
            : true;
          // checking that a search extra exists and is not required already
          const canApplyOnlyOnSearch = catalog.extra?.some(
            (e) => e.name === 'search' && !e.isRequired
          );
          // we can only disable search if the search extra is not required. if it is required, disabling can lead to unexpected behavior
          const canDisableSearch = catalog.extra?.some(
            (e) => e.name === 'search' && !e.isRequired
          );

          if (modification?.onlyOnDiscover && canApplyOnlyOnDiscover) {
            // A few cases
            // the catalog already has genres. In which case we set isRequired for the genre extra to true
            // and also add a new genre with name 'None' to the top - if isRequried was previously false.

            // the catalog does not have genres. In which case we add a new genre extra with only one option 'None'
            // and set isRequired to true

            const genreExtra = catalog.extra?.find((e) => e.name === 'genre');
            if (genreExtra) {
              if (!genreExtra.isRequired) {
                // if catalog supports a no genre option, we add none to the top so it is still accessible
                genreExtra.options?.unshift('None');
              }
              // set it to required to hide it from the home page
              genreExtra.isRequired = true;
            } else {
              // add a new genre extra with only one option 'None'
              if (!catalog.extra) {
                catalog.extra = [];
              }
              catalog.extra.push({
                name: 'genre',
                options: ['None'],
                isRequired: true,
              });
            }
          } else if (modification?.onlyOnSearch && canApplyOnlyOnSearch) {
            const searchExtra = catalog.extra?.find((e) => e.name === 'search');
            if (searchExtra) {
              searchExtra.isRequired = true;
            }
          }
          if (modification?.overrideType !== undefined) {
            catalog.type = modification.overrideType;
          }
          if (modification?.disableSearch && canDisableSearch) {
            catalog.extra = catalog.extra?.filter((e) => e.name !== 'search');
          }
          return catalog;
        });
    }
  }

  /**
   * Builds the extras array for a merged catalog by analyzing the source catalogs' manifest definitions.
   * - Only adds an extra (like skip, search, genre) if at least one source catalog supports it
   * - Merges options arrays (e.g., genre options) from all sources
   * - Sets isRequired to true only if ALL sources have isRequired=true for that extra
   */
  private buildMergedCatalogExtras(catalogIds: string[]): Array<{
    name: string;
    isRequired?: boolean;
    options?: (string | null)[] | null;
    optionsLimit?: number;
  }> {
    // Track extras by name: { appearances: number, allRequired: boolean, options: Set, optionsLimit: max }
    const extrasMap = new Map<
      string,
      {
        appearances: number;
        allRequired: boolean;
        options: Set<string | null>;
        optionsLimit?: number;
      }
    >();

    let sourceCatalogCount = 0;

    for (const encodedCatalogId of catalogIds) {
      const params = new URLSearchParams(encodedCatalogId);
      const catalogId = params.get('id');
      const catalogType = params.get('type');
      if (!catalogId || !catalogType) continue;

      // Parse the catalog ID to get addon instance ID and actual catalog ID
      const addonInstanceId = catalogId.split('.', 2)[0];
      const actualCatalogId = catalogId.split('.').slice(1).join('.');

      // Get the manifest for this addon
      const manifest = this.manifests[addonInstanceId];
      if (!manifest) continue;

      // Find the catalog definition in the manifest
      const catalogDef = manifest.catalogs.find(
        (c) => c.id === actualCatalogId && c.type === catalogType
      );
      if (!catalogDef) continue;

      sourceCatalogCount++;

      // Process each extra from this catalog
      if (catalogDef.extra) {
        for (const extra of catalogDef.extra) {
          const existing = extrasMap.get(extra.name);
          if (existing) {
            existing.appearances++;
            // allRequired stays true only if this one is also required
            existing.allRequired =
              existing.allRequired && extra.isRequired === true;
            // Merge options
            if (extra.options) {
              for (const opt of extra.options) {
                existing.options.add(opt);
              }
            }
            // Take the maximum optionsLimit
            if (extra.optionsLimit !== undefined) {
              existing.optionsLimit = Math.max(
                existing.optionsLimit ?? 0,
                extra.optionsLimit
              );
            }
          } else {
            extrasMap.set(extra.name, {
              appearances: 1,
              allRequired: extra.isRequired === true,
              options: new Set(extra.options ?? []),
              optionsLimit: extra.optionsLimit,
            });
          }
        }
      }
    }

    // Build the final extras array
    const mergedExtras: Array<{
      name: string;
      isRequired?: boolean;
      options?: (string | null)[] | null;
      optionsLimit?: number;
    }> = [];

    for (const [name, data] of extrasMap) {
      const extra: {
        name: string;
        isRequired?: boolean;
        options?: (string | null)[] | null;
        optionsLimit?: number;
      } = { name };

      // isRequired is true only if ALL source catalogs that have this extra have it as required
      // If not all catalogs have this extra, it's effectively not required since some don't need it
      if (data.appearances === sourceCatalogCount && data.allRequired) {
        extra.isRequired = true;
      }

      // Include options if any were collected
      if (data.options.size > 0) {
        extra.options = Array.from(data.options);
      }

      // Include optionsLimit if set
      if (data.optionsLimit !== undefined) {
        extra.optionsLimit = data.optionsLimit;
      }

      mergedExtras.push(extra);
    }

    return mergedExtras;
  }

  public getResources(): StrictManifestResource[] {
    this.checkInitialised();
    return this.finalResources;
  }

  public getCatalogs(): Manifest['catalogs'] {
    this.checkInitialised();
    return this.finalCatalogs;
  }

  public getAddonCatalogs(): Manifest['addonCatalogs'] {
    this.checkInitialised();
    return this.finalAddonCatalogs;
  }

  public getAddon(instanceId: string): Addon | undefined {
    return this.addons.find((a) => a.instanceId === instanceId);
  }

  public async shouldStopAutoPlay(type: string, id: string): Promise<boolean> {
    if (
      !this.userData.areYouStillThere?.enabled ||
      !this.userData.uuid ||
      type !== 'series'
    ) {
      return false;
    }
    logger.info(`Determining if autoplay should be stopped`, {
      type,
      id,
      uuid: this.userData.uuid,
    });
    // Decide whether to disable autoplay (suppress bingeGroup) per user+show
    let disableAutoplay = false;

    const cfg = this.userData.areYouStillThere;
    const threshold = cfg.episodesBeforeCheck ?? 3;
    const cooldownMs = (cfg.cooldownMinutes ?? 60) * 60 * 1000;
    const cache = Cache.getInstance<string, { count: number; lastAt: number }>(
      'ays',
      10000,
      Env.REDIS_URI ? undefined : 'sql'
    );
    const parsed = IdParser.parse(id, type);
    const baseSeriesKey = parsed
      ? `${parsed.type}:${parsed.value}`
      : id.split(':')[0] || id;
    const key = `${this.userData.uuid}:${baseSeriesKey}`;
    logger.debug(`Formed AYS cache key: ${key}`);
    const now = Date.now();
    const prev = (await cache.get(key)) || { count: 0, lastAt: 0 };
    const withinWindow = now - prev.lastAt <= cooldownMs;
    const nextCount = withinWindow ? prev.count + 1 : 1;
    if (nextCount >= threshold) {
      // Trigger: disable autoplay for this response and reset counter
      disableAutoplay = true;
      await cache.set(
        key,
        { count: 0, lastAt: now },
        Math.ceil(cooldownMs / 1000)
      );
    } else {
      await cache.set(
        key,
        { count: nextCount, lastAt: now },
        Math.ceil(cooldownMs / 1000)
      );
    }
    logger.info(`Autoplay disable check result`, {
      disableAutoplay,
      count: nextCount,
      withinWindow,
    });
    return disableAutoplay;
  }

  private async getProxyIp() {
    let userIp = this.userData.ip;
    const PRIVATE_IP_REGEX =
      /^(::1|::ffff:(10|127|192|172)\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})|10\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})|127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})|192\.168\.(\d{1,3})\.(\d{1,3})|172\.(1[6-9]|2[0-9]|3[0-1])\.(\d{1,3})\.(\d{1,3}))$/;

    if (userIp && PRIVATE_IP_REGEX.test(userIp)) {
      userIp = undefined;
    }
    if (!this.userData.proxy) {
      return userIp;
    }

    const proxy = createProxy(this.userData.proxy);
    if (proxy.getConfig().enabled) {
      userIp = await this.retryGetIp(
        () => proxy.getPublicIp(),
        'Proxy public IP'
      );
    }
    return userIp;
  }

  private async retryGetIp<T>(
    getter: () => Promise<T | null>,
    label: string,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: string | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await getter();
        if (result) {
          return result;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        logger.warn(
          `Failed to get ${label}, retrying... (${attempt}/${maxRetries})`,
          {
            error: lastError,
          }
        );
      }
    }
    throw new Error(
      `Failed to get ${label} after ${maxRetries} attempts: ${lastError}`
    );
  }
  // stream utility functions
  private async assignPublicIps() {
    let userIp = this.userData.ip;
    let proxyIp = undefined;
    if (this.userData.proxy?.enabled) {
      proxyIp = await this.getProxyIp();
    }
    for (const addon of this.addons) {
      const proxy =
        this.userData.proxy?.enabled &&
        (!this.userData.proxy?.proxiedAddons?.length ||
          this.userData.proxy.proxiedAddons.includes(addon.preset.id));
      logger.debug(
        `Using ${proxy ? 'proxy' : 'user'} ip for ${getAddonName(addon)}: ${
          proxy
            ? maskSensitiveInfo(proxyIp ?? 'none')
            : maskSensitiveInfo(userIp ?? 'none')
        }`
      );
      if (proxy) {
        addon.ip = proxyIp;
      } else {
        addon.ip = userIp;
      }
    }
  }

  private validateAddon(addon: Addon) {
    const manifestUrl = new URL(addon.manifestUrl);
    const baseUrl = Env.BASE_URL ? new URL(Env.BASE_URL) : undefined;
    if (this.userData.uuid && addon.manifestUrl.includes(this.userData.uuid)) {
      logger.warn(
        `${this.userData.uuid} detected to be trying to cause infinite self scraping`
      );
      throw new Error(
        `${getAddonName(addon)} would cause infinite self scraping, ensure you wrap a different AIOStreams user.`
      );
    } else if (
      ((baseUrl && manifestUrl.host === baseUrl.host) ||
        (manifestUrl.host.startsWith('localhost') &&
          manifestUrl.port === Env.PORT.toString())) &&
      !manifestUrl.pathname.startsWith('/builtins') &&
      Env.DISABLE_SELF_SCRAPING === true
    ) {
      throw new Error(
        `Scraping the same AIOStreams instance is disabled. Please use a different AIOStreams instance, or enable it through the environment variables.`
      );
    }
    if (
      addon.preset.type &&
      FeatureControl.disabledAddons.has(addon.preset.type)
    ) {
      throw new Error(
        `Addon ${getAddonName(addon)} is disabled: ${FeatureControl.disabledAddons.get(
          addon.preset.type
        )}`
      );
    } else if (
      FeatureControl.disabledHosts.has(manifestUrl.host.split(':')[0])
    ) {
      throw new Error(
        `Addon ${getAddonName(addon)} is disabled: ${FeatureControl.disabledHosts.get(
          manifestUrl.host.split(':')[0]
        )}`
      );
    }
  }

  private applyModifications(streams: ParsedStream[]): ParsedStream[] {
    if (this.userData.randomiseResults) {
      streams.sort(() => Math.random() - 0.5);
    }
    if (this.userData.enhanceResults) {
      streams.forEach((stream) => {
        if (Math.random() < 0.4) {
          stream.filename = undefined;
          stream.parsedFile = undefined;
          stream.type = 'youtube';
          stream.ytId = Buffer.from(constants.DEFAULT_YT_ID, 'base64').toString(
            'utf-8'
          );
          stream.message =
            'This stream has been artificially enhanced using the best AI on the market.';
        }
      });
    }
    return streams;
  }

  private convertDiscoverDeepLinks(items: Meta['links']) {
    if (!items) {
      return items;
    }
    return items.map((link) => {
      try {
        if (link.url.startsWith('stremio:///discover/')) {
          const linkUrl = new URL(decodeURIComponent(link.url.split('/')[4]));
          // see if the linked addon is one of our addons and replace the transport url with our manifest url if so
          const addon = this.addons.find(
            (a) => new URL(a.manifestUrl).hostname === linkUrl.hostname
          );
          if (addon) {
            const [_, linkType, catalogIdAndQuery] = link.url
              .replace('stremio:///discover/', '')
              .split('/');
            const newCatalogId = `${addon.instanceId}.${catalogIdAndQuery}`;
            const newTransportUrl = encodeURIComponent(this.manifestUrl);
            link.url = `stremio:///discover/${newTransportUrl}/${linkType}/${newCatalogId}`;
          }
        }
      } catch {}
      return link;
    });
  }

  private async getMetadata(parsedId: ParsedId): Promise<Metadata | undefined> {
    try {
      const metadata = await new TMDBMetadata({
        accessToken: this.userData.tmdbAccessToken,
        apiKey: this.userData.tmdbApiKey,
      }).getMetadata(parsedId);
      return metadata;
    } catch (error) {
      logger.warn(
        `Error getting metadata for ${parsedId.fullId}, will not be able to precache next season if necessary`,
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return undefined;
    }
  }

  private _getNextEpisode(
    currentSeason: number | undefined,
    currentEpisode: number,
    metadata?: Metadata
  ): {
    season: number | undefined;
    episode: number;
  } {
    let season = currentSeason;
    let episode = currentEpisode + 1;
    if (!currentSeason) return { season, episode };
    const episodeCount = metadata?.seasons?.find(
      (s) => s.season_number === season
    )?.episode_count;

    // If we are at the last episode of the season, try to move to the next season
    if (episodeCount && currentEpisode === episodeCount) {
      const nextSeasonNumber = currentSeason + 1;
      if (
        metadata?.seasons?.find((s) => s.season_number === nextSeasonNumber)
      ) {
        logger.debug(
          `Current episode is the last of season ${currentSeason}, moving to S${nextSeasonNumber}E01.`
        );
        season = nextSeasonNumber;
        episode = 1;
      }
    }
    return { season, episode };
  }

  private async _processStreams(
    streams: ParsedStream[],
    type: string,
    id: string,
    isMeta: boolean = false
  ): Promise<{ streams: ParsedStream[]; errors: AIOStreamsError[] }> {
    let processedStreams = streams;
    let errors: AIOStreamsError[] = [];

    if (isMeta) {
      // Run SeaDex precompute before filter so seadex() works in Included SEL
      await this.precomputer.precomputeSeaDexOnly(processedStreams, id);
      processedStreams = await this.filterer.filter(processedStreams, type, id);
    }

    processedStreams = await this.deduplicator.deduplicate(processedStreams);

    if (isMeta) {
      // Run preferred matching after filter
      await this.precomputer.precomputePreferred(processedStreams, type, id);
    }

    let finalStreams = await this.filterer.applyStreamExpressionFilters(
      await this.limiter.limit(
        await this.sorter.sort(
          processedStreams,
          AnimeDatabase.getInstance().isAnime(id) ? 'anime' : type
        )
      ),
      type,
      id
    );

    const { streams: proxiedStreams, error } =
      await this.proxifier.proxify(finalStreams);

    if (error) {
      errors.push({
        title: `Proxifier Error`,
        description: error,
      });
    }
    finalStreams = this.applyModifications(proxiedStreams).map((stream) => {
      if (stream.parsedFile) {
        stream.parsedFile.visualTags = stream.parsedFile.visualTags.filter(
          (tag) => !constants.FAKE_VISUAL_TAGS.includes(tag as any)
        );
      }
      return stream;
    });

    if (this.userData.externalDownloads) {
      const streamsWithExternalDownloads: ParsedStream[] = [];
      for (const stream of finalStreams) {
        streamsWithExternalDownloads.push(stream);
        if (stream.url) {
          const downloadableStream: ParsedStream =
            StreamUtils.createDownloadableStream(stream);
          streamsWithExternalDownloads.push(downloadableStream);
        }
      }
      logger.info(
        `Added ${streamsWithExternalDownloads.length - finalStreams.length} external downloads to streams`
      );
      finalStreams = streamsWithExternalDownloads;
    }

    return { streams: finalStreams, errors };
  }

  private async _fetchAndHandleRedirects(stream: ParsedStream, id: string) {
    const wrapper = new Wrapper(stream.addon);
    if (!stream.url) {
      throw new Error(`Stream URL is undefined`);
    }
    const initialResponse = await wrapper.makeRequest(stream.url, {
      timeout: 30000,
      rawOptions: { redirect: 'manual' },
    });

    // If it's a redirect, handle it
    if (initialResponse.status >= 300 && initialResponse.status < 400) {
      const redirectUrl = initialResponse.headers.get('Location');
      if (!redirectUrl) {
        throw new Error(
          `Redirect response (${initialResponse.status}) has no Location header.`
        );
      }

      const absoluteRedirectUrl = new URL(redirectUrl, stream.url).toString();
      const originalHost = new URL(stream.url).host;
      const redirectHost = new URL(absoluteRedirectUrl).host;

      if (redirectHost !== originalHost) {
        throw new Error(
          `Host mismatch during redirect: original (${originalHost}) vs redirect (${redirectHost}). Not following.`
        );
      }

      logger.debug(
        `Following same-domain redirect to ${makeUrlLogSafe(absoluteRedirectUrl)} for precaching ${id}`
      );
      return wrapper.makeRequest(absoluteRedirectUrl, { timeout: 30000 });
    }

    return initialResponse;
  }

  private async precacheNextEpisode(type: string, id: string) {
    const parsedId = IdParser.parse(id, type);
    if (!parsedId) {
      return;
    }

    const currentSeason = parsedId.season ? Number(parsedId.season) : undefined;
    const currentEpisode = parsedId.episode
      ? Number(parsedId.episode)
      : undefined;
    if (!currentEpisode) {
      return;
    }

    const metadata = await this.getMetadata(parsedId);

    const { season: seasonToPrecache, episode: episodeToPrecache } =
      this._getNextEpisode(currentSeason, currentEpisode, metadata);

    const precacheId = parsedId.generator(
      parsedId.value,
      seasonToPrecache?.toString(),
      episodeToPrecache?.toString()
    );
    logger.info(`Pre-caching next episode`, {
      titleId: parsedId.value,
      currentSeason,
      currentEpisode,
      episodeToPrecache,
      seasonToPrecache,
      precacheId,
    });

    // modify userData to remove the excludeUncached filter
    const userData = structuredClone(this.userData);
    userData.excludeUncached = false;
    userData.groups = undefined;
    this.setUserData(userData);

    const nextStreamsResponse = await this.getStreams(precacheId, type, true);
    if (!nextStreamsResponse.success) {
      logger.error(`Failed to get streams during precaching ${id}`, {
        error: nextStreamsResponse.errors,
      });
      return;
    }

    const serviceStreams = nextStreamsResponse.data.streams.filter(
      (stream) => stream.service
    );
    const shouldPrecache =
      serviceStreams.every((stream) => stream.service?.cached === false) ||
      this.userData.alwaysPrecache;

    if (!shouldPrecache) {
      logger.debug(
        `Skipping precaching ${id} as all streams are cached or Always Precache is disabled`
      );
      return;
    }

    const firstUncachedStream = serviceStreams.find(
      (stream) => stream.service?.cached === false
    );
    if (!firstUncachedStream || !firstUncachedStream.url) {
      logger.debug(
        `Skipping precaching ${id} as no uncached streams were found or it had no URL`
      );
      return;
    }

    logger.debug(
      `Selected following stream for precaching:\n${firstUncachedStream.originalName}\n${firstUncachedStream.originalDescription}`
    );

    try {
      const response = await this._fetchAndHandleRedirects(
        firstUncachedStream,
        precacheId
      );
      logger.debug(`Response: ${response.status} ${response.statusText}`);
      if (!response.ok) {
        throw new Error(
          `Final Response not OK: ${response.status} ${response.statusText}`
        );
      }
      const cacheKey = `precache-${type}-${id}-${this.userData.uuid}`;
      await precacheCache.set(
        cacheKey,
        true,
        Env.PRECACHE_NEXT_EPISODE_MIN_INTERVAL
      );
      logger.info(`Successfully precached a stream for ${id} (${type})`);
    } catch (error) {
      logger.error(`Error pinging url of first uncached stream`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
