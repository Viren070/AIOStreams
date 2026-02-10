import { StremThru, StremThruError } from 'stremthru';
import {
  Env,
  ServiceId,
  createLogger,
  getSimpleTextHash,
  Cache,
  DistributedLock,
} from '../utils/index.js';
import { selectFileInTorrentOrNZB, Torrent } from './utils.js';
import {
  DebridService,
  DebridServiceConfig,
  DebridDownload,
  PlaybackInfo,
  DebridError,
} from './base.js';
import { StremThruServiceId } from '../presets/stremthru.js';
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

export class StremThruInterface implements DebridService {
  private readonly stremthru: StremThru;
  private static playbackLinkCache = Cache.getInstance<string, string | null>(
    'st:link'
  );
  private static checkCache = Cache.getInstance<string, DebridDownload>(
    'st:instant-check'
  );
  // Maps placeholder hashes (SHA-1 of downloadUrl) to real info hashes returned
  // by StremThru after addTorrent. This mapping is permanent — a download URL
  // always corresponds to the same info hash. Actual availability (is the
  // torrent still in qBit?) is checked live via checkMagnets on each browse.
  // Persists via Redis or SQL so mappings survive restarts.
  private static hashMapping = Cache.getInstance<string, string>(
    'st:hash-map',
    5000,
    Env.REDIS_URI ? undefined : 'sql'
  );

  readonly supportsUsenet = false;
  readonly serviceName: ServiceId;

  constructor(
    private readonly config: DebridServiceConfig & {
      serviceName: StremThruServiceId;
    }
  ) {
    this.serviceName = config.serviceName;
    this.stremthru = new StremThru({
      baseUrl: Env.BUILTIN_STREMTHRU_URL,
      userAgent: Env.DEFAULT_USER_AGENT,
      auth: {
        store: config.serviceName,
        token: config.token,
      },
      clientIp: config.clientIp,
      timeout: 10000,
    });
  }

