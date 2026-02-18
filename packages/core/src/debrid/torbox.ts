import { TorboxApi } from '@torbox/torbox-api';
import {
  Env,
  ServiceId,
  createLogger,
  getSimpleTextHash,
  Cache,
  DistributedLock,
  getTimeTakenSincePoint,
} from '../utils/index.js';
import { selectFileInTorrentOrNZB } from './utils.js';
import {
  DebridServiceConfig,
  DebridDownload,
  PlaybackInfo,
  DebridError,
  TorrentDebridService,
  UsenetDebridService,
} from './base.js';
import { StremThruInterface } from './stremthru.js';
import { ParsedResult, parseTorrentTitle } from '@viren070/parse-torrent-title';

const logger = createLogger('debrid:torbox');

function convertTorBoxError(error: any): DebridError {
  if (typeof error.message === 'string') {
    // extract body JSON by looking for line in error.message starting with Body: and parsing the rest of the line as JSON
    const body = (() => {
      const match = error.message.match(/Body:\s*({.*})/);
      if (match) {
        try {
          return JSON.parse(match[1]);
        } catch (e) {
          logger.warn(
            `Failed to parse error body JSON: ${e instanceof Error ? e.message : String(e)}`
          );
          return undefined;
        }
      }
      return undefined;
    })();
    const errorCode =
      (body?.error || error.message.match(/([A-Z_]{2,})/)?.[1]) ?? 'UNKNOWN';

    let code: DebridError['code'] = 'UNKNOWN';
    let message = body?.detail || error.message || 'Unknown error';
    const statusCode =
      typeof error.metadata?.status === 'number'
        ? error.metadata.status
        : undefined;
    const statusText =
      typeof error.metadata?.statusText === 'string'
        ? error.metadata.statusText
        : undefined;

    switch (errorCode) {
      case 'ACTIVE_LIMIT':
      case 'COOLDOWN_LIMIT':
      case 'MONTHLY_LIMIT':
      case 'DOWNLOAD_TOO_LARGE':
        code = 'STORE_LIMIT_EXCEEDED';
        break;
      case 'NO_AUTH':
      case 'BAD_TOKEN':
      case 'AUTH_ERROR':
        code = 'UNAUTHORIZED';
        break;
      case 'RATE_LIMIT_EXCEEDED':
        code = 'TOO_MANY_REQUESTS';
        break;
    }
    if (error.message.includes('429') || error.message.includes('rate limit')) {
      code = 'TOO_MANY_REQUESTS';
      message = 'Too many requests - rate limit exceeded';
    }

    return new DebridError(message, {
      statusCode: statusCode ?? 500,
      statusText: statusText ?? 'Unknown error',
      code,
      headers: error.metadata?.headers ?? {},
      body,
      cause: {},
      type: 'api_error',
    });
  }
  return new DebridError(error.message, {
    statusCode: error.statusCode ?? 500,
    statusText: error.statusText ?? 'Unknown error',
    code: 'UNKNOWN',
    headers: error.headers ?? {},
    body: error,
    cause: error,
    type: 'api_error',
  });
}

