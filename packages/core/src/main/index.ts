import {
  Addon,
  Manifest,
  StrictManifestResource,
  UserData,
} from '../db/index.js';
import { Cache, createLogger, Env, IdParser } from '../utils/index.js';
import Proxifier from '../streams/proxifier.js';
import StreamLimiter from '../streams/limiter.js';
import {
  StreamFetcher as Fetcher,
  StreamFilterer as Filterer,
  StreamSorter as Sorter,
  StreamDeduplicator as Deduplicator,
  StreamPrecomputer as Precomputer,
  StreamContext,
} from '../streams/index.js';
import type { AIOStreamsContext, AIOStreamsOptions } from './types.js';
import {
  applyPresets,
  assignPublicIps,
  fetchManifests,
  buildResources,
} from './setup.js';
import { getCatalog as _getCatalog } from './catalog.js';
import {
  getStreams as _getStreams,
  getMeta as _getMeta,
  getSubtitles as _getSubtitles,
  getAddonCatalog as _getAddonCatalog,
} from './resources.js';

const logger = createLogger('core');

export class AIOStreams {
  private ctx: AIOStreamsContext;

  constructor(userData: UserData, options?: AIOStreamsOptions) {
    const filterer = new Filterer(userData);
    const precomputer = new Precomputer(userData);
    this.ctx = {
      userData,
      options,
      manifestUrl: `${Env.BASE_URL}/stremio/${userData.uuid}/${userData.encryptedPassword}/manifest.json`,
      manifests: {},
      supportedResources: {},
      finalResources: [],
      finalCatalogs: [],
      finalAddonCatalogs: [],
      isInitialised: false,
      addons: [],
      proxifier: new Proxifier(userData),
      limiter: new StreamLimiter(userData),
      filterer,
      precomputer,
      fetcher: new Fetcher(userData, filterer, precomputer),
      deduplicator: new Deduplicator(userData),
      sorter: new Sorter(userData),
      streamContext: null,
      addonInitialisationErrors: [],
    };
  }

  public async initialise(): Promise<AIOStreams> {
    if (this.ctx.isInitialised) return this;
    await applyPresets(this.ctx);
    await assignPublicIps(this.ctx);
    await fetchManifests(this.ctx);
    buildResources(this.ctx);
    this.ctx.isInitialised = true;
    return this;
  }

  private checkInitialised() {
    if (!this.ctx.isInitialised) {
      throw new Error(
        'AIOStreams is not initialised. Call initialise() first.'
      );
    }
  }

  public async getStreams(
    id: string,
    type: string,
    preCaching: boolean = false
  ) {
    return _getStreams(this.ctx, id, type, preCaching);
  }

  public async getCatalog(type: string, id: string, extras?: string) {
    return _getCatalog(this.ctx, type, id, extras);
  }

  public async getMeta(type: string, id: string) {
    return _getMeta(this.ctx, type, id);
  }

  public async getSubtitles(type: string, id: string, extras?: string) {
    return _getSubtitles(this.ctx, type, id, extras);
  }

  public async getAddonCatalog(type: string, id: string) {
    return _getAddonCatalog(this.ctx, type, id);
  }

  public getStreamContext(): StreamContext | null {
    return this.ctx.streamContext;
  }

  public getResources(): StrictManifestResource[] {
    this.checkInitialised();
    return this.ctx.finalResources;
  }

  public getCatalogs(): Manifest['catalogs'] {
    this.checkInitialised();
    return this.ctx.finalCatalogs;
  }

  public getAddonCatalogs(): Manifest['addonCatalogs'] {
    this.checkInitialised();
    return this.ctx.finalAddonCatalogs;
  }

  public getAddon(instanceId: string): Addon | undefined {
    return this.ctx.addons.find((a) => a.instanceId === instanceId);
  }

  public async shouldStopAutoPlay(type: string, id: string) {
    if (
      !this.ctx.userData.areYouStillThere?.enabled ||
      !this.ctx.userData.uuid ||
      type !== 'series'
    ) {
      return false;
    }
    logger.info(`Determining if autoplay should be stopped`, {
      type,
      id,
      uuid: this.ctx.userData.uuid,
    });
    let disableAutoplay = false;
    const cfg = this.ctx.userData.areYouStillThere;
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
    const key = `${this.ctx.userData.uuid}:${baseSeriesKey}`;
    logger.debug(`Formed AYS cache key: ${key}`);
    const now = Date.now();
    const prev = (await cache.get(key)) || { count: 0, lastAt: 0 };
    const withinWindow = now - prev.lastAt <= cooldownMs;
    const nextCount = withinWindow ? prev.count + 1 : 1;
    if (nextCount >= threshold) {
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
}
