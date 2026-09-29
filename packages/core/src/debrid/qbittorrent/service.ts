import { open } from 'fs/promises';
import {
  DebridDownload,
  DebridError,
  DebridFailureCache,
  DebridServiceConfig,
  PlaybackInfo,
  TorrentDebridService,
  TorrentInfo,
} from '../base.js';
import {
  Torrent,
  parseFileNames,
  selectFileInTorrentOrNZB,
  selectableFileNames,
} from '../utils.js';
import {
  appConfig,
  ServiceId,
  constants,
  createLogger,
  makeUrlLogSafe,
} from '../../utils/index.js';
import {
  QBittorrentClient,
  QbittorrentCredential,
  QbittorrentTorrent,
  parseQbittorrentCredential,
} from './client.js';
import { STREAM_THRESHOLD_BYTES, computeFileAvailability } from './availability.js';
import {
  CREDENTIAL_REF_TTL_SECONDS,
  encodeQbittorrentStreamToken,
  registerCredentialRef,
} from './tokens.js';

const logger = createLogger('debrid:qbittorrent');

const FAILED_STATES = new Set(['error', 'missingFiles']);
const SEEDED_STATES = new Set([
  'uploading',
  'pausedUP',
  'stoppedUP',
  'queuedUP',
  'stalledUP',
  'forcedUP',
  'checkingUP',
]);

const MAGNET_HASH = /urn:btih:([a-f0-9]{40})/i;

function hashFromMagnet(magnet: string): string | undefined {
  return MAGNET_HASH.exec(magnet)?.[1]?.toLowerCase();
}

function downloadStatus(torrent: QbittorrentTorrent): DebridDownload['status'] {
  if (FAILED_STATES.has(torrent.state)) return 'failed';
  if (SEEDED_STATES.has(torrent.state) || torrent.progress >= 1) return 'downloaded';
  return 'downloading';
}

/** Resolves torrents through the user's own qBittorrent client. */
export class QBittorrentService implements TorrentDebridService {
  readonly serviceName: ServiceId = constants.QBITTORRENT_SERVICE;
  readonly capabilities = { torrents: true, usenet: false } as const;

  private readonly credential: QbittorrentCredential;
  private readonly client: QBittorrentClient;

  constructor(
    config: DebridServiceConfig,
    private readonly options: { pollInterval: number; maxWaitTime: number }
  ) {
    this.credential = parseQbittorrentCredential(config.token);
    this.client = new QBittorrentClient(this.credential);
  }

  async checkMagnets(
    magnets: string[],
    _sid?: string,
    _checkOwned?: boolean
  ): Promise<DebridDownload[]> {
    const hashes = magnets
      .map((magnet) => hashFromMagnet(magnet))
      .filter((hash): hash is string => hash !== undefined);
    const torrents = await this.client.getTorrents(hashes);
    const byHash = new Map(torrents.map((torrent) => [torrent.hash, torrent]));

    const result: DebridDownload[] = [];
    const foundWithFiles: { download: DebridDownload; hash: string }[] = [];
    for (const magnet of magnets) {
      const hash = hashFromMagnet(magnet);
      const torrent = hash ? byHash.get(hash) : undefined;
      if (!torrent) {
        result.push({ id: magnet, hash, status: 'unknown', library: false });
        continue;
      }
      const failed = FAILED_STATES.has(torrent.state);
      const complete =
        SEEDED_STATES.has(torrent.state) || torrent.progress >= 1;
      const download: DebridDownload = {
        id: torrent.hash,
        hash: torrent.hash,
        name: torrent.name,
        size: torrent.size,
        addedAt: new Date(torrent.added_on * 1000).toISOString(),

        status: failed ? 'failed' : complete ? 'cached' : 'downloading',
        library: true,
      };
      result.push(download);
      if (!failed && foundWithFiles.length < 25) {
        foundWithFiles.push({ download, hash: torrent.hash });
      }
    }

    // File lists for pre-selection, capped and failure-tolerant.
    await Promise.all(
      foundWithFiles.map(async ({ download, hash }) => {
        const files = await this.client.getFiles(hash);
        download.files = files.map((file) => ({
          id: file.index,
          name: file.name,
          size: file.size,
          index: file.index,
        }));
      })
    );
    return result;
  }

