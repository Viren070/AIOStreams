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
  Meta,
  MetaPreview,
  ParsedMeta,
  ParsedStream,
  Preset,
  Subtitle,
} from './db/schemas.js';
import { createProxy } from './proxy/index.js';
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
import { Metadata } from './metadata/utils.js';
const logger = createLogger('core');

const shuffleCache = Cache.getInstance<string, MetaPreview[]>('shuffle');
const precacheCache = Cache.getInstance<string, boolean>(
  'precache',
  undefined,
  true
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

    const {
      streams,
      errors,
      statistics: addonStatistics,
    } = await this.fetcher.fetch(supportedAddons, type, id);

    if (this.userData.statistics?.statsToShow?.includes('addon')) {
      statistics.push(...addonStatistics);
    }

    // append initialisation errors to the errors array
    errors.push(
      ...this.addonInitialisationErrors.map((e) => ({
        title: `[❌] ${getAddonName(e.addon)}`,
        description: e.error,
      }))
    );

    let finalStreams = await this._processStreams(streams, type, id);

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

    if (this.userData.statistics?.statsToShow?.includes('filter')) {
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
        (mod) =>
          mod.id === id && (mod.type === type || mod.overrideType === type)
      );
    }
    if (modification?.overrideType) {
      // reset the type from the request (which is the overriden type) to the actual type
      type = modification.type;
    }
    const parsedExtras = new ExtrasParser(extras);
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
      if (extras && extras.includes('skip')) {
        return {
          success: true,
          data: [],
          errors: [],
        };
      }
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

    logger.info(
      `Received catalog ${actualCatalogId} of type ${type} from ${addon.name} in ${getTimeTakenSincePoint(start)}`
    );

    // apply catalog modifications
    if (modification?.shuffle && !(extras && extras.includes('search'))) {
      // shuffle the catalog array if it is not a search
      const cacheKey = `shuffle-${type}-${actualCatalogId}-${extras}-${this.userData.uuid}`;
      const cachedShuffle = await shuffleCache.get(cacheKey);
      if (cachedShuffle) {
        catalog = cachedShuffle;
      } else {
        for (let i = catalog.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [catalog[i], catalog[j]] = [catalog[j], catalog[i]];
        }
        if (modification.persistShuffleFor) {
          await shuffleCache.set(
            cacheKey,
            catalog,
            modification.persistShuffleFor * 3600
          );
        }
      }
    } else if (
      modification?.reverse &&
      !(extras && extras.includes('search'))
    ) {
      catalog = catalog.reverse();
    }

    const rpdbApiKey =
      modification?.rpdb && this.userData.rpdbApiKey
        ? this.userData.rpdbApiKey
        : undefined;
    const rpdbApi = rpdbApiKey ? new RPDB(rpdbApiKey) : undefined;

    catalog = await Promise.all(
      catalog.map(async (item) => {
        // Apply RPDB poster modification
        if (rpdbApiKey && item.poster) {
          let posterUrl = item.poster;
          if (posterUrl.includes('api.ratingposterdb.com')) {
            // already a RPDB poster, do nothing
          } else if (
            this.userData.rpdbUseRedirectApi !== false &&
            Env.BASE_URL
          ) {
            const id = (item as any).imdb_id || item.id;
            const url = new URL(Env.BASE_URL);
            url.pathname = '/api/v1/rpdb';
            url.searchParams.set('id', id);
            url.searchParams.set('type', type);
            url.searchParams.set('fallback', item.poster);
            url.searchParams.set('apiKey', rpdbApiKey);
            posterUrl = url.toString();
          } else {
            const rpdbPosterUrl = await rpdbApi!.getPosterUrl(
              type,
              (item as any).imdb_id || item.id,
              false
            );
            if (rpdbPosterUrl) {
              posterUrl = rpdbPosterUrl;
            }
          }

          item.poster = posterUrl;
        }

        // Apply poster enhancement
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

    return { success: true, data: catalog, errors: [] };
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
        meta.links = this.convertDiscoverDeepLinks(meta.links);

        if (meta.videos) {
          meta.videos = await Promise.all(
            meta.videos.map(async (video) => {
              if (!video.streams) {
                return video;
              }
              video.streams = await this._processStreams(
                video.streams,
                type,
                id,
                true
              );
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
        const addons = await PresetManager.fromId(preset.type).generateAddons(
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
        // filter out any catalogs that are disabled
        .filter((catalog) => {
          const modification = this.userData.catalogModifications!.find(
            (mod) => mod.id === catalog.id && mod.type === catalog.type
          );
          return modification?.enabled !== false; // only if explicity disabled i.e. enabled is true or undefined
        })
        // rename any catalogs if necessary and apply the onlyOnDiscover modification
        .map((catalog) => {
          const modification = this.userData.catalogModifications!.find(
            (mod) => mod.id === catalog.id && mod.type === catalog.type
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
          }
          if (modification?.overrideType !== undefined) {
            catalog.type = modification.overrideType;
          }
          if (modification?.disableSearch) {
            catalog.extra = catalog.extra?.filter((e) => e.name !== 'search');
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
  ): Promise<ParsedStream[]> {
    let processedStreams = streams;

    if (isMeta) {
      processedStreams = await this.filterer.filter(processedStreams, type, id);
    }

    processedStreams = await this.deduplicator.deduplicate(processedStreams);

    if (isMeta) {
      await this.precomputer.precompute(processedStreams, type, id);
    }

    let finalStreams = this.applyModifications(
      await this.proxifier.proxify(
        await this.filterer.applyStreamExpressionFilters(
          await this.limiter.limit(
            await this.sorter.sort(
              processedStreams,
              AnimeDatabase.getInstance().isAnime(id) ? 'anime' : type
            )
          ),
          type,
          id
        )
      )
    ).map((stream) => {
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

    return finalStreams;
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
