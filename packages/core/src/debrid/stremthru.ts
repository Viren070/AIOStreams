import { StremThru, StremThruError } from 'stremthru';
import {
  Env,
  ServiceId,
  createLogger,
  getSimpleTextHash,
  Cache,
  DistributedLock,
  getTimeTakenSincePoint,
} from '../utils/index.js';
import { selectFileInTorrentOrNZB, Torrent } from './utils.js';
import {
  DebridServiceConfig,
  DebridDownload,
  PlaybackInfo,
  DebridError,
  TorrentDebridService,
  UsenetDebridService,
} from './base.js';
import { parseTorrentTitle, ParsedResult } from '@viren070/parse-torrent-title';
import assert from 'assert';

const logger = createLogger('debrid:stremthru');

function convertStremThruError(error: StremThruError): DebridError {
  return new DebridError(error.message, {
    statusCode: error.statusCode,
    statusText: error.statusText,
    code: error.code,
    headers: error.headers,
    body: error.body,
    cause: 'cause' in error ? error.cause : undefined,
  });
}

export interface StremThruServiceConfig {
  serviceName: ServiceId;
  clientIp?: string;
  stremthru: {
    baseUrl: string;
    store: string;
    token: string;
  };
  capabilities: {
    torrents: boolean;
    usenet: boolean;
  };
  usenetOptions?: {
    alwaysCacheAndPlay?: boolean;
    neverAutoRemove?: boolean;
    treatUnknownAsCached?: boolean;
  };
}