  async listMagnets(): Promise<DebridDownload[]> {
    const torrents = await this.client.getTaggedTorrents();
    return torrents.map((torrent) => ({
      id: torrent.hash,
      hash: torrent.hash,
      name: torrent.name,
      size: torrent.size,
      addedAt: new Date(torrent.added_on * 1000).toISOString(),
      status: downloadStatus(torrent),
      library: true,
    }));
  }

  async addMagnet(magnet: string): Promise<DebridDownload> {
    const hash = hashFromMagnet(magnet);
    await this.client.addTorrentUrl(magnet);
    return { id: hash ?? magnet, hash, status: 'downloading' };
  }

  async addTorrent(torrent: string): Promise<DebridDownload> {
    // A .torrent URL's infohash is only known once qBittorrent has fetched
    // it, resolve re-discovers the torrent by hash on its next poll.
    await this.client.addTorrentUrl(torrent);
    return { id: torrent, status: 'downloading' };
  }

  async getMagnet(magnetId: string): Promise<DebridDownload> {
    const torrent = await this.client.getTorrent(magnetId);
    if (!torrent) {
      throw new DebridError(`No qBittorrent torrent with hash ${magnetId}`, {
        statusCode: 404,
        statusText: 'Not Found',
        code: 'NOT_FOUND',
        type: 'api_error',
        headers: {},
      });
    }
    const files = await this.client.getFiles(magnetId);
    return {
      id: torrent.hash,
      hash: torrent.hash,
      name: torrent.name,
      size: torrent.size,
      addedAt: new Date(torrent.added_on * 1000).toISOString(),
      status: downloadStatus(torrent),
      library: true,
      files: files.map((file) => ({
        id: file.index,
        name: file.name,
        size: file.size,
        index: file.index,
      })),
    };
  }

  async generateTorrentLink(link: string): Promise<string> {
    // Links minted by resolve are already this instance's byte URLs, there is
    // nothing to regenerate.
    return link;
  }

  async removeMagnet(): Promise<void> {
    // Never remove, the torrent must keep seeding.
    logger.debug(
      'removeMagnet ignored: qBittorrent torrents keep seeding by design'
    );
  }

  async refreshLibraryCache(): Promise<void> {}

  async resolve(
    playbackInfo: PlaybackInfo,
    filename: string,
    cacheAndPlay: boolean,
    autoRemoveDownloads?: boolean,
    signal?: AbortSignal
  ): Promise<string | undefined> {
    if (playbackInfo.type !== 'torrent') {
      throw new DebridError('qBittorrent can only resolve torrents', {
        statusCode: 400,
        statusText: 'Bad Request',
        code: 'BAD_REQUEST',
        type: 'api_error',
        headers: {},
      });
    }
    if (autoRemoveDownloads) {
      logger.debug(
        'autoRemoveDownloads is ignored for qbittorrent; torrents keep seeding'
      );
    }
    return this.resolveTorrent(
      playbackInfo,
      filename,
      cacheAndPlay,
      signal
    );
  }