export class TorboxDebridService
  implements TorrentDebridService, UsenetDebridService
{
  private readonly apiVersion = 'v1';
  private readonly torboxApi: TorboxApi;
  private readonly stremthru: StremThruInterface;
  private static playbackLinkCache = Cache.getInstance<string, string | null>(
    'tb:link'
  );
  private static instantAvailabilityCache = Cache.getInstance<
    string,
    DebridDownload
  >('tb:instant-availability');
  readonly serviceName: ServiceId = 'torbox';

  constructor(private readonly config: DebridServiceConfig) {
    this.torboxApi = new TorboxApi({
      token: config.token,
    });

    this.stremthru = new StremThruInterface({
      ...config,
      serviceName: this.serviceName,
    });
  }
  public async listMagnets(): Promise<DebridDownload[]> {
    return this.stremthru.listMagnets();
  }
  public async getMagnet(magnetId: string): Promise<DebridDownload> {
    return this.stremthru.getMagnet(magnetId);
  }

  public async removeMagnet(magnetId: string): Promise<void> {
    return this.stremthru.removeMagnet(magnetId);
  }

  public async removeNzb(nzbId: string): Promise<void> {
    try {
      await this.torboxApi.usenet.controlUsenetDownload(this.apiVersion, {
        usenet_id: parseInt(nzbId, 10),
        operation: 'delete',
      });
      logger.debug(`Removed usenet download ${nzbId} from Torbox`);
    } catch (error: any) {
      throw new DebridError(
        `Failed to remove usenet download: ${error.message}`,
        {
          statusCode: error.statusCode ?? 500,
          statusText: error.statusText ?? 'Unknown error',
          code: 'UNKNOWN',
          headers: {},
          body: error,
          type: 'api_error',
        }
      );
    }
  }

  public async checkMagnets(
    magnets: string[],
    sid?: string,
    checkOwned: boolean = true
  ) {
    return this.stremthru.checkMagnets(magnets, sid, checkOwned);
  }

  public async addMagnet(magnet: string): Promise<DebridDownload> {
    return this.stremthru.addMagnet(magnet);
  }

  public async addTorrent(torrent: string): Promise<DebridDownload> {
    return this.stremthru.addTorrent(torrent);
  }

  public async generateTorrentLink(
    link: string,
    clientIp?: string
  ): Promise<string> {
    return this.stremthru.generateTorrentLink(link, clientIp);
  }

  public async checkNzbs(
    nzbs: { name?: string; hash?: string }[]
  ): Promise<DebridDownload[]> {
    nzbs = nzbs.filter((nzb) => nzb.hash);
    if (nzbs.length === 0) {
      return [];
    }
    const cachedResults: DebridDownload[] = [];
    const hashesToCheck: string[] = [];
    for (const { hash } of nzbs as { hash: string }[]) {
      const cacheKey = getSimpleTextHash(hash);
      const cached =
        await TorboxDebridService.instantAvailabilityCache.get(cacheKey);
      if (cached) {
        cachedResults.push(cached);
      } else {
        hashesToCheck.push(hash);
      }
    }

    if (hashesToCheck.length > 0) {
      let newResults: DebridDownload[] = [];

      try {
        const result = await this.torboxApi.usenet.getUsenetCachedAvailability(
          this.apiVersion,
          {
            hashes: hashesToCheck,
            format: 'list',
            listFiles: 'true',
          }
        );
        if (!result.data?.success) {
          throw new DebridError(`Failed to check instant availability`, {
            statusCode: result.metadata.status,
            statusText: result.metadata.statusText,
            code: 'UNKNOWN',
            headers: result.metadata.headers,
            body: result.data,
          });
        }

        if (!Array.isArray(result.data.data)) {
          throw new DebridError(
            'Invalid response from Torbox API. Expected array, got object',
            {
              statusCode: result.metadata.status,
              statusText: result.metadata.statusText,
              code: 'UNKNOWN',
              headers: result.metadata.headers,
              body: result.data,
            }
          );
        }

        newResults = result.data.data.map((item) => ({
          id: -1,
          hash: item.hash,
          status: 'cached' as const,
          size: item.size,
          files: item.files?.map((file) => ({
            id: file.id,
            name: file.shortName ?? file.name ?? '',
            size: file.size ?? 0,
            mimeType: file.mimetype,
          })),
        }));

        newResults
          .filter((item) => item.hash)
          .forEach((item) => {
            TorboxDebridService.instantAvailabilityCache.set(
              getSimpleTextHash(item.hash!),
              item,
              Env.BUILTIN_DEBRID_INSTANT_AVAILABILITY_CACHE_TTL
            );
          });
      } catch (error: any) {
        throw convertTorBoxError(error);
      }

      return [...cachedResults, ...newResults];
    }

    return cachedResults;
  }

  public async addNzb(nzb: string, name: string): Promise<DebridDownload> {
    try {
      const res = await this.torboxApi.usenet.createUsenetDownload(
        this.apiVersion,
        {
          link: nzb,
          name,
        }
      );

      if (!res.data?.data?.usenetdownloadId) {
        throw new DebridError(`Usenet download failed: ${res.data?.detail}`, {
          statusCode: res.metadata.status,
          statusText: res.metadata.statusText,
          code: 'UNKNOWN',
          headers: res.metadata.headers,
          body: res.data,
          cause: res.data,
          type: 'api_error',
        });
      }
      const usenetDownload = await this.listNzbs(
        res.data.data.usenetdownloadId.toString()
      );
      if (Array.isArray(usenetDownload)) {
        return usenetDownload[0];
      }
      return usenetDownload;
    } catch (error: any) {
      throw convertTorBoxError(error);
    }
  }

  private static libraryCache = Cache.getInstance<string, DebridDownload[]>(
    'tb:library'
  );

  private async _fetchNzbList(id?: string): Promise<DebridDownload[]> {
    let nzbInfo;
    try {
      nzbInfo = await this.torboxApi.usenet.getUsenetList(this.apiVersion, {
        id,
      });
    } catch (error: any) {
      throw convertTorBoxError(error);
    }

    if (
      !nzbInfo?.data?.data ||
      nzbInfo?.data?.error ||
      nzbInfo.data.success === false
    ) {
      throw new DebridError(
        `Failed to get usenet list: ${nzbInfo?.data?.error || 'Unknown error'}${nzbInfo?.data?.detail ? '- ' + nzbInfo.data.detail : ''}`,
        {
          statusCode: nzbInfo.metadata.status,
          statusText: nzbInfo.metadata.statusText,
          code: 'UNKNOWN',
          headers: nzbInfo.metadata.headers,
          body: nzbInfo.data,
          cause: nzbInfo.data,
          type: 'api_error',
        }
      );
    }

    if (id && Array.isArray(nzbInfo.data.data)) {
      throw new DebridError('Unexpected response format for usenet download', {
        statusCode: nzbInfo.metadata.status,
        statusText: nzbInfo.metadata.statusText,
        code: 'UNKNOWN',
        headers: nzbInfo.metadata.headers,
        body: nzbInfo.data,
        cause: nzbInfo.data,
        type: 'api_error',
      });
    }

    return (
      Array.isArray(nzbInfo.data.data) ? nzbInfo.data.data : [nzbInfo.data.data]
    ).map((usenetDownload) => {
      let status: DebridDownload['status'] = 'queued';
      if (usenetDownload.downloadFinished && usenetDownload.downloadPresent) {
        status = 'downloaded';
      } else if (usenetDownload.progress && usenetDownload.progress > 0) {
        status = 'downloading';
      }
      return {
        id: usenetDownload.id ?? -1,
        hash: usenetDownload.hash ?? undefined,
        name: usenetDownload.name ?? undefined,
        status,
        addedAt: usenetDownload.createdAt ?? undefined,
        files: (usenetDownload.files ?? []).map((file) => ({
          id: file.id ?? -1,
          mimeType: file.mimetype,
          name: file.shortName ?? file.name ?? '',
          size: file.size ?? 0,
        })),
      };
    });
  }

  public async listNzbs(id?: string): Promise<DebridDownload[]> {
    // If fetching a specific ID, bypass cache
    if (id) {
      return this._fetchNzbList(id);
    }

    const cacheKey = `torbox:usenet:${this.config.token}`;
    const limit = Math.min(
      Math.max(Env.BUILTIN_DEBRID_LIBRARY_PAGE_SIZE, 100),
      1000
    );
    const maxItems = Env.BUILTIN_DEBRID_LIBRARY_PAGE_LIMIT * limit;

    // Check for stale cache before acquiring the lock
    const cached = await TorboxDebridService.libraryCache.get(cacheKey);
    if (cached) {
      const remainingTTL =
        await TorboxDebridService.libraryCache.getTTL(cacheKey);
      if (remainingTTL !== null && remainingTTL > 0) {
        const age = Env.BUILTIN_DEBRID_LIBRARY_CACHE_TTL - remainingTTL;
        if (age > Env.BUILTIN_DEBRID_LIBRARY_STALE_THRESHOLD) {
          logger.debug(
            `Library cache for TorBox usenet is stale (age: ${age}s), triggering background refresh`
          );
          this.refreshNzbsInBackground(cacheKey, limit, maxItems).catch((err) =>
            logger.error(
              `Background library refresh failed for TorBox usenet`,
              err
            )
          );
        }
        return cached;
      }
    }

    const { result } = await DistributedLock.getInstance().withLock(
      `tb:library:usenet:${cacheKey}`,
      async () => {
        const cached = await TorboxDebridService.libraryCache.get(cacheKey);
        if (cached) {
          logger.debug(`Using cached usenet list for TorBox`);
          return cached;
        }

        return this.fetchAndCacheNzbs(cacheKey, limit, maxItems);
      },
      { type: 'memory', timeout: 10000 }
    );
    return result;
  }

  private async fetchAndCacheNzbs(
    cacheKey: string,
    limit: number,
    maxItems: number
  ): Promise<DebridDownload[]> {
    const start = Date.now();
    const allItems: DebridDownload[] = [];
    let offset = 0;

    while (offset < maxItems) {
      let nzbInfo;
      try {
        nzbInfo = await this.torboxApi.usenet.getUsenetList(this.apiVersion, {
          limit: limit.toString(),
          offset: offset.toString(),
        });
      } catch (error: any) {
        throw convertTorBoxError(error);
      }

      if (
        !nzbInfo?.data?.data ||
        nzbInfo?.data?.error ||
        nzbInfo.data.success === false
      ) {
        throw new DebridError(
          `Failed to get usenet list: ${nzbInfo?.data?.error || 'Unknown error'}${nzbInfo?.data?.detail ? '- ' + nzbInfo.data.detail : ''}`,
          {
            statusCode: nzbInfo.metadata.status,
            statusText: nzbInfo.metadata.statusText,
            code: 'UNKNOWN',
            headers: nzbInfo.metadata.headers,
            body: nzbInfo.data,
            cause: nzbInfo.data,
            type: 'api_error',
          }
        );
      }

      const items = Array.isArray(nzbInfo.data.data)
        ? nzbInfo.data.data
        : [nzbInfo.data.data];

      for (const usenetDownload of items) {
        let status: DebridDownload['status'] = 'queued';
        if (usenetDownload.downloadFinished && usenetDownload.downloadPresent) {
          status = 'downloaded';
        } else if (usenetDownload.progress && usenetDownload.progress > 0) {
          status = 'downloading';
        }
        allItems.push({
          id: usenetDownload.id ?? -1,
          hash: usenetDownload.hash ?? undefined,
          name: usenetDownload.name ?? undefined,
          status,
          addedAt: usenetDownload.createdAt ?? undefined,
        });
      }

      if (items.length < limit) break;
      offset += limit;
    }

    logger.debug(`Listed usenet downloads from TorBox`, {
      count: allItems.length,
      time: getTimeTakenSincePoint(start),
    });

    await TorboxDebridService.libraryCache.set(
      cacheKey,
      allItems,
      Env.BUILTIN_DEBRID_LIBRARY_CACHE_TTL,
      true
    );

    return allItems;
  }

  private async refreshNzbsInBackground(
    cacheKey: string,
    limit: number,
    maxItems: number
  ): Promise<void> {
    const lockKey = `tb:library:usenet:refresh:${cacheKey}`;
    await DistributedLock.getInstance().withLock(
      lockKey,
      async () => {
        await TorboxDebridService.libraryCache.delete(cacheKey);
        return this.fetchAndCacheNzbs(cacheKey, limit, maxItems);
      },
      { type: 'memory', timeout: 1000 }
    );
  }

  public async refreshLibraryCache(
    sources?: ('torrent' | 'nzb')[]
  ): Promise<void> {
    const includeTorrents =
      !sources || sources.length === 0 || sources.includes('torrent');
    const includeNzbs =
      !sources || sources.length === 0 || sources.includes('nzb');

    // Refresh magnets (delegated to StremThru)
    if (includeTorrents) {
      await this.stremthru.refreshLibraryCache();
    }

    // Refresh NZBs
    if (includeNzbs) {
      const cacheKey = `torbox:usenet:${this.config.token}`;
      const limit = Math.min(
        Math.max(Env.BUILTIN_DEBRID_LIBRARY_PAGE_SIZE, 100),
        1000
      );
      const maxItems = Env.BUILTIN_DEBRID_LIBRARY_PAGE_LIMIT * limit;
      await TorboxDebridService.libraryCache.delete(cacheKey);
      await this.fetchAndCacheNzbs(cacheKey, limit, maxItems);
    }
  }

  public async getNzb(nzbId: string): Promise<DebridDownload> {
    const items = await this._fetchNzbList(nzbId);
    return items[0];
  }

  public async generateUsenetLink(
    downloadId: string,
    fileId?: string,
    clientIp?: string
  ): Promise<string> {
    const link = await this.torboxApi.usenet.requestDownloadLink(
      this.apiVersion,
      {
        usenetId: downloadId,
        fileId: fileId,
        userIp: clientIp,
        redirect: 'false',
        token: this.config.token,
      }
    );

    if (!link.data?.data) {
      throw new DebridError('Failed to generate usenet download link', {
        statusCode: link.metadata.status,
        statusText: link.metadata.statusText,
        code: 'UNKNOWN',
        headers: link.metadata.headers,
        body: link.data,
        cause: link.data,
        type: 'api_error',
      });
    }

    return link.data.data;
  }
  public async resolve(
    playbackInfo: PlaybackInfo,
    filename: string,
    cacheAndPlay: boolean,
    autoRemoveDownloads?: boolean
  ): Promise<string | undefined> {
    if (playbackInfo.type === 'torrent') {
      return this.stremthru.resolve(
        playbackInfo,
        filename,
        cacheAndPlay,
        autoRemoveDownloads
      );
    }
    const { result } = await DistributedLock.getInstance().withLock(
      `torbox:resolve:${playbackInfo.hash}:${playbackInfo.metadata?.season}:${playbackInfo.metadata?.episode}:${playbackInfo.metadata?.absoluteEpisode}:${filename}:${cacheAndPlay}:${autoRemoveDownloads}:${this.config.clientIp}:${this.config.token}`,
      () =>
        this._resolve(
          playbackInfo,
          filename,
          cacheAndPlay,
          autoRemoveDownloads
        ),
      {
        timeout: playbackInfo.cacheAndPlay ? 120000 : 30000,
        ttl: playbackInfo.cacheAndPlay ? 130000 : 40000,
      }
    );
    return result;
  }

  private async _resolve(
    playbackInfo: PlaybackInfo & { type: 'usenet' },
    filename: string,
    cacheAndPlay: boolean,
    autoRemoveDownloads?: boolean
  ): Promise<string | undefined> {
    const { nzb, metadata, hash } = playbackInfo;
    const cacheKey = `${this.serviceName}:${this.config.token}:${this.config.clientIp}:${JSON.stringify(playbackInfo)}`;
    const cachedLink =
      await TorboxDebridService.playbackLinkCache.get(cacheKey);

    if (cachedLink !== undefined) {
      logger.debug(`Using cached link for ${nzb}`);
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
      // Library item — no NZB URL, look up existing download
      if (playbackInfo.serviceItemId) {
        // Direct ID lookup from catalog
        logger.debug(`Resolving library usenet item by serviceItemId`, {
          serviceItemId: playbackInfo.serviceItemId,
        });
        const fullItems = await this._fetchNzbList(playbackInfo.serviceItemId);
        usenetDownload = fullItems[0];
      } else {
        // Fallback: hash-based lookup
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
        const fullItems = await this._fetchNzbList(existingItem.id.toString());
        usenetDownload = fullItems[0];
      }

      logger.debug(`Found library usenet item`, {
        id: usenetDownload.id,
        status: usenetDownload.status,
        name: usenetDownload.name,
      });
    } else {
      logger.debug(`Adding usenet download for ${nzb}`, {
        hash,
      });

      usenetDownload = await this.addNzb(nzb, filename);

      logger.debug(`Usenet download added for ${nzb}`, {
        status: usenetDownload.status,
        id: usenetDownload.id,
      });
    }

    if (usenetDownload.status !== 'downloaded') {
      // temporarily cache the null value for 1m
      TorboxDebridService.playbackLinkCache.set(cacheKey, null, 60);
      if (!cacheAndPlay) {
        return undefined;
      }
      // poll status when cacheAndPlay is true, max wait time is 110s
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 11000));
        const usenetList = await this._fetchNzbList(
          usenetDownload.id.toString()
        );
        const usenetDownloadInList = usenetList.find(
          (usenet) => usenet.hash === hash || usenet.id === usenetDownload.id
        );
        if (!usenetDownloadInList) {
          logger.warn(`Failed to find ${nzb || hash} in list`);
        } else {
          logger.debug(`Polled status for ${nzb || hash}`, {
            attempt: i + 1,
            status: usenetDownloadInList.status,
          });
          if (usenetDownloadInList.status === 'downloaded') {
            usenetDownload = usenetDownloadInList;
            break;
          }
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

    let fileId: number | undefined;
    if (playbackInfo.fileIndex !== undefined) {
      // Direct file index specified (e.g. from catalog meta)
      fileId = playbackInfo.fileIndex;
      logger.debug(`Using specified fileIndex`, { fileId });
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
      allStrings.push(...usenetDownload.files.map((file) => file.name ?? ''));

      const parseResults: ParsedResult[] = allStrings.map((string) =>
        parseTorrentTitle(string)
      );
      const parsedFiles = new Map<string, ParsedResult>();
      for (const [index, result] of parseResults.entries()) {
        parsedFiles.set(allStrings[index], result);
      }

      const file = await selectFileInTorrentOrNZB(
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
        chosenIndex: file.id,
        availableFiles: `[${usenetDownload.files.map((file) => file.name).join(', ')}]`,
      });

      fileId = file.id;
    }

    const playbackLink = await this.generateUsenetLink(
      usenetDownload.id.toString(),
      fileId?.toString(),
      this.config.clientIp
    );

    await TorboxDebridService.playbackLinkCache.set(
      cacheKey,
      playbackLink,
      Env.BUILTIN_DEBRID_INSTANT_AVAILABILITY_CACHE_TTL,
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
