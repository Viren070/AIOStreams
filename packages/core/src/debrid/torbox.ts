import { TorboxApi } from '@torbox/torbox-api';
import { StremThruError } from 'stremthru';
import { ParseResult } from 'go-ptt';
import {
  Env,
  ServiceId,
  createLogger,
  getSimpleTextHash,
  Cache,
} from '../utils/index.js';
import { PTT } from '../parser/index.js';
import { selectFileInTorrentOrNZB } from './utils.js';
import {
  DebridService,
  DebridServiceConfig,
  DebridDownload,
  PlaybackInfo,
  DebridError,
} from './base.js';
import { StremThruInterface } from './stremthru.js';

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

  public async checkMagnets(magnets: string[], sid?: string) {
    try {
      return this.stremthru.checkMagnets(magnets, sid);
    } catch (error) {
      if (error instanceof StremThruError) {
        throw new DebridError(error.message, {
          statusCode: error.statusCode,
          statusText: error.statusText,
          code: error.code,
          headers: error.headers,
          body: error.body,
          cause: 'cause' in error ? error.cause : undefined,
        });
      }
      throw error;
    }
  }

  public async addMagnet(magnet: string): Promise<DebridDownload> {
    try {
      return this.stremthru.addMagnet(magnet);
    } catch (error) {
      if (error instanceof StremThruError) {
        throw new DebridError(error.message, {
          statusCode: error.statusCode,
          statusText: error.statusText,
          code: error.code,
          headers: error.headers,
          body: error.body,
          cause: 'cause' in error ? error.cause : undefined,
        });
      }
      throw error;
    }
  }

  public async generateTorrentLink(
    link: string,
    clientIp?: string
  ): Promise<string> {
    try {
      return this.stremthru.generateTorrentLink(link, clientIp);
    } catch (error) {
      if (error instanceof StremThruError) {
        throw new DebridError(error.message, {
          statusCode: error.statusCode,
          statusText: error.statusText,
          code: error.code,
          headers: error.headers,
          body: error.body,
          cause: 'cause' in error ? error.cause : undefined,
        });
      }
      throw error;
    }
  }

  public async checkNzbs(hashes: string[]): Promise<DebridDownload[]> {
    const cachedResults: DebridDownload[] = [];
    const hashesToCheck: string[] = [];
    for (const hash of hashes) {
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

      for (const item of allItems) {
        const download: DebridDownload = {
          id: -1,
          hash: item.hash,
          status: 'cached',
          size: item.size,
        };

        // cachedResults.push(download);
        newResults.push(download);

        if (item.hash) {
          TorboxDebridService.instantAvailabilityCache.set(
            getSimpleTextHash(item.hash),
            download,
            Env.BUILTIN_DEBRID_INSTANT_AVAILABILITY_CACHE_TTL
          );
        }
      }

      return [...cachedResults, ...newResults];
    }

    return cachedResults;
    // const data = await this.torboxApi.usenet.getUsenetCachedAvailability(
    //   this.apiVersion,
    //   {
    //     hash: hashes.join(','),
    //     format: 'list',
    //   }
    // );
    // if (!data.data?.success) {
    //   throw new DebridError(`Failed to check instant availability`, {
    //     statusCode: data.metadata.status,
    //     statusText: data.metadata.statusText,
    //     code: 'UNKNOWN',
    //     headers: data.metadata.headers,
    //     body: data.data,
    //     cause: data.data,
    //     type: 'api_error',
    //   });
    // }
    // if (!Array.isArray(data.data.data)) {
    //   throw new DebridError(
    //     'Invalid response from Torbox API. Expected array, got object',
    //     {
    //       statusCode: data.metadata.status,
    //       statusText: data.metadata.statusText,
    //       code: 'UNKNOWN',
    //       headers: data.metadata.headers,
    //       body: data.data,
    //       cause: data.data,
    //       type: 'api_error',
    //     }
    //   );
    // }
    // return data.data.data.map((item) => ({
    //   id: -1,
    //   status: 'cached',
    //   name: item.name,
    //   size: item.size,
    // }));
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

    const nzbInfo = await this.torboxApi.usenet.getUsenetList(this.apiVersion, {
      id: res.data.data.usenetdownloadId.toString(),
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

    if (Array.isArray(nzbInfo.data.data)) {
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

    const usenetDownload = nzbInfo.data.data;
    let status: DebridDownload['status'] = 'queued';

    if (usenetDownload.downloadFinished && usenetDownload.downloadPresent) {
      status = 'downloaded';
    } else if (usenetDownload.progress && usenetDownload.progress > 0) {
      status = 'downloading';
    }

    return {
      id: usenetDownload.id ?? res.data.data.usenetdownloadId,
      hash: usenetDownload.hash ?? res.data.data.hash,
      name: usenetDownload.name ?? undefined,
      status,
      files: (usenetDownload.files ?? []).map((file) => ({
        id: file.id,
        mimeType: file.mimetype,
        name: file.shortName ?? file.name ?? '',
        size: file.size ?? 0,
      })),
    };
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
    filename: string
  ): Promise<string | undefined> {
    if (playbackInfo.type === 'torrent') {
      return this.stremthru.resolve(playbackInfo, filename);
    }

    const { nzb, file: chosenFile, metadata, title, hash } = playbackInfo;
    const cacheKey = `${this.serviceName}:${this.config.token}:${this.config.clientIp}:${JSON.stringify(playbackInfo)}`;
    const cachedLink =
      await TorboxDebridService.playbackLinkCache.get(cacheKey);

    if (cachedLink !== undefined) {
      logger.debug(`Using cached link for ${nzb}`);
      return cachedLink ?? undefined;
    }

    logger.debug(`Adding usenet download for ${nzb}`, {
      hash,
    });

    const usenetDownload = await this.addNzb(nzb, filename);

    logger.debug(`Usenet download added for ${nzb}`, {
      status: usenetDownload.status,
      id: usenetDownload.id,
    });

    if (usenetDownload.status !== 'downloaded') {
      // temporarily cache the null value for 1m
      TorboxDebridService.playbackLinkCache.set(cacheKey, null, 60);
      return undefined;
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
        title: title || usenetDownload.name,
        file: chosenFile,
        metadata: metadata,
        size: usenetDownload.size || 0,
      };
      const allStrings: string[] = [];
      allStrings.push(usenetDownload.name ?? '');
      allStrings.push(...usenetDownload.files.map((file) => file.name ?? ''));

      const parseResults = await PTT.parse(allStrings);
      const parsedFiles = new Map<string, ParseResult>();
      for (const [index, result] of parseResults.entries()) {
        if (result) {
          parsedFiles.set(allStrings[index], result);
        }
      }

      const file = await selectFileInTorrentOrNZB(
        nzbInfo,
        usenetDownload,
        parsedFiles,
        metadata,
        {
          chosenFilename: chosenFile?.name,
          chosenIndex: chosenFile?.index,
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
      Env.BUILTIN_DEBRID_INSTANT_AVAILABILITY_CACHE_TTL
    );

    return playbackLink;
  }
}