export class StremThruService
  implements TorrentDebridService, UsenetDebridService
{
  private readonly stremthru: StremThru;
  readonly serviceName: ServiceId;

  readonly capabilities: { torrents: boolean; usenet: boolean };
  private readonly usenetOptions: {
    alwaysCacheAndPlay: boolean;
    neverAutoRemove: boolean;
    treatUnknownAsCached: boolean;
  };

  // Shared caches across all StremThruService instances.
  // Cache keys include serviceName + token so different services never collide.
  private static playbackLinkCache = Cache.getInstance<string, string | null>(
    'st:link'
  );
  private static checkCache = Cache.getInstance<string, DebridDownload>(
    'st:check'
  );
  // Maps placeholder hashes (SHA-1 of downloadUrl) to real info hashes returned
  // by StremThru after addTorrent. Persists via Redis or SQL so that future
  // cache checks resolve correctly (e.g. showing qBittorrent torrents as cached).
  private static hashMapping = Cache.getInstance<string, string>(
    'st:hash-map',
    5000,
    Env.REDIS_URI ? undefined : 'sql'
  );
  private static libraryCache = Cache.getInstance<string, DebridDownload[]>(
    'st:library'
  );

  constructor(private readonly config: StremThruServiceConfig) {
    this.serviceName = config.serviceName;
    this.capabilities = config.capabilities;
    this.usenetOptions = {
      alwaysCacheAndPlay: config.usenetOptions?.alwaysCacheAndPlay ?? false,
      neverAutoRemove: config.usenetOptions?.neverAutoRemove ?? false,
      treatUnknownAsCached: config.usenetOptions?.treatUnknownAsCached ?? false,
    };
    const timeouts = {
      add: 30000,
      global: 10000,
    };
    this.stremthru = new StremThru({
      baseUrl: config.stremthru.baseUrl,
      userAgent: Env.DEFAULT_USER_AGENT,
      auth: {
        store: config.stremthru.store,
        token: config.stremthru.token,
      },
      clientIp: config.clientIp,
      timeout: {
        global: timeouts.global,
        addMagnet: timeouts.add,
        addNewz: timeouts.add,
      },
    });
  }

  //  Shared check cache helpers

  private async checkCacheGet(
    hash: string
  ): Promise<DebridDownload | undefined> {
    return await StremThruService.checkCache.get(
      `${this.serviceName}:${getSimpleTextHash(hash)}`
    );
  }

  private async checkCacheSet(debridDownload: DebridDownload): Promise<void> {
    try {
      await StremThruService.checkCache.set(
        `${this.serviceName}:${getSimpleTextHash(debridDownload.hash!)}`,
        debridDownload,
        Env.BUILTIN_DEBRID_INSTANT_AVAILABILITY_CACHE_TTL
      );
    } catch (err) {
      logger.error(
        `Failed to cache item ${debridDownload.hash} in the background:`,
        err
      );
    }
  }

  //  Shared library helpers (pagination, stale-while-revalidate)

  private getLibraryCacheKey(type: 'torrent' | 'usenet'): string {
    return `${type}:${this.serviceName}:${this.config.stremthru.token}`;
  }

  private getLibraryLimit(): number {
    return Math.min(Math.max(Env.BUILTIN_DEBRID_LIBRARY_PAGE_SIZE, 100), 500);
  }

  private async getLibraryWithStaleRefresh(
    type: 'torrent' | 'usenet',
    fetchFn: (cacheKey: string, limit: number) => Promise<DebridDownload[]>,
    refreshFn: (cacheKey: string, limit: number) => Promise<void>
  ): Promise<DebridDownload[]> {
    const cacheKey = this.getLibraryCacheKey(type);
    const limit = this.getLibraryLimit();

    const cached = await StremThruService.libraryCache.get(cacheKey);
    if (cached) {
      const remainingTTL = await StremThruService.libraryCache.getTTL(cacheKey);
      if (remainingTTL !== null && remainingTTL > 0) {
        const age = Env.BUILTIN_DEBRID_LIBRARY_CACHE_TTL - remainingTTL;
        if (age > Env.BUILTIN_DEBRID_LIBRARY_STALE_THRESHOLD) {
          logger.debug(
            `Library cache for ${this.serviceName} (${type}) is stale (age: ${age}s), triggering background refresh`
          );
          refreshFn(cacheKey, limit).catch((err) =>
            logger.error(
              `Background library refresh failed for ${this.serviceName} (${type})`,
              err
            )
          );
        }
        return cached;
      }
    }

    const { result } = await DistributedLock.getInstance().withLock(
      `st:library:${cacheKey}`,
      async () => {
        const cached = await StremThruService.libraryCache.get(cacheKey);
        if (cached) {
          logger.debug(`Using cached ${type} list for ${this.serviceName}`);
          return cached;
        }
        return fetchFn(cacheKey, limit);
      },
      { type: 'memory', timeout: 10000 }
    );
    return result;
  }

  // Torrent methods (TorrentDebridService)

  public async listMagnets(): Promise<DebridDownload[]> {
    return this.getLibraryWithStaleRefresh(
      'torrent',
      (cacheKey, limit) => this.fetchAndCacheMagnets(cacheKey, limit),
      (cacheKey, limit) => this.refreshMagnetsInBackground(cacheKey, limit)
    );
  }

  public async getMagnet(magnetId: string): Promise<DebridDownload> {
    try {
      const result = await this.stremthru.store.getMagnet(magnetId);
      assert.ok(
        result?.data,
        `Missing data from StremThru getMagnet: ${JSON.stringify(result)}`
      );
      return {
        id: result.data.id,
        hash: result.data.hash,
        name: result.data.name,
        status: result.data.status,
        private: result.data.private,
        addedAt: result.data.added_at,
        files: (result.data.files ?? []).map((file) => ({
          name: file.name,
          size: file.size,
          link: file.link,
          path: file.path,
          index: file.index,
        })),
        size: (result.data.files ?? []).reduce(
          (acc, file) => acc + file.size,
          0
        ),
      };
    } catch (error) {
      if (error instanceof StremThruError) {
        throw convertStremThruError(error);
      }
      throw error;
    }
  }

  public async removeMagnet(magnetId: string): Promise<void> {
    try {
      await this.stremthru.store.removeMagnet(magnetId);
      logger.debug(`Removed magnet ${magnetId} from ${this.serviceName}`);
    } catch (error) {
      if (error instanceof StremThruError) {
        throw convertStremThruError(error);
      }
      throw error;
    }
  }

  public async checkMagnets(
    magnets: string[],
    sid?: string,
    checkOwned: boolean = true
  ): Promise<DebridDownload[]> {
    let libraryHashes: Set<string> | undefined;
    if (checkOwned) {
      try {
        const libraryItems = await this.listMagnets();
        libraryHashes = new Set(
          libraryItems
            .filter((item) => item.hash)
            .map((item) => item.hash!.toLowerCase())
        );
      } catch (error) {
        logger.warn(
          `Failed to list library magnets for checkOwned on ${this.serviceName}`,
          { error: (error as Error).message }
        );
      }
    }

    const cachedResults: DebridDownload[] = [];
    let newResults: DebridDownload[] = [];
    const magnetsToCheck: string[] = [];
    for (const magnet of magnets) {
      const cached = await this.checkCacheGet(magnet);
      if (cached) {
        cachedResults.push(cached);
      } else {
        magnetsToCheck.push(magnet);
      }
    }

    if (magnetsToCheck.length > 0) {
      const BATCH_SIZE = 500;
      const batches: string[][] = [];
      for (let i = 0; i < magnetsToCheck.length; i += BATCH_SIZE) {
        batches.push(magnetsToCheck.slice(i, i + BATCH_SIZE));
      }

      try {
        const batchResults = await Promise.all(
          batches.map(async (batch) => {
            const result = await this.stremthru.store.checkMagnet({
              magnet: batch,
              sid,
            });

            assert.ok(
              result?.data,
              `StremThru checkMagnets returned no data: ${JSON.stringify(result)}`
            );

            return result.data.items;
          })
        );

        const allItems = batchResults.flat();

        newResults = allItems.map((item) => ({
          id: -1,
          hash: item.hash,
          status: item.status,
          size: item.files.reduce((acc, file) => acc + file.size, 0),
          files: item.files.map((file) => ({
            name: file.name,
            size: file.size,
            index: file.index,
          })),
        }));

        newResults.forEach((item) => {
          this.checkCacheSet(item);
        });
      } catch (error) {
        if (error instanceof StremThruError) {
          throw convertStremThruError(error);
        }
        throw error;
      }
    }
    const allResults = [...cachedResults, ...newResults];

    if (libraryHashes) {
      for (const item of allResults) {
        if (item.hash && libraryHashes.has(item.hash.toLowerCase())) {
          item.library = true;
        }
      }
    }

    return allResults;
  }

  public async addMagnet(magnet: string): Promise<DebridDownload> {
    return await this._addMagnet({ magnet });
  }

  public async addTorrent(torrent: string): Promise<DebridDownload> {
    return await this._addMagnet({ torrent });
  }

  public async _addMagnet(
    input:
      | { magnet: string; torrent?: never }
      | { magnet?: never; torrent: File | string }
  ): Promise<DebridDownload> {
    try {
      const result = await this.stremthru.store.addMagnet(input);
      assert.ok(
        result?.data,
        `Missing data from StremThru addMagnet: ${JSON.stringify(result)}`
      );
      result.data.files = result.data.files ?? [];

      return {
        id: result.data.id,
        status: result.data.status,
        hash: result.data.hash,
        private: result.data.private,
        size: result.data.files.reduce((acc, file) => acc + file.size, 0),
        files: result.data.files.map((file) => ({
          name: file.name,
          size: file.size,
          link: file.link,
          path: file.path,
          index: file.index,
        })),
      };
    } catch (error) {
      throw error instanceof StremThruError
        ? convertStremThruError(error)
        : error;
    }
  }

  public async generateTorrentLink(
    link: string,
    clientIp?: string
  ): Promise<string> {
    try {
      const result = await this.stremthru.store.generateLink({
        link,
        clientIp,
      });
      assert.ok(
        result?.data,
        `Missing data from StremThru generateTorrentLink: ${JSON.stringify(result)}`
      );
      return result.data.link;
    } catch (error) {
      throw error instanceof StremThruError
        ? convertStremThruError(error)
        : error;
    }
  }

  private async fetchAndCacheMagnets(
    cacheKey: string,
    limit: number
  ): Promise<DebridDownload[]> {
    const start = Date.now();
    const allItems: DebridDownload[] = [];
    let offset = 0;
    const maxItems = Env.BUILTIN_DEBRID_LIBRARY_PAGE_LIMIT * limit;
    let totalItems = maxItems;

    while (offset < totalItems) {
      const result = await this.stremthru.store.listMagnets({
        limit,
        offset,
      });
      totalItems = Math.min(result.data.total_items, maxItems);
      for (const item of result.data.items) {
        allItems.push({
          id: item.id,
          hash: item.hash,
          name: item.name,
          size: (item as any).size,
          status: item.status,
          private: item.private,
          addedAt: item.added_at,
        });
      }
      offset += limit;
      if (result.data.items.length < limit) break;
    }

    logger.debug(`Listed magnets from ${this.serviceName}`, {
      count: allItems.length,
      totalItems,
      time: getTimeTakenSincePoint(start),
    });

    await StremThruService.libraryCache.set(
      cacheKey,
      allItems,
      Env.BUILTIN_DEBRID_LIBRARY_CACHE_TTL,
      true
    );

    return allItems;
  }

  private async refreshMagnetsInBackground(
    cacheKey: string,
    limit: number
  ): Promise<void> {
    const lockKey = `st:library:refresh:${cacheKey}`;
    await DistributedLock.getInstance().withLock(
      lockKey,
      async () => {
        await StremThruService.libraryCache.delete(cacheKey);
        return this.fetchAndCacheMagnets(cacheKey, limit);
      },
      { type: 'memory', timeout: 1000 }
    );
  }

  // Usenet methods (UsenetDebridService)

  public async checkNzbs(
    nzbs: { name?: string; hash?: string }[],
    checkOwned: boolean = true
  ): Promise<DebridDownload[]> {
    nzbs = nzbs.filter((nzb) => nzb.hash);
    if (nzbs.length === 0) {
      return [];
    }

    let libraryHashes: Set<string> | undefined;
    if (checkOwned) {
      try {
        const libraryItems = await this.listNzbs();
        libraryHashes = new Set(
          libraryItems
            .filter((item) => item.hash)
            .map((item) => item.hash!.toLowerCase())
        );
      } catch (error) {
        logger.warn(
          `Failed to list library newz for checkOwned on ${this.serviceName}`,
          { error: (error as Error).message }
        );
      }
    }

    const cachedResults: DebridDownload[] = [];
    const hashesToCheck: string[] = [];

    for (const { hash } of nzbs as { hash: string }[]) {
      const cached = await this.checkCacheGet(hash);
      if (cached) {
        cachedResults.push(cached);
      } else {
        hashesToCheck.push(hash);
      }
    }

    let newResults: DebridDownload[] = [];

    if (hashesToCheck.length > 0) {
      try {
        const BATCH_SIZE = 500;
        const batches: string[][] = [];
        for (let i = 0; i < hashesToCheck.length; i += BATCH_SIZE) {
          batches.push(hashesToCheck.slice(i, i + BATCH_SIZE));
        }

        const batchResults = await Promise.all(
          batches.map(async (batch) => {
            const result = await this.stremthru.store.checkNewz({
              hash: batch,
            });
            return result.data.items;
          })
        );

        const allItems = batchResults.flat();

        logger.debug(`Checked NZBs on ${this.serviceName}`, {
          checked: hashesToCheck.length,
          found: allItems.length,
        });

        logger.debug(JSON.stringify(allItems, null, 2));

        newResults = allItems.map((item) => ({
          id: -1,
          hash: item.hash,
          // status: item.status == 'unknown' ? 'cached' : item.status,
          status:
            this.usenetOptions.treatUnknownAsCached && item.status === 'unknown'
              ? 'cached'
              : item.status,
          size: item.files
            ? item.files.reduce((acc, file) => acc + file.size, 0)
            : undefined,
          files: item.files?.map((file) => ({
            name: file.name,
            size: file.size,
            index: file.index,
            link: file.link,
            path: file.path,
          })),
        }));

        newResults
          .filter((item) => item.hash)
          .forEach((item) => {
            this.checkCacheSet(item);
          });
      } catch (error) {
        if (error instanceof StremThruError) {
          throw convertStremThruError(error);
        }
        throw error;
      }
    }

    const allResults = [...cachedResults, ...newResults];

    if (libraryHashes) {
      for (const item of allResults) {
        if (item.hash && libraryHashes.has(item.hash.toLowerCase())) {
          item.library = true;
        }
      }
    }

    return allResults;
  }

  public async listNzbs(id?: string): Promise<DebridDownload[]> {
    if (id) {
      const item = await this.getNzb(id);
      return [item];
    }

    return this.getLibraryWithStaleRefresh(
      'usenet',
      (cacheKey, limit) => this.fetchAndCacheNzbs(cacheKey, limit),
      (cacheKey, limit) => this.refreshNzbsInBackground(cacheKey, limit)
    );
  }

  public async getNzb(nzbId: string): Promise<DebridDownload> {
    try {
      const result = await this.stremthru.store.getNewz(nzbId);
      assert.ok(
        result?.data,
        `Missing data from StremThru getNewz: ${JSON.stringify(result)}`
      );
      return {
        id: result.data.id,
        hash: result.data.hash,
        name: result.data.name,
        size: result.data.size,
        status: result.data.status as DebridDownload['status'],
        addedAt: result.data.added_at,
        files: (result.data.files ?? []).map((file) => ({
          name: file.name,
          size: file.size,
          link: file.link,
          path: file.path,
          index: file.index,
        })),
      };
    } catch (error) {
      if (error instanceof StremThruError) {
        throw convertStremThruError(error);
      }
      throw error;
    }
  }

  public async addNzb(nzb: string, name: string): Promise<DebridDownload> {
    try {
      const result = await this.stremthru.store.addNewz({ link: nzb });
      assert.ok(
        result?.data,
        `Missing data from StremThru addNewz: ${JSON.stringify(result)}`
      );
      return this.getNzb(result.data.id);
    } catch (error) {
      if (error instanceof StremThruError) {
        throw convertStremThruError(error);
      }
      throw error;
    }
  }

  public async removeNzb(nzbId: string): Promise<void> {
    try {
      await this.stremthru.store.removeNewz(nzbId);
      logger.debug(`Removed newz ${nzbId} from ${this.serviceName}`);
    } catch (error) {
      if (error instanceof StremThruError) {
        throw convertStremThruError(error);
      }
      throw error;
    }
  }

  public async generateUsenetLink(
    link: string,
    _fileId?: string,
    clientIp?: string
  ): Promise<string> {
    try {
      const result = await this.stremthru.store.generateNewzLink({
        link,
        clientIp,
      });
      assert.ok(
        result?.data,
        `Missing data from StremThru generateNewzLink: ${JSON.stringify(result)}`
      );
      return result.data.link;
    } catch (error) {
      if (error instanceof StremThruError) {
        throw convertStremThruError(error);
      }
      throw error;
    }
  }

  private async fetchAndCacheNzbs(
    cacheKey: string,
    limit: number
  ): Promise<DebridDownload[]> {
    const start = Date.now();
    const allItems: DebridDownload[] = [];
    let offset = 0;
    const maxItems = Env.BUILTIN_DEBRID_LIBRARY_PAGE_LIMIT * limit;
    let totalItems = maxItems;

    while (offset < totalItems) {
      try {
        const result = await this.stremthru.store.listNewz({
          limit,
          offset,
        });
        totalItems = Math.min(result.data.total_items, maxItems);
        for (const item of result.data.items) {
          allItems.push({
            id: item.id,
            hash: item.hash,
            name: item.name,
            size: item.size,
            status: item.status as DebridDownload['status'],
            addedAt: item.added_at,
          });
        }
        offset += limit;
        if (result.data.items.length < limit) break;
      } catch (error) {
        if (error instanceof StremThruError) {
          throw convertStremThruError(error);
        }
        throw error;
      }
    }

    logger.debug(`Listed newz from ${this.serviceName}`, {
      count: allItems.length,
      totalItems,
      time: getTimeTakenSincePoint(start),
    });

    await StremThruService.libraryCache.set(
      cacheKey,
      allItems,
      Env.BUILTIN_DEBRID_LIBRARY_CACHE_TTL,
      true
    );

    return allItems;
  }

  private async refreshNzbsInBackground(
    cacheKey: string,
    limit: number
  ): Promise<void> {
    const lockKey = `st:library:refresh:${cacheKey}`;
    await DistributedLock.getInstance().withLock(
      lockKey,
      async () => {
        await StremThruService.libraryCache.delete(cacheKey);
        return this.fetchAndCacheNzbs(cacheKey, limit);
      },
      { type: 'memory', timeout: 1000 }
    );
  }

  // shared

  public async refreshLibraryCache(
    sources?: ('torrent' | 'nzb')[]
  ): Promise<void> {
    const includeTorrents =
      this.capabilities.torrents &&
      (!sources || sources.length === 0 || sources.includes('torrent'));
    const includeNzbs =
      this.capabilities.usenet &&
      (!sources || sources.length === 0 || sources.includes('nzb'));

    if (includeTorrents) {
      const cacheKey = this.getLibraryCacheKey('torrent');
      const limit = this.getLibraryLimit();
      await StremThruService.libraryCache.delete(cacheKey);
      await this.fetchAndCacheMagnets(cacheKey, limit);
    }

    if (includeNzbs) {
      const cacheKey = this.getLibraryCacheKey('usenet');
      const limit = this.getLibraryLimit();
      await StremThruService.libraryCache.delete(cacheKey);
      await this.fetchAndCacheNzbs(cacheKey, limit);
    }
  }

  public async resolve(
    playbackInfo: PlaybackInfo,
    filename: string,
    cacheAndPlay: boolean,
    autoRemoveDownloads?: boolean
  ): Promise<string | undefined> {
    if (playbackInfo.type === 'usenet') {
      const effectiveCacheAndPlay =
        this.usenetOptions.alwaysCacheAndPlay || cacheAndPlay;
      const effectiveAutoRemove = this.usenetOptions.neverAutoRemove
        ? false
        : autoRemoveDownloads;

      const { result } = await DistributedLock.getInstance().withLock(
        `st:resolve:usenet:${this.serviceName}:${playbackInfo.hash}:${playbackInfo.metadata?.season}:${playbackInfo.metadata?.episode}:${playbackInfo.metadata?.absoluteEpisode}:${filename}:${effectiveCacheAndPlay}:${effectiveAutoRemove}:${this.config.clientIp}:${this.config.stremthru.token}`,
        () =>
          this._resolveUsenet(
            playbackInfo,
            filename,
            effectiveCacheAndPlay,
            effectiveAutoRemove
          ),
        {
          timeout: effectiveCacheAndPlay ? 120000 : 30000,
          ttl: effectiveCacheAndPlay ? 130000 : 40000,
        }
      );
      return result;
    }

    // Torrent resolve
    const { result } = await DistributedLock.getInstance().withLock(
      `st:resolve:torrent:${this.serviceName}:${playbackInfo.hash}:${playbackInfo.metadata?.season}:${playbackInfo.metadata?.episode}:${playbackInfo.metadata?.absoluteEpisode}:${filename}:${cacheAndPlay}:${autoRemoveDownloads}:${this.config.clientIp}:${this.config.stremthru.token}`,
      () =>
        this._resolveTorrent(
          playbackInfo,
          filename,
          cacheAndPlay,
          autoRemoveDownloads
        ),
      {
        timeout: playbackInfo.cacheAndPlay ? 120000 : 30000,
        ttl: 10000,
      }
    );
    return result;
  }

  /**
   * Resolve a placeholder hash to the real info hash if a mapping exists.
   * Used by the cache-checking pipeline to look up real hashes before
   * calling checkMagnets, so already-downloaded torrents show as cached.
   */
  public static async resolveHash(
    serviceName: string,
    hash: string
  ): Promise<string> {
    const realHash = await StremThruService.hashMapping.get(
      `${serviceName}:${hash}`
    );
    if (realHash) {
      logger.debug(`Resolved placeholder hash ${hash} → ${realHash}`, {
        serviceName,
      });
    }
    return realHash ?? hash;
  }

  private async _resolveTorrent(
    playbackInfo: PlaybackInfo & { type: 'torrent' },
    filename: string,
    cacheAndPlay: boolean,
    autoRemoveDownloads?: boolean
  ): Promise<string | undefined> {
    let { hash, metadata } = playbackInfo;
    const cacheKey = `torrent:${this.serviceName}:${this.config.stremthru.token}:${this.config.clientIp}:${hash}:${metadata?.season}:${metadata?.episode}:${metadata?.absoluteEpisode}`;
    const cachedLink = await StremThruService.playbackLinkCache.get(cacheKey);

    if (cachedLink !== undefined) {
      logger.debug(`Using cached link for ${hash}`);
      if (cachedLink === null) {
        if (!cacheAndPlay) {
          return undefined;
        }
      } else {
        return cachedLink;
      }
    }

    let magnetDownload: DebridDownload;
    if (playbackInfo.serviceItemId) {
      logger.debug(`Resolving library torrent item by serviceItemId`, {
        serviceItemId: playbackInfo.serviceItemId,
      });
      magnetDownload = await this.getMagnet(playbackInfo.serviceItemId);
      logger.debug(`Found library torrent item`, {
        status: magnetDownload.status,
        id: magnetDownload.id,
      });
    } else if (
      (playbackInfo.private !== undefined || playbackInfo.placeholderHash) &&
      playbackInfo.downloadUrl &&
      Env.BUILTIN_DEBRID_USE_TORRENT_DOWNLOAD_URL &&
      (await this.checkCacheGet(hash))?.status !== 'cached'
    ) {
      logger.debug(
        `Adding torrent to ${this.serviceName} for ${playbackInfo.downloadUrl}`
      );
      magnetDownload = await this.addTorrent(playbackInfo.downloadUrl);

      // Map placeholder → real hash so future cache checks and polling work
      const realHash = magnetDownload.hash;
      if (playbackInfo.placeholderHash && realHash && realHash !== hash) {
        logger.debug(
          `Mapped placeholder hash ${hash} → real hash ${realHash}`
        );
        try {
          await StremThruService.hashMapping.set(
            `${this.serviceName}:${hash}`,
            realHash,
            3600 * 24 * 7,
            true
          );
        } catch (err: any) {
          logger.warn(`Failed to cache hash mapping: ${err.message}`);
        }
        hash = realHash;
      }

      logger.debug(`Torrent added for ${playbackInfo.downloadUrl}`, {
        status: magnetDownload.status,
        id: magnetDownload.id,
      });
    } else {
      let magnet = `magnet:?xt=urn:btih:${hash}`;
      if (playbackInfo.filename) {
        magnet += `&dn=${playbackInfo.filename}`;
      }
      if (playbackInfo.sources.length > 0) {
        magnet += `&tr=${playbackInfo.sources.join('&tr=')}`;
      }

      logger.debug(`Adding magnet to ${this.serviceName} for ${magnet}`);
      magnetDownload = await this.addMagnet(magnet);
      logger.debug(`Magnet download added for ${magnet}`, {
        status: magnetDownload.status,
        id: magnetDownload.id,
      });
    }

    if (magnetDownload.status !== 'downloaded') {
      StremThruService.playbackLinkCache.set(cacheKey, null, 60);
      if (!cacheAndPlay) {
        return undefined;
      }
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 11000));
        const list = await this.listMagnets();
        const magnetDownloadInList = list.find(
          (magnet) => magnet.hash === hash
        );
        if (!magnetDownloadInList) {
          logger.warn(`Failed to find ${hash} in list`);
        } else {
          logger.debug(`Polled status for ${hash}`, {
            attempt: i + 1,
            status: magnetDownloadInList.status,
          });
          if (magnetDownloadInList.status === 'downloaded') {
            magnetDownload = magnetDownloadInList;
            break;
          }
        }
      }
      if (magnetDownload.status !== 'downloaded') {
        return undefined;
      }
    }

    if (!magnetDownload.files?.length) {
      throw new DebridError('No files found for magnet download', {
        statusCode: 400,
        statusText: 'No files found for magnet download',
        code: 'NO_MATCHING_FILE',
        headers: {},
        body: magnetDownload,
      });
    }

    let file:
      | { name?: string; link?: string; size: number; index?: number }
      | undefined;

    if (playbackInfo.fileIndex !== undefined) {
      file = magnetDownload.files.find(
        (f) => f.index === playbackInfo.fileIndex
      );
      if (!file) {
        throw new DebridError(
          `File with index ${playbackInfo.fileIndex} not found`,
          {
            statusCode: 400,
            statusText: 'File not found',
            code: 'NO_MATCHING_FILE',
            headers: {},
            body: {
              fileIndex: playbackInfo.fileIndex,
              availableFiles: magnetDownload.files.map((f) => f.index),
            },
          }
        );
      }
      logger.debug(`Using specified fileIndex`, {
        fileIndex: playbackInfo.fileIndex,
        fileName: file.name,
      });
    } else {
      const torrent: Torrent = {
        title: magnetDownload.name || playbackInfo.title,
        hash: hash,
        size: magnetDownload.size || 0,
        type: 'torrent',
        sources: playbackInfo.sources,
        private: playbackInfo.private,
      };

      const allStrings: string[] = [];
      allStrings.push(magnetDownload.name ?? '');
      allStrings.push(...magnetDownload.files.map((file) => file.name ?? ''));
      const parseResults: ParsedResult[] = allStrings.map((string) =>
        parseTorrentTitle(string)
      );
      const parsedFiles = new Map<string, ParsedResult>();
      for (const [index, result] of parseResults.entries()) {
        parsedFiles.set(allStrings[index], result);
      }

      file = await selectFileInTorrentOrNZB(
        torrent,
        magnetDownload,
        parsedFiles,
        metadata,
        {
          chosenFilename: playbackInfo.filename,
          chosenIndex: playbackInfo.index,
        }
      );
    }

    if (!file?.link) {
      throw new DebridError('Selected file was missing a link', {
        statusCode: 400,
        statusText: 'Selected file was missing a link',
        code: 'NO_MATCHING_FILE',
        headers: {},
        body: file,
      });
    }

    logger.debug(`Found matching file`, {
      season: metadata?.season,
      episode: metadata?.episode,
      absoluteEpisode: metadata?.absoluteEpisode,
      relativeAbsoluteEpisode: metadata?.relativeAbsoluteEpisode,
      chosenFile: file.name,
      availableFiles: `[${magnetDownload.files.map((file) => file.name).join(', ')}]`,
    });

    const playbackLink = await this.generateTorrentLink(
      file.link,
      this.config.clientIp
    );
    await StremThruService.playbackLinkCache.set(
      cacheKey,
      playbackLink,
      Env.BUILTIN_DEBRID_PLAYBACK_LINK_CACHE_TTL,
      true
    );

    // Invalidate stale instant availability cache entries so the next browse
    // reflects the updated state (torrent now available in the store).
    this.checkCacheDelete(playbackInfo.hash);
    if (hash !== playbackInfo.hash) {
      this.checkCacheDelete(hash);
    }

    if (autoRemoveDownloads && magnetDownload.id && !magnetDownload.private) {
      this.removeMagnet(magnetDownload.id.toString()).catch((err) => {
        logger.warn(
          `Failed to cleanup magnet ${magnetDownload.id} after resolve: ${err.message}`
        );
      });
    }

    return playbackLink;
  }

  private async _resolveUsenet(
    playbackInfo: PlaybackInfo & { type: 'usenet' },
    filename: string,
    cacheAndPlay: boolean,
    autoRemoveDownloads?: boolean
  ): Promise<string | undefined> {
    const { nzb, metadata, hash } = playbackInfo;
    const cacheKey = `usenet:${this.serviceName}:${this.config.stremthru.token}:${this.config.clientIp}:${JSON.stringify(playbackInfo)}`;
    const cachedLink = await StremThruService.playbackLinkCache.get(cacheKey);

    if (cachedLink !== undefined) {
      logger.debug(`Using cached link for ${nzb || hash}`);
      if (cachedLink === null) {
        if (!cacheAndPlay) {
          return undefined;
        }
      } else {
        return cachedLink;
      }
    }

    let usenetDownload: DebridDownload;

    if (!nzb) {
      // Library item - no NZB URL, look up existing download
      if (playbackInfo.serviceItemId) {
        logger.debug(`Resolving library usenet item by serviceItemId`, {
          serviceItemId: playbackInfo.serviceItemId,
        });
        usenetDownload = await this.getNzb(playbackInfo.serviceItemId);
      } else {
        logger.debug(`Resolving library usenet item by hash`, { hash });
        const libraryItems = await this.listNzbs();
        const existingItem = libraryItems.find((item) => item.hash === hash);
        if (!existingItem) {
          throw new DebridError(
            'Could not find usenet download in library by hash',
            {
              statusCode: 404,
              statusText: 'Not found',
              code: 'NOT_FOUND',
              headers: {},
              body: { hash },
              type: 'api_error',
            }
          );
        }
        usenetDownload = await this.getNzb(existingItem.id.toString());
      }

      logger.debug(`Found library usenet item`, {
        id: usenetDownload.id,
        status: usenetDownload.status,
        name: usenetDownload.name,
      });
    } else {
      logger.debug(`Adding usenet download for ${nzb}`, { hash });

      usenetDownload = await this.addNzb(nzb, filename);

      logger.debug(`Usenet download added for ${nzb}`, {
        status: usenetDownload.status,
        id: usenetDownload.id,
      });
    }

    if (usenetDownload.status !== 'downloaded') {
      StremThruService.playbackLinkCache.set(cacheKey, null, 60);
      if (!cacheAndPlay) {
        return undefined;
      }
      // poll status when cacheAndPlay is true, max wait time is 110s
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 11000));
        try {
          const polledDownload = await this.getNzb(
            usenetDownload.id.toString()
          );
          logger.debug(`Polled status for ${nzb || hash}`, {
            attempt: i + 1,
            status: polledDownload.status,
          });
          if (polledDownload.status === 'downloaded') {
            usenetDownload = polledDownload;
            break;
          }
        } catch (error) {
          logger.warn(`Failed to poll status for ${nzb || hash}`, {
            attempt: i + 1,
            error: (error as Error).message,
          });
        }
      }
      if (usenetDownload.status !== 'downloaded') {
        return undefined;
      }
    }

    if (!usenetDownload.files?.length) {
      throw new DebridError('No files found for usenet download', {
        statusCode: 400,
        statusText: 'No files found for usenet download',
        code: 'NO_MATCHING_FILE',
        headers: {},
        body: usenetDownload,
        type: 'api_error',
      });
    }

    let file:
      | { name?: string; link?: string; size: number; index?: number }
      | undefined;

    if (playbackInfo.fileIndex !== undefined) {
      file = usenetDownload.files.find(
        (f) => f.index === playbackInfo.fileIndex
      );
      if (!file) {
        throw new DebridError(
          `File with index ${playbackInfo.fileIndex} not found`,
          {
            statusCode: 400,
            statusText: 'File not found',
            code: 'NO_MATCHING_FILE',
            headers: {},
            body: {
              fileIndex: playbackInfo.fileIndex,
              availableFiles: usenetDownload.files.map((f) => f.index),
            },
          }
        );
      }
      logger.debug(`Using specified fileIndex`, {
        fileIndex: playbackInfo.fileIndex,
        fileName: file.name,
      });
    } else if (usenetDownload.files.length > 1) {
      const nzbInfo = {
        type: 'usenet' as const,
        nzb: nzb,
        hash: hash,
        title: usenetDownload.name,
        file: usenetDownload.files[playbackInfo.index ?? 0],
        metadata: metadata,
        size: usenetDownload.size || 0,
      };
      const allStrings: string[] = [];
      allStrings.push(usenetDownload.name ?? '');
      allStrings.push(...usenetDownload.files.map((f) => f.name ?? ''));

      const parseResults: ParsedResult[] = allStrings.map((string) =>
        parseTorrentTitle(string)
      );
      const parsedFiles = new Map<string, ParsedResult>();
      for (const [index, result] of parseResults.entries()) {
        parsedFiles.set(allStrings[index], result);
      }

      file = await selectFileInTorrentOrNZB(
        nzbInfo,
        usenetDownload,
        parsedFiles,
        metadata,
        {
          chosenFilename: playbackInfo.filename,
          chosenIndex: playbackInfo.index,
        }
      );

      if (!file) {
        throw new DebridError('No matching file found', {
          statusCode: 400,
          statusText: 'No matching file found',
          code: 'NO_MATCHING_FILE',
          headers: {},
          body: file,
          type: 'api_error',
        });
      }

      logger.debug(`Found matching file`, {
        chosenFile: file.name,
        chosenIndex: file.index,
        availableFiles: `[${usenetDownload.files.map((f) => f.name).join(', ')}]`,
      });
    } else {
      file = usenetDownload.files[0];
    }

    if (!file?.link) {
      throw new DebridError('Selected file was missing a link', {
        statusCode: 400,
        statusText: 'Selected file was missing a link',
        code: 'NO_MATCHING_FILE',
        headers: {},
        body: file,
        type: 'api_error',
      });
    }

    const playbackLink = await this.generateUsenetLink(
      file.link,
      undefined,
      this.config.clientIp
    );

    await StremThruService.playbackLinkCache.set(
      cacheKey,
      playbackLink,
      Env.BUILTIN_DEBRID_PLAYBACK_LINK_CACHE_TTL,
      true
    );

    if (autoRemoveDownloads && usenetDownload.id && nzb) {
      this.removeNzb(usenetDownload.id.toString()).catch((err) => {
        logger.warn(
          `Failed to cleanup usenet download ${usenetDownload.id} after resolve: ${err.message}`
        );
      });
    }

    return playbackLink;
  }
}