  private async resolveTorrent(
    playbackInfo: PlaybackInfo & { type: 'torrent' },
    filename: string,
    cacheAndPlay: boolean,
    signal?: AbortSignal
  ): Promise<string | undefined> {
    const { hash, metadata } = playbackInfo;

    await DebridFailureCache.check(this.serviceName, 'torrent', hash);

    let torrent =
      (playbackInfo.serviceItemId
        ? await this.client.getTorrent(playbackInfo.serviceItemId)
        : undefined) ?? (await this.client.getTorrent(hash));

    if (!torrent) {
      if (
        playbackInfo.private !== undefined &&
        playbackInfo.downloadUrl &&
        appConfig.builtins.debrid.useTorrentDownloadUrl
      ) {
        logger.debug(
          `Adding torrent from ${makeUrlLogSafe(playbackInfo.downloadUrl)}`
        );
        await this.client.addTorrentUrl(playbackInfo.downloadUrl);
      } else {
        let magnet = `magnet:?xt=urn:btih:${hash}`;
        if (playbackInfo.filename) {
          magnet += `&dn=${encodeURIComponent(playbackInfo.filename)}`;
        }
        if (playbackInfo.sources.length > 0) {
          magnet += `&tr=${playbackInfo.sources
            .map((source) => encodeURIComponent(source))
            .join('&tr=')}`;
        }
        await this.client.addTorrentUrl(magnet);
      }
      torrent = await this.waitForTorrent(hash, signal);
    }


    const readiness = await this.waitForReadable(
      torrent,
      playbackInfo,
      cacheAndPlay,
      signal
    );
    if (!readiness) return undefined;
    const { file, filePath } = readiness;

    const token = encodeQbittorrentStreamToken({
      credentialRef: await registerCredentialRef(this.credential),
      exp: Math.floor(Date.now() / 1000) + CREDENTIAL_REF_TTL_SECONDS,
      hash,
      fileIndex: file.index,
      filePath,
      fileSize: file.size,
      filename: filename || file.name,
      addedAt: torrent.added_on,
    });

    return `${appConfig.bootstrap.baseUrl}/api/v1/qbittorrent/stream/${token}/${encodeURIComponent(
      filename || file.name
    )}`;
  }

  private async waitForTorrent(
    hash: string,
    signal?: AbortSignal
  ): Promise<QbittorrentTorrent> {
    const maxPolls = Math.max(1, Math.ceil(this.options.maxWaitTime / this.options.pollInterval));
    for (let i = 0; i < maxPolls; i++) {
      this.throwIfAborted(signal);
      const torrent = await this.client.getTorrent(hash, signal);
      if (torrent) return torrent;
      await new Promise((resolve) => setTimeout(resolve, this.options.pollInterval));
    }
    throw new DebridError('Timed out waiting for qBittorrent to accept the torrent', {
      statusCode: 408,
      statusText: 'Request Timeout',
      code: 'TIMEOUT',
      type: 'api_error',
      headers: {},
    });
  }

  /** Wait until the selected file has a playable prefix. */
  private async waitForReadable(
    torrent: QbittorrentTorrent,
    playbackInfo: PlaybackInfo & TorrentInfo,
    cacheAndPlay: boolean,
    signal?: AbortSignal
  ): Promise<
    | {
        files: Awaited<ReturnType<QBittorrentClient['getFiles']>>;
        file: { index: number; name: string; size: number };
        filePath: string;
      }
    | undefined
  > {
    const maxPolls = Math.max(1, Math.ceil(this.options.maxWaitTime / this.options.pollInterval));
    let dataReadyButNotOnDisk = 0;
    for (let i = 0; i < maxPolls; i++) {
      this.throwIfAborted(signal);

      const current = (await this.client.getTorrent(torrent.hash, signal)) ?? torrent;
      if (FAILED_STATES.has(current.state)) {
        const err = new DebridError(`qBittorrent torrent is ${current.state}`, {
          statusCode: 400,
          statusText: `Torrent ${current.state}`,
          code: 'DOWNLOAD_FAILED',
          type: 'api_error',
          headers: {},
          body: current,
        });
        await DebridFailureCache.mark(this.serviceName, 'torrent', torrent.hash, err).catch(
          () => {}
        );
        throw err;
      }

      const files = await this.client.getFiles(torrent.hash, signal);
      const file = await this.selectFile(current, files, playbackInfo);
      if (file) {
        const torrentRoot = current.content_path.endsWith('/')
          ? current.content_path
          : current.content_path + '/';
        const filePath =
          files.length === 1
            ? current.content_path
            : torrentRoot + file.name;
        const pieceSize = await this.client.getPieceSize(torrent.hash, signal);
        const pieceStates = await this.client.getPieceStates(torrent.hash, signal);
        const availability = computeFileAvailability({
          files,
          fileIndex: file.index,
          pieceStates,
          pieceSize,
        });
        const threshold = Math.min(file.size, STREAM_THRESHOLD_BYTES);
        const dataReady =
          availability.complete ||
          availability.contiguousFrom(0) >= threshold ||
          downloadStatus(current) === 'downloaded';
          // Piece states flip before flush, verify bytes are readable.
        const flushed = await this.hasFlushedHead(filePath, file.size);
        if (dataReady && flushed) {
          return { files, file, filePath };
        }
        if (dataReady && !flushed) {

          dataReadyButNotOnDisk++;
          if (dataReadyButNotOnDisk >= 5) {
            throw new DebridError(
              'qBittorrent download directory is not reachable from AIOStreams; both must run on the same machine (or share the directory through a mount)',
              {
                statusCode: 503,
                statusText: 'Service Unavailable',
                code: 'SERVICE_UNAVAILABLE',
                type: 'api_error',
                headers: {},
              }
            );
          }
        } else {
          dataReadyButNotOnDisk = 0;
        }
        logger.debug('qBittorrent file not yet readable', {
          hash: torrent.hash,
          contiguous: availability.contiguousFrom(0),
          threshold,
          flushed,
          attempt: i + 1,
        });
      }

      if (!cacheAndPlay) return undefined;
      await new Promise((resolve) => setTimeout(resolve, this.options.pollInterval));
    }

    throw new DebridError('Timed out waiting for the download to become playable', {
      statusCode: 408,
      statusText: 'Request Timeout',
      code: 'TIMEOUT',
      type: 'api_error',
      headers: {},
    });
  }

