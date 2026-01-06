import { TorboxApi } from '@torbox/torbox-api';
import { StremThruError } from 'stremthru';
import {
  Env,
  ServiceId,
  createLogger,
  getSimpleTextHash,
  Cache,
  DistributedLock,
} from '../utils/index.js';
import { selectFileInTorrentOrNZB } from './utils.js';
import {
  DebridService,
  DebridServiceConfig,
  DebridDownload,
  PlaybackInfo,
  DebridError,
} from './base.js';
import { StremThruInterface } from './stremthru.js';
import { ParsedResult, parseTorrentTitle } from '@viren070/parse-torrent-title';

const logger = createLogger('debrid:torbox');

export class TorboxDebridService implements DebridService {
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
  readonly supportsUsenet = true;
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
      logger.warn(
        `Failed to remove usenet download ${nzbId} from Torbox: ${error.message}`
      );
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

  public async checkMagnets(magnets: string[], sid?: string) {
    return this.stremthru.checkMagnets(magnets, sid);
  }

  public async addMagnet(magnet: string): Promise<DebridDownload> {
    return this.stremthru.addMagnet(magnet);
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
      const BATCH_SIZE = 100;

      const batches: string[][] = [];
      for (let i = 0; i < hashesToCheck.length; i += BATCH_SIZE) {
        batches.push(hashesToCheck.slice(i, i + BATCH_SIZE));
      }

      const batchResults = await Promise.all(
        batches.map(async (batch) => {
          const result =
            await this.torboxApi.usenet.getUsenetCachedAvailability(
              this.apiVersion,
              {
                hash: batch.join(','),
                format: 'list',
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
          return result.data.data;
        })
      );

      const allItems = batchResults.flat();

      newResults = allItems.map((item) => ({
        id: -1,
        hash: item.hash,
        status: 'cached',
        size: item.size,
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

      return [...cachedResults, ...newResults];
    }

    return cachedResults;
  }

  public async addNzb(nzb: string, name: string): Promise<DebridDownload> {
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
    const usenetDownload = await this.listNzbz(
      res.data.data.usenetdownloadId.toString()
    );
    if (Array.isArray(usenetDownload)) {
      return usenetDownload[0];
    }
    return usenetDownload;
  }

  public async listNzbz(id?: string): Promise<DebridDownload[]> {
    const nzbInfo = await this.torboxApi.usenet.getUsenetList(this.apiVersion, {
      id,
    });

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

    let usenetDownloads: DebridDownload[] = (
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
        files: (usenetDownload.files ?? []).map((file) => ({
          id: file.id ?? -1,
          mimeType: file.mimetype,
          name: file.shortName ?? file.name ?? '',
          size: file.size ?? 0,
        })),
      };
    });

    return usenetDownloads;
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
        ttl: 10000,
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

    logger.debug(`Adding usenet download for ${nzb}`, {
      hash,
    });

    let usenetDownload = await this.addNzb(nzb, filename);

    logger.debug(`Usenet download added for ${nzb}`, {
      status: usenetDownload.status,
      id: usenetDownload.id,
    });

    if (usenetDownload.status !== 'downloaded') {
      // temporarily cache the null value for 1m
      TorboxDebridService.playbackLinkCache.set(cacheKey, null, 60);
      if (!cacheAndPlay) {
        return undefined;
      }
      // poll status when cacheAndPlay is true, max wait time is 110s
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 11000));
        const usenetList = await this.listNzbz(usenetDownload.id.toString());
        const usenetDownloadInList = usenetList.find(
          (usenet) => usenet.hash === hash || usenet.id === usenetDownload.id
        );
        if (!usenetDownloadInList) {
          logger.warn(`Failed to find ${nzb} in list`);
        } else {
          logger.debug(`Polled status for ${nzb}`, {
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
    if (usenetDownload.files.length > 1) {
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

    if (autoRemoveDownloads && usenetDownload.id) {
      this.removeNzb(usenetDownload.id.toString()).catch((err) => {
        logger.warn(
          `Failed to cleanup usenet download ${usenetDownload.id} after resolve: ${err.message}`
        );
      });
    }

    return playbackLink;
  }
}