  public async listMagnets(): Promise<DebridDownload[]> {
    const result = await this.stremthru.store.listMagnets({});
    return result.data.items;
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
    sid?: string
  ): Promise<DebridDownload[]> {
    const cachedResults: DebridDownload[] = [];
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
      let newResults: DebridDownload[] = [];
      const BATCH_SIZE = 500;
      // Split magnetsToCheck into batches of 500
      const batches: string[][] = [];
      for (let i = 0; i < magnetsToCheck.length; i += BATCH_SIZE) {
        batches.push(magnetsToCheck.slice(i, i + BATCH_SIZE));
      }

      try {
        // Perform all batch requests in parallel
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
      return [...cachedResults, ...newResults];
    }
    return cachedResults;
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

  public async resolve(
    playbackInfo: PlaybackInfo,
    filename: string,
    cacheAndPlay: boolean,
    autoRemoveDownloads?: boolean
  ): Promise<string | undefined> {
    const { result } = await DistributedLock.getInstance().withLock(
      `stremthru:resolve:${playbackInfo.hash}:${playbackInfo.metadata?.season}:${playbackInfo.metadata?.episode}:${playbackInfo.metadata?.absoluteEpisode}:${filename}:${cacheAndPlay}:${autoRemoveDownloads}:${this.config.clientIp}:${this.config.serviceName}:${this.config.token}`,
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

  private async checkCacheGet(
    hash: string
  ): Promise<DebridDownload | undefined> {
    return await StremThruInterface.checkCache.get(
      `${this.serviceName}:${getSimpleTextHash(hash)}`
    );
  }

  private checkCacheDelete(hash: string): void {
    StremThruInterface.checkCache
      .delete(`${this.serviceName}:${getSimpleTextHash(hash)}`)
      .catch(() => {});
  }

  private async checkCacheSet(debridDownload: DebridDownload): Promise<void> {
    try {
      await StremThruInterface.checkCache.set(
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

  /**
   * Resolve a placeholder hash to the real info hash if a mapping exists.
   * Used by the cache-checking pipeline to look up real hashes before
   * calling checkMagnets, so already-downloaded torrents show as cached.
   */
  public async resolveHash(hash: string): Promise<string> {
    return StremThruInterface._resolveHash(this.serviceName, hash);
  }

  private static async _resolveHash(
    serviceName: string,
    hash: string
  ): Promise<string> {
    try {
      const realHash = await StremThruInterface.hashMapping.get(
        `${serviceName}:${hash}`
      );
      if (realHash) {
        logger.debug(`Resolved placeholder hash ${hash} → ${realHash}`, {
          serviceName,
        });
      }
      return realHash ?? hash;
    } catch (e) {
      logger.warn(`Failed to look up hash mapping for ${hash}`, {
        serviceName,
        error: e,
      });
      return hash;
    }
  }

  private async _resolve(
    playbackInfo: PlaybackInfo,
    filename: string,
    cacheAndPlay: boolean,
    autoRemoveDownloads?: boolean
  ): Promise<string | undefined> {
    if (playbackInfo.type === 'usenet') {
      throw new DebridError('StremThru does not support usenet operations', {
        statusCode: 400,
        statusText: 'StremThru does not support usenet operations',
        code: 'NOT_IMPLEMENTED',
        headers: {},
        body: playbackInfo,
      });
    }

    let { hash, metadata } = playbackInfo;
    const cacheKey = `${this.serviceName}:${this.config.token}:${this.config.clientIp}:${playbackInfo.hash}:${playbackInfo.metadata?.season}:${playbackInfo.metadata?.episode}:${playbackInfo.metadata?.absoluteEpisode}`;
    const cachedLink = await StremThruInterface.playbackLinkCache.get(cacheKey);

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
    // Use addTorrent(downloadUrl) when we have privacy info from the indexer
    // (private !== undefined) OR when the hash is a placeholder generated from
    // the URL (placeholderHash) — in either case the magnet path may be missing
    // or unreliable, so we pass the .torrent download URL to StremThru directly.
    if (
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
          await StremThruInterface.hashMapping.set(
            `${this.serviceName}:${hash}`,
            realHash,
            3600 * 24 * 365,
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

    // Track whether we're attempting to stream a not-yet-downloaded torrent.
    // Some stores (qBittorrent, Torbox) return file links during download,
    // allowing streaming while downloading. If link generation fails for
    // stores that don't actually support it (e.g. Debrider), we fall back
    // to returning undefined (shows "downloading" page).
    let streamingWhileDownloading = false;

    if (magnetDownload.status !== 'downloaded') {
      // If cacheAndPlay is enabled and we already have files with links
      // (e.g. qBittorrent with sequential download), proceed immediately —
      // the file server can serve partially-downloaded files.
      const hasStreamableFiles = magnetDownload.files?.some((f) => f.link);
      if (cacheAndPlay && hasStreamableFiles) {
        logger.debug(
          `Attempting streaming-while-downloading for ${hash}`,
          { status: magnetDownload.status }
        );
        streamingWhileDownloading = true;
      } else {
        // temporarily cache the null value for 1m
        StremThruInterface.playbackLinkCache.set(cacheKey, null, 60).catch(
          (e) => logger.debug('Failed to cache null playback link', { error: e })
        );
        if (!cacheAndPlay) {
          return undefined;
        }
        // poll status when cacheAndPlay is true, max wait time is 110s
        const initialFiles = magnetDownload.files;
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
              // listMagnets doesn't return files, so preserve the original
              // file list from addMagnet/addTorrent
              magnetDownload = {
                ...magnetDownloadInList,
                files: magnetDownloadInList.files?.length
                  ? magnetDownloadInList.files
                  : initialFiles,
              };
              break;
            }
          }
        }
        if (magnetDownload.status !== 'downloaded') {
          return undefined;
        }
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

    const file = await selectFileInTorrentOrNZB(
      torrent,
      magnetDownload,
      parsedFiles,
      metadata,
      {
        chosenFilename: playbackInfo.filename,
        chosenIndex: playbackInfo.index,
        printReport: true,
      }
    );

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

    let playbackLink: string;
    try {
      playbackLink = await this.generateTorrentLink(
        file.link,
        this.config.clientIp
      );
    } catch (error: any) {
      // If we're streaming while downloading and link generation fails,
      // the store doesn't support partial file serving. Fall back to
      // showing the "downloading" page instead of an error.
      if (streamingWhileDownloading) {
        logger.debug(
          `Streaming-while-downloading link generation failed for ${hash}, falling back`,
          { error: error.message }
        );
        StremThruInterface.playbackLinkCache.set(cacheKey, null, 60).catch(
          (e) => logger.debug('Failed to cache null playback link', { error: e })
        );
        return undefined;
      }
      throw error;
    }
    await StremThruInterface.playbackLinkCache.set(
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
}