  private async selectFile(
    torrent: QbittorrentTorrent,
    files: Awaited<ReturnType<QBittorrentClient['getFiles']>>,
    playbackInfo: PlaybackInfo & TorrentInfo
  ): Promise<{ index: number; name: string; size: number } | undefined> {
    if (playbackInfo.fileIndex !== undefined) {
      return files.find((file) => file.index === playbackInfo.fileIndex);
    }
    if (files.length === 0) return undefined;
    const torrentForSelection: Torrent = {
      title: torrent.name || playbackInfo.title || '',
      type: 'torrent',
      hash: torrent.hash,
      size: torrent.size,
      sources: playbackInfo.sources,
      private: playbackInfo.private,
    };
    const debridDownload: DebridDownload = {
      id: torrent.hash,
      hash: torrent.hash,
      name: torrent.name,
      size: torrent.size,
      status: 'downloading',
      files: files.map((file) => ({
        id: file.index,
        name: file.name,
        size: file.size,
        index: file.index,
      })),
    };
    const parsedFiles = await parseFileNames(
      selectableFileNames(torrent.name ?? '', debridDownload.files ?? [])
    );
    const selected = await selectFileInTorrentOrNZB(
      torrentForSelection,
      debridDownload,
      parsedFiles,
      playbackInfo.metadata,
      {
        chosenFilename: playbackInfo.filename,
        chosenIndex: playbackInfo.index,
      }
    );
    if (selected?.index === undefined) return undefined;
    return files.find((file) => file.index === selected.index);
  }

  /**
   * Whether the file's head is readable and non-zero, proof the pieces
   * were flushed (a container header is never all zeros).
   */
  private async hasFlushedHead(
    filePath: string,
    fileSize: number
  ): Promise<boolean> {
    if (fileSize === 0) return true;
    const length = Math.min(64 * 1024, fileSize);
    let handle;
    try {
      handle = await open(filePath, 'r');
    } catch {
      return false;
    }
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return buffer.subarray(0, bytesRead).some((byte) => byte !== 0);
    } catch {
      return false;
    } finally {
      await handle.close().catch(() => {});
    }
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DebridError('resolve aborted (failover lost)', {
        statusCode: 499,
        statusText: 'Client Closed Request',
        code: 'UNKNOWN',
        headers: {},
        body: null,
      });
    }
  }
}
