import {
  Addon,
  Manifest,
  Resource,
  StrictManifestResource,
  UserData,
} from './db';
import {
  constants,
  createLogger,
  Env,
  getSimpleTextHash,
  getTimeTakenSincePoint,
  maskSensitiveInfo,
  Cache,
  CatalogExtras,
} from './utils';
import { Wrapper } from './wrapper';
import { fetchTmdbTrailer } from './utils/tmdbTrailers';
import { searchYoutubeTrailer } from './utils/youtubeSearchTrailer';
import { PresetManager } from './presets';
import {
  AddonCatalog,
  Extras,
  ExtrasSchema,
  ExtrasTypesSchema,
  Meta,
  MetaPreview,
  ParsedStream,
  Subtitle,
} from './db/schemas';
import { createProxy } from './proxy';
import { RPDB } from './utils/rpdb';
import { FeatureControl } from './utils/feature';
import Proxifier from './streams/proxifier';
import StreamLimiter from './streams/limiter';
import {
  StreamFetcher as Fetcher,
  StreamFilterer as Filterer,
  StreamSorter as Sorter,
  StreamDeduplicator as Deduplicator,
  StreamPrecomputer as Precomputer,
  StreamUtils,
} from './streams';
import { getAddonName } from './utils/general';
const logger = createLogger('core');

const shuffleCache = Cache.getInstance<string, MetaPreview[]>('shuffle');
const precacheCache = Cache.getInstance<string, ParsedStream[]>('precache');

export interface AIOStreamsError {
  title?: string;
  description?: string;
}

export interface AIOStreamsResponse<T> {
  success: boolean;
  data: T;
  errors: AIOStreamsError[];
}

export class AIOStreams {
  private userData: UserData;
  private manifests: Record<string, Manifest | null>;
  private supportedResources: Record<string, StrictManifestResource[]>;
  private finalResources: StrictManifestResource[] = [];
  private finalCatalogs: Manifest['catalogs'] = [];
  private finalAddonCatalogs: Manifest['addonCatalogs'] = [];
  private isInitialised: boolean = false;
  private addons: Addon[] = [];
  private skipFailedAddons: boolean = true;
  private proxifier: Proxifier;
  private limiter: StreamLimiter;
  private fetcher: Fetcher;
  private filterer: Filterer;
  private deduplicator: Deduplicator;
  private sorter: Sorter;
  private precomputer: Precomputer;

  private addonInitialisationErrors: {
    addon: Addon;
    error: string;
  }[] = [];

