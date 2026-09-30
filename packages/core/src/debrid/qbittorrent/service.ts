import { open } from 'fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
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
  FILE_PRIORITY,
  isOwnTorrent,
  QBittorrentClient,
  QbittorrentCredential,
  QbittorrentTorrent,
  parseQbittorrentCredential,
} from './client.js';
import {
  STREAM_THRESHOLD_BYTES,
  applyPathMappings,
  computeFileAvailability,
  deriveFilePath,
  openRegularFile,
  planFilePriorities,
  resolveAllowedPath,
} from './availability.js';
import {
  STREAM_REF_TTL_SECONDS,
  encodeQbittorrentStreamToken,
  liveFileIndices,
  markFileLive,
  registerStreamRef,
} from './tokens.js';

const logger = createLogger('debrid:qbittorrent');

const FAILED_STATES = new Set(['error', 'missingFiles']);
/** Paused/stopped across both qBittorrent generations (4.x paused*, 5.x stopped*). */
const STOPPED_STATES = new Set([
  'pausedDL',
  'pausedUP',
  'stoppedDL',
  'stoppedUP',
]);
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
        try {
          const files = await this.client.getFiles(hash);
          download.files = files.map((file) => ({
            id: file.index,
            name: file.name,
            size: file.size,
            index: file.index,
          }));
        } catch (error) {
          logger.debug(
            { hash, err: error },
            'could not list files for checkMagnets entry'
          );
        }
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

    const hash = playbackInfo.hash.toLowerCase();
    // One wall-clock budget shared by both wait loops.
    const deadline = Date.now() + this.options.maxWaitTime;

    await DebridFailureCache.check(this.serviceName, 'torrent', hash);

    let torrent =
      (playbackInfo.serviceItemId
        ? await this.client.getTorrent(playbackInfo.serviceItemId.toLowerCase())
        : undefined) ?? (await this.client.getTorrent(hash));

    if (!torrent) {
      const addTorrent = async (url: string) => {
        try {
          await this.client.addTorrentUrl(url);
        } catch (error) {
          // 4.x answers a duplicate add with 200 "Fails."
          if (
            error instanceof DebridError &&
            error.code === 'STORE_MAGNET_INVALID' &&
            (await this.client.getTorrent(hash, signal))
          ) {
            return;
          }
          throw error;
        }
      };
      if (
        playbackInfo.private !== undefined &&
        playbackInfo.downloadUrl &&
        appConfig.builtins.debrid.useTorrentDownloadUrl
      ) {
        logger.debug(
          `Adding torrent from ${makeUrlLogSafe(playbackInfo.downloadUrl)}`
        );
        await addTorrent(playbackInfo.downloadUrl);
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
        await addTorrent(magnet);
      }

      if (!cacheAndPlay) return undefined;
      torrent = await this.waitForTorrent(hash, signal, deadline);
    }


    const readiness = await this.waitForReadable(
      torrent,
      playbackInfo,
      cacheAndPlay,
      signal,
      deadline
    );
    if (!readiness) return undefined;
    const { file, filePath } = readiness;

    const token = encodeQbittorrentStreamToken({
      ref: await registerStreamRef({
        credential: this.credential,
        hash: torrent.hash,
        fileIndex: file.index,
        filePath,
        fileSize: file.size,
        filename: filename || file.name,
        addedAt: torrent.added_on,
      }),
      exp: Math.floor(Date.now() / 1000) + STREAM_REF_TTL_SECONDS,
    });

    return `${appConfig.bootstrap.baseUrl}/api/v1/qbittorrent/stream/${token}/${encodeURIComponent(
      filename || file.name
    )}`;
  }

  private async waitForTorrent(
    hash: string,
    signal: AbortSignal | undefined,
    deadline: number
  ): Promise<QbittorrentTorrent> {
    while (Date.now() < deadline) {
      this.throwIfAborted(signal);
      const torrent = await this.client.getTorrent(hash, signal);
      if (torrent) return torrent;
      await sleep(this.options.pollInterval, undefined, { signal }).catch(
        () => {}
      );
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
    signal: AbortSignal | undefined,
    deadline: number
  ): Promise<
    | {
        file: { index: number; name: string; size: number };
        filePath: string;
      }
    | undefined
  > {
    let dataReadyButNotOnDisk = 0;
    let priorityFailures = 0;
    let prioritiesAbandoned = false;
    let resumeAttempted = false;
    let torrentMisses = 0;
    let lastState = torrent.state;
    let attempt = 0;
    while (Date.now() < deadline) {
      this.throwIfAborted(signal);
      attempt++;

      const fetched = await this.client.getTorrent(torrent.hash, signal);
      if (!fetched) {
        // When the torrent vanishes mid-resolve, fail fast after 3 misses.
        torrentMisses++;
        if (torrentMisses >= 3) {
          throw new DebridError(
            'The torrent was removed from qBittorrent while waiting for it',
            {
              statusCode: 404,
              statusText: 'Not Found',
              code: 'NOT_FOUND',
              type: 'api_error',
              headers: {},
            }
          );
        }
      } else {
        torrentMisses = 0;
      }
      const current = fetched ?? torrent;
      lastState = current.state;
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
        // Resume our own stopped torrents, adopted ones stay as the user left them.
        if (
          !resumeAttempted &&
          isOwnTorrent(current) &&
          STOPPED_STATES.has(current.state) &&
          (files.find((f) => f.index === file.index)?.progress ?? 0) < 1
        ) {
          resumeAttempted = true;
          const started = await this.client.startTorrent(current.hash, signal);
          if (!started) {
            logger.warn(
              { hash: current.hash, state: current.state },
              'could not resume stopped torrent for playback'
            );
          }
        }
        // Protect against concurrent skips mid-play.
        markFileLive(this.credential, torrent.hash, file.index);
        if (!prioritiesAbandoned) {
          const applied = await this.applyFilePriorities(
            current,
            files,
            file.index,
            signal
          );
          if (!applied) {
            priorityFailures++;
            if (priorityFailures >= 3) {
              prioritiesAbandoned = true;

              const stillSkipped =
                files.find((f) => f.index === file.index)?.priority ===
                FILE_PRIORITY.skip;
              if (stillSkipped) {
                throw new DebridError(
                  'qBittorrent refused to raise the skipped file selected for playback',
                  {
                    statusCode: 502,
                    statusText: 'Bad Gateway',
                    code: 'BAD_GATEWAY',
                    type: 'upstream_error',
                    headers: {},
                  }
                );
              }
              logger.warn(
                { hash: torrent.hash, fileIndex: file.index },
                'giving up on file priority adjustments for this resolve'
              );
            }
          }
        }
        const derived = deriveFilePath(current, files, file.index);
        const filePath = derived
          ? applyPathMappings(derived, this.credential.pathMappings)
          : undefined;
        if (filePath) {
          const allowed = await resolveAllowedPath(filePath);
          if (allowed === 'outside') {
            throw new DebridError(
              'qBittorrent reported a file path outside the configured download roots',
              {
                statusCode: 403,
                statusText: 'Forbidden',
                code: 'FORBIDDEN',
                type: 'api_error',
                headers: {},
              }
            );
          }
          if (allowed === 'invalid') {
            throw new DebridError(
              'qBittorrent reported a file path that is not a regular file',
              {
                statusCode: 403,
                statusText: 'Forbidden',
                code: 'FORBIDDEN',
                type: 'api_error',
                headers: {},
              }
            );
          }
          // Just pre-allocation lag, nothing flushed yet.
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
            availability.contiguousFrom(0) >= threshold;
          // Piece states flip before flush, verify bytes are readable.
          const flushed = await this.hasFlushedHead(filePath, file.size);
          if (dataReady && flushed) {
            return { file, filePath };
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
          logger.debug(
            {
              hash: torrent.hash,
              contiguous: availability.contiguousFrom(0),
              threshold,
              flushed,
              attempt,
            },
            'qBittorrent file not yet readable'
          );
        }
      }

      if (!cacheAndPlay) return undefined;
      await sleep(this.options.pollInterval, undefined, { signal }).catch(
        () => {}
      );
    }

    if (STOPPED_STATES.has(lastState) && !isOwnTorrent(torrent)) {
      throw new DebridError(
        'The torrent is paused in your qBittorrent client; resume it to play it through AIOStreams',
        {
          statusCode: 408,
          statusText: 'Request Timeout',
          code: 'TIMEOUT',
          type: 'api_error',
          headers: {},
        }
      );
    }
    throw new DebridError(
      `Timed out waiting for the download to become playable (qBittorrent last reported "${lastState}")`,
      {
        statusCode: 408,
        statusText: 'Request Timeout',
        code: 'TIMEOUT',
        type: 'api_error',
        headers: {},
      }
    );
  }

  /**
   * Apply the file-priority plan. Only files whose current
   * priority differs are sent, so transient failures retry on the next poll.
   */
  private async applyFilePriorities(
    torrent: QbittorrentTorrent,
    files: Awaited<ReturnType<QBittorrentClient['getFiles']>>,
    selectedIndex: number,
    signal?: AbortSignal
  ): Promise<boolean> {
    const plan = planFilePriorities({
      files,
      selectedIndex,
      skipOthers: this.credential.skipOtherFiles === true,
      ownTorrent: isOwnTorrent(torrent),
      liveFiles: liveFileIndices(this.credential, torrent.hash),
    });
    const currentPriority = new Map(
      files.map((file) => [file.index, file.priority])
    );
    const targets: { ids: number[]; priority: number }[] = [];
    const skip = plan.skip.filter(
      (index) => currentPriority.get(index) !== FILE_PRIORITY.skip
    );
    if (skip.length > 0) targets.push({ ids: skip, priority: FILE_PRIORITY.skip });
    const raise = plan.raise.filter(
      (index) => currentPriority.get(index) !== FILE_PRIORITY.max
    );
    if (raise.length > 0) targets.push({ ids: raise, priority: FILE_PRIORITY.max });
    const restore = plan.restore.filter(
      (index) => currentPriority.get(index) === FILE_PRIORITY.skip
    );
    if (restore.length > 0)
      targets.push({ ids: restore, priority: FILE_PRIORITY.normal });
    const results = await Promise.all(
      targets.map((target) =>
        this.client.setFilePriority(
          torrent.hash,
          target.ids,
          target.priority,
          signal
        )
      )
    );
    return results.every((ok) => ok);
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
    // Non-blocking regular-file opens only: a reported path that resolves
    // to a fifo or device node must not park a threadpool thread. qBittorrent's
    // "Append .!qB to incomplete files" keeps the suffixed name on disk until
    // the file completes.
    let handle =
      (await openRegularFile(filePath)) ??
      (await openRegularFile(filePath + '.!qB'));
    if (!handle) return false;
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