  constructor(userData: UserData, skipFailedAddons: boolean = true) {
    this.addonInitialisationErrors = [];
    this.userData = userData;
    this.manifests = {};
    this.supportedResources = {};
    this.skipFailedAddons = skipFailedAddons;
    this.proxifier = new Proxifier(userData);
    this.limiter = new StreamLimiter(userData);
    this.fetcher = new Fetcher(userData);
    this.filterer = new Filterer(userData);
    this.deduplicator = new Deduplicator(userData);
    this.sorter = new Sorter(userData);
    this.precomputer = new Precomputer(userData);
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
            ? r.idPrefixes?.some((prefix: string) => id.startsWith(prefix))
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

    // step 2
    // get all parsed stream objects and errors from all addons that have the stream resource.
    // and that support the type and match the id prefix

    const { streams, errors, statistics } = await this.fetcher.fetch(
      supportedAddons,
      type,
      id
    );

    // append initialisation errors to the errors array
    errors.push(
      ...this.addonInitialisationErrors.map((e) => ({
        title: `[❌] ${getAddonName(e.addon)}`,
        description: e.error,
      }))
    );

    // step 4
    // deduplicate streams based on the depuplicatoroptions

    const deduplicatedStreams = await this.deduplicator.deduplicate(streams);

    let sortedStreams = await this.sorter.sort(
      deduplicatedStreams,
      id.startsWith('kitsu') ? 'anime' : type
    );
    sortedStreams = sortedStreams
      // remove HDR+DV from visual tags after filtering/sorting
      .map((stream) => {
        if (stream.parsedFile?.visualTags?.includes('HDR+DV')) {
          stream.parsedFile.visualTags = stream.parsedFile.visualTags.filter(
            (tag: string) => tag !== 'HDR+DV'
          );
        }
        return stream;
      });

    // step 6
    // limit the number of streams based on the limit criteria.

    const limitedStreams = await this.limiter.limit(sortedStreams);

    // step 7
    // apply stream expressions last
    const postFilteredStreams =
      await this.filterer.applyStreamExpressionFilters(limitedStreams);
    // step 8
    // proxify streaming links if a proxy is provided

    const proxifiedStreams = await this.proxifier.proxify(postFilteredStreams);

    let finalStreams = this.applyModifications(proxifiedStreams);

    // step 8
    // if this.userData.precacheNextEpisode is true, start a new thread to request the next episode, check if
    // all provider streams are uncached, and only if so, then send a request to the first uncached stream in the list.
    if (this.userData.precacheNextEpisode && !preCaching) {
      // only precache if the same user hasn't previously cached the next episode of the current episode
      // within the last 24 hours (Env.PRECACHE_NEXT_EPISODE_MIN_INTERVAL)
      let precache = false;
      const cacheKey = `precache-${type}-${id}-${this.userData.uuid}`;
      const cachedNextEpisode = precacheCache.get(cacheKey, false);
      if (cachedNextEpisode) {
        logger.info(
          `The current request for ${type} ${id} has already had the next episode precached within the last ${Env.PRECACHE_NEXT_EPISODE_MIN_INTERVAL} seconds (${precacheCache.getTTL(cacheKey)} seconds left). Skipping precaching.`
        );
        precache = false;
      } else {
        precache = true;
      }
      if (precache) {
        // Use globalThis.setImmediate for Node.js compatibility
        (globalThis as any).setImmediate(() => {
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

    if (this.userData.externalDownloads) {
      logger.info(`Adding external downloads to streams`);
      let count = 0;
      // for each stream object, insert a new stream object, replacing the url with undefined, and appending its value to externalUrl instead
      // and place it right after the original stream object
      const streamsWithExternalDownloads: ParsedStream[] = [];
      for (const stream of proxifiedStreams) {
        streamsWithExternalDownloads.push(stream);
        if (stream.url) {
          const downloadableStream: ParsedStream =
            StreamUtils.createDownloadableStream(stream);
          streamsWithExternalDownloads.push(downloadableStream);
          count++;
        }
      }
      logger.info(`Added ${count} external downloads to streams`);
      finalStreams = streamsWithExternalDownloads;
    }
    // step 9
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

  public async getCatalog(
    type: string,
    id: string,
    extras?: string
  ): Promise<AIOStreamsResponse<MetaPreview[]>> {
    // step 1
    // get the addon index from the id
    logger.info(`Handling catalog request`, { type, id, extras });
    const start = Date.now();
    const addonInstanceId = id.split('.', 2)[0];
    const addon = this.getAddon(addonInstanceId);
    if (!addon) {
      logger.error(`Addon ${addonInstanceId} not found`);
      return {
        success: false,
        data: [],
        errors: [
          {
            title: `Addon ${addonInstanceId} not found. Try reinstalling the addon.`,
            description: 'Addon not found',
          },
        ],
      };
    }

    // step 2
    // get the actual catalog id from the id
    const actualCatalogId = id.split('.').slice(1).join('.');
    let modification;
    if (this.userData.catalogModifications) {
      modification = this.userData.catalogModifications.find(
        (mod: any) =>
          mod.id === id && (mod.type === type || mod.overrideType === type)
      );
    }
    if (modification?.overrideType) {
      // reset the type from the request (which is the overriden type) to the actual type
      type = modification.type;
    }
    const parsedExtras = new CatalogExtras(extras);
    logger.debug(`Parsed extras: ${JSON.stringify(parsedExtras)}`);
    if (parsedExtras.genre === 'None') {
      logger.debug(`Genre extra is None, removing genre extra`);
      parsedExtras.genre = undefined;
    }
    const extrasString = parsedExtras.toString();

    // step 3
    // get the catalog from the addon
    let catalog;
    try {
      catalog = await new Wrapper(addon).getCatalog(
        type,
        actualCatalogId,
        extrasString
      );
    } catch (error) {
      return {
        success: false,
        data: [],
        errors: [
          {
            title: `[❌] ${addon.name}`,
            description: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }

    // Inject logo property for each catalog item
    const { fetchLogoForItem } = await import('./utils/fetchLogo');
    catalog = await Promise.all(
      catalog.map(async (item) => {
        // Always fetch and inject logo for collections, or if logo is missing/empty
        const typeForLogo = item.type === 'collection' ? 'collection' : item.type;
        if (
          typeForLogo === 'collection' ||
          !item.logo || item.logo === '' || item.logo === null
        ) {
          const logo = await fetchLogoForItem(item.id, typeForLogo);
          return { ...item, logo };
        }
        return item;
      })
    );

    logger.info(
      `Received catalog ${actualCatalogId} of type ${type} from ${addon.name} in ${getTimeTakenSincePoint(start)}`
    );

    // apply catalog modifications

    if (modification) {
      if (modification.shuffle && !(extras && extras.includes('search'))) {
        // shuffle the catalog array if it is not a search
        const cacheKey = `shuffle-${type}-${actualCatalogId}-${extras}-${this.userData.uuid}`;
        const cachedShuffle = shuffleCache.get(cacheKey, false);
        if (cachedShuffle) {
          catalog = cachedShuffle;
        } else {
          for (let i = catalog.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [catalog[i], catalog[j]] = [catalog[j], catalog[i]];
          }
          if (modification.persistShuffleFor) {
            shuffleCache.set(
              cacheKey,
              catalog,
              modification.persistShuffleFor * 3600
            );
          }
        }
      }
      if (modification.rpdb && this.userData.rpdbApiKey) {
        const rpdb = new RPDB(this.userData.rpdbApiKey);
        catalog = catalog.map((item: any) => {
          const posterUrl = rpdb.getPosterUrl(
            type,
            (item as any).imdb_id || item.id
          );
          if (posterUrl) {
            item.poster = posterUrl;
          }
          return item;
        });
      }
    }

    if (this.userData.enhancePosters) {
      catalog = catalog.map((item: any) => {
        if (Math.random() < 0.2) {
          item.poster = (globalThis as any).Buffer.from(
            constants.DEFAULT_POSTERS[
              Math.floor(Math.random() * constants.DEFAULT_POSTERS.length)
            ],
            'base64'
          ).toString('utf-8');
        }
        return item;
      });
    }

    // step 4
    return {
      success: true,
      data: catalog,
      errors: [],
    };
  }

  public async getMeta(
    type: string,
    id: string
  ): Promise<AIOStreamsResponse<Meta | null>> {
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
          r.idPrefixes?.some((prefix: string) => id.startsWith(prefix))
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

        // Robust trailer injection for TMDB
        // Only for TMDB-based addons (by name or manifestUrl)
        const isTmdb = candidate.addon.name?.toLowerCase().includes('tmdb') || candidate.addon.manifestUrl?.toLowerCase().includes('tmdb');
        if (isTmdb && (type === 'movie' || type === 'series' || type === 'tv')) {
          // Only add if not already present
          if (!meta.trailers || !Array.isArray(meta.trailers) || meta.trailers.length === 0) {
            // Try to extract TMDB id
            let tmdbId: string | undefined;
            if (id.startsWith('tmdb:') || id.startsWith('tmdb-')) {
              tmdbId = id.replace(/^tmdb[:\-]/, '');
            } else {
              tmdbId = id;
            }
            // For series, use 'tv' endpoint
            const tmdbType = type === 'movie' ? 'movie' : 'tv';
            let trailerUrl: string | null = null;
            if (tmdbId) {
              trailerUrl = await fetchTmdbTrailer(tmdbId, tmdbType as 'movie' | 'tv');
            }
            // Fallback: YouTube search by title/year
            if (!trailerUrl && meta.name) {
              // Try to get year if available
              let year: string | undefined = undefined;
              if (meta.releaseInfo && typeof meta.releaseInfo === 'string') {
                const match = meta.releaseInfo.match(/\d{4}/);
                if (match) year = match[0];
              }
              trailerUrl = await searchYoutubeTrailer(meta.name, year);
            }
            if (trailerUrl) {
              meta.trailers = [
                {
                  source: trailerUrl,
                  type: 'Trailer',
                },
              ];
            }
          }
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
    logger.info(`getSubtitles: ${id}`);

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
            ? r.idPrefixes.some((prefix: string) => id.startsWith(prefix))
            : true)
      );
      if (resource) {
        const addon = this.getAddon(instanceId);
        if (addon) {
          supportedAddons.push(addon);
        }
      }
    }

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
            extras
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

    for (const preset of this.userData.presets.filter((p: any) => p.enabled)) {
      const addons = await PresetManager.fromId(preset.type).generateAddons(
        this.userData,
        preset.options
      );
      this.addons.push(
        ...addons.map((a) => ({
          ...a,
          presetInstanceId: preset.instanceId,
          // if no identifier is present, we can assume that the preset can only generate one addon at a time and so no
          // unique identifier is needed as the preset instance id is enough to identify the addon
          instanceId: `${preset.instanceId}${getSimpleTextHash(`${a.identifier ?? ''}`).slice(0, 4)}`,
        }))
      );
    }

    if (this.addons.length > Env.MAX_ADDONS) {
      throw new Error(
        `Your current configuration requires ${this.addons.length} addons, but the maximum allowed is ${Env.MAX_ADDONS}. Please reduce the number of addons, or increase it in the environment variables.`
      );
    }
  }

  private async fetchManifests() {
    this.manifests = Object.fromEntries(
      await Promise.all(
        this.addons.map(async (addon) => {
          try {
            this.validateAddon(addon);
            return [addon.instanceId, await new Wrapper(addon).getManifest()];
          } catch (error: any) {
            if (this.skipFailedAddons) {
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
      const addonResources = manifest.resources.map((resource: any) => {
        if (typeof resource === 'string') {
          return {
            name: resource as Resource,
            types: manifest.types,
            idPrefixes: manifest.idPrefixes,
          };
        }
        return resource;
      });

      const addon = this.getAddon(instanceId);

      if (!addon) {
        logger.error(`Addon with instanceId ${instanceId} not found`);
        continue;
      }

      logger.verbose(
        `Determined that ${getAddonName(addon)} (Instance ID: ${instanceId}) has support for the following resources: ${JSON.stringify(
          addonResources
        )}`
      );

      // Filter and merge resources
      for (const resource of addonResources) {
        if (
          addon.resources &&
          addon.resources.length > 0 &&
          !addon.resources.includes(resource.name)
        ) {
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
            if (resource.name !== 'catalog') {
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

      // Add catalogs with prefixed  IDs (ensure to check that if addon.resources is defined and does not have catalog
      // then we do not add the catalogs)

      if (
        !addon.resources?.length ||
        (addon.resources && addon.resources.includes('catalog'))
      ) {
        this.finalCatalogs.push(
          ...manifest.catalogs.map((catalog: any) => ({
            ...catalog,
            id: `${addon.instanceId}.${catalog.id}`,
          }))
        );
      }

      // add all addon catalogs, prefixing id with index
      if (manifest.addonCatalogs) {
        this.finalAddonCatalogs!.push(
          ...(manifest.addonCatalogs || []).map((catalog: any) => ({
            ...catalog,
            id: `${addon.instanceId}.${catalog.id}`,
          }))
        );
      }

      this.supportedResources[instanceId] = addonResources;
    }

    logger.verbose(
      `Parsed all catalogs and determined the following catalogs: ${JSON.stringify(
        this.finalCatalogs.map((c: any) => ({
          id: c.id,
          name: c.name,
          type: c.type,
        }))
      )}`
    );

    logger.verbose(
      `Parsed all addon catalogs and determined the following catalogs: ${JSON.stringify(
        this.finalAddonCatalogs?.map((c: any) => ({
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

    if (this.userData.catalogModifications) {
      this.finalCatalogs = this.finalCatalogs
        // Sort catalogs based on catalogModifications order, with non-modified catalogs at the end
        .sort((a: any, b: any) => {
          const aModIndex = this.userData.catalogModifications!.findIndex(
            (mod: any) => mod.id === a.id && mod.type === a.type
          );
          const bModIndex = this.userData.catalogModifications!.findIndex(
            (mod: any) => mod.id === b.id && mod.type === b.type
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
        // filter out any catalogs that are disabled
        .filter((catalog: any) => {
          const modification = this.userData.catalogModifications!.find(
            (mod: any) => mod.id === catalog.id && mod.type === catalog.type
          );
          return modification?.enabled !== false; // only if explicity disabled i.e. enabled is true or undefined
        })
        // rename any catalogs if necessary and apply the onlyOnDiscover modification
        .map((catalog: any) => {
          const modification = this.userData.catalogModifications!.find(
            (mod: any) => mod.id === catalog.id && mod.type === catalog.type
          );
          if (modification?.name) {
            catalog.name = modification.name;
          }
          if (modification?.onlyOnDiscover) {
            // A few cases
            // the catalog already has genres. In which case we set isRequired for the genre extra to true
            // and also add a new genre with name 'None' to the top - if isRequried was previously false.

            // the catalog does not have genres. In which case we add a new genre extra with only one option 'None'
            // and set isRequired to true

            const genreExtra = catalog.extra?.find((e: any) => e.name === 'genre');
            if (genreExtra) {
              if (!genreExtra.isRequired) {
                // if catalog supports a no genre option, we add none to the top so it is still accessible
                genreExtra.options?.unshift('None');
              }
              // set it to required to hide it from the home page
              genreExtra.isRequired = true;
            } else {
              // add a new genre extra with only one option 'None'
              catalog.extra?.push({
                name: 'genre',
                options: ['None'],
                isRequired: true,
              });
            }
          }
          if (modification?.overrideType !== undefined) {
            catalog.type = modification.overrideType;
          }
          if (modification?.disableSearch) {
            catalog.extra = catalog.extra?.filter((e: any) => e.name !== 'search');
          }
          return catalog;
        });
    }
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
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await getter();
        if (result) {
          return result;
        }
      } catch (error) {
        logger.warn(
          `Failed to get ${label}, retrying... (${attempt}/${maxRetries})`
        );
      }
    }
    throw new Error(`Failed to get ${label} after ${maxRetries} attempts`);
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
          this.userData.proxy.proxiedAddons.includes(addon.presetInstanceId));
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
        `${getAddonName(addon)} appears to be trying to scrape the current user's AIOStreams instance.`
      );
    } else if (
      ((baseUrl && manifestUrl.host === baseUrl.host) ||
        (manifestUrl.host.startsWith('localhost') &&
          manifestUrl.port === Env.PORT.toString())) &&
      Env.DISABLE_SELF_SCRAPING === true
    ) {
      throw new Error(
        `Scraping the same AIOStreams instance is disabled. Please use a different AIOStreams instance, or enable it through the environment variables.`
      );
    }
    if (
      addon.presetInstanceId &&
      FeatureControl.disabledAddons.has(addon.presetInstanceId)
    ) {
      throw new Error(
        `Addon ${getAddonName(addon)} is disabled: ${FeatureControl.disabledAddons.get(
          addon.presetType
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
          stream.ytId = (globalThis as any).Buffer.from(constants.DEFAULT_YT_ID, 'base64').toString(
            'utf-8'
          );
          stream.message =
            'This stream has been artificially enhanced using the best AI on the market.';
        }
      });
    }
    return streams;
  }

  private async precacheNextEpisode(type: string, id: string) {
    const seasonEpisodeRegex = /:(\d+):(\d+)$/;
    const match = id.match(seasonEpisodeRegex);
    if (!match) {
      return;
    }
    const season = match[1];
    const episode = match[2];
    const titleId = id.replace(seasonEpisodeRegex, '');
    const nextEpisodeId = `${titleId}:${season}:${Number(episode) + 1}`;
    logger.info(`Pre-caching next episode of ${titleId}`, {
      season,
      episode,
      nextEpisode: Number(episode) + 1,
      nextEpisodeId,
    });
    // modify userData to remove the excludeUncached filter
    const userData = structuredClone(this.userData);
    userData.excludeUncached = false;
    this.setUserData(userData);
    const nextStreamsResponse = await this.getStreams(
      nextEpisodeId,
      type,
      true
    );
    if (nextStreamsResponse.success) {
      const nextStreams = nextStreamsResponse.data.streams;
      const serviceStreams = nextStreams.filter((stream) => stream.service);
      if (
        serviceStreams.every((stream) => stream.service?.cached === false) || // only if all streams are uncached
        this.userData.alwaysPrecache // or if alwaysPrecache is true
      ) {
        const firstUncachedStream = serviceStreams.find(
          (stream) => stream.service?.cached === false
        );
        if (firstUncachedStream && firstUncachedStream.url) {
          try {
            const wrapper = new Wrapper(firstUncachedStream.addon);
            logger.debug(
              `The following stream was selected for precaching:\n${firstUncachedStream.originalName}\n${firstUncachedStream.originalDescription}`
            );
            const response = await wrapper.makeRequest(
              firstUncachedStream.url,
              30000
            );
            if (!response.ok) {
              throw new Error(`${response.status} ${response.statusText}`);
            }
            const cacheKey = `precache-${type}-${id}-${this.userData.uuid}`;
            precacheCache.set(
              cacheKey,
              nextStreams,
              Env.PRECACHE_NEXT_EPISODE_MIN_INTERVAL
            );
            logger.debug(`Response: ${response.status} ${response.statusText}`);
          } catch (error) {
            logger.error(`Error pinging url of first uncached stream`, {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }
  }
}
