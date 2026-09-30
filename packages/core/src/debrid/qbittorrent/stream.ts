import { open, stat, FileHandle } from 'fs/promises';
import { Readable } from 'stream';
import { DebridError } from '../base.js';
import type { ByteRangeRequest, OpenedByteStream } from '../../shares/types.js';
import { createLogger } from '../../utils/index.js';
import { FeatureControl } from '../../utils/feature.js';
import { QBITTORRENT_SERVICE } from '../../utils/constants.js';
import {
  FILE_PRIORITY,
  isOwnTorrent,
  credentialKey,
  QBittorrentClient,
  type QbittorrentFile,
} from './client.js';
import {
  applyPathMappings,
  computeFileAvailability,
  deriveFilePath,
  openRegularFile,
  PieceReadiness,
  resolveAllowedPath,
  type FileAvailability,
} from './availability.js';
import {
  QbittorrentStreamRefEntry,
  decodeQbittorrentStreamToken,
  markFileLive,
  resolveStreamRef,
} from './tokens.js';

const logger = createLogger('debrid:qbittorrent');

const SNAPSHOT_TTL_MS = 1_500;
const AVAILABILITY_POLL_MS = 2_000;
/** Destroy the stream (and with it the connection) after this long stalled. */
const STALL_TIMEOUT_MS = 60_000;
const READ_CHUNK_BYTES = 512 * 1024;
const MAX_SHARED_TORRENTS = 256;
/** How long a locator waits out a `moving` torrent before failing. */
const MOVE_WAIT_MS = 10_000;
const MOVE_RETRY_MS = 500;

interface Snapshot {
  at: number;
  pieceSize: number;
  availability: FileAvailability;
  /** Current priority of the streamed file (skip heeds it). */
  filePriority: number;
}

/** Raw per-torrent state shared across all concurrent streams of a torrent. */
interface RawTorrentState {
  at: number;
  files: QbittorrentFile[];
  pieceStates?: number[];
}

interface SharedRaw {
  value?: RawTorrentState;
  promise?: Promise<RawTorrentState>;
}

/** Shared per-torrent state, deduplicates polling across concurrent streams. */
const sharedTorrents = new Map<string, SharedRaw>();
const pieceReadiness = new Map<string, PieceReadiness>();
/** Piece size is immutable per torrent; fetched once per key. */
const pieceSizes = new Map<string, number>();

function torrentKey(entry: QbittorrentStreamRefEntry): string {
  return `${credentialKey(entry.credential)}:${entry.hash}`;
}

function getTorrentState(
  client: QBittorrentClient,
  entry: QbittorrentStreamRefEntry
): Promise<RawTorrentState> {
  const key = torrentKey(entry);
  const cached = sharedTorrents.get(key);
  if (cached?.value && Date.now() - cached.value.at < SNAPSHOT_TTL_MS) {
    return Promise.resolve(cached.value);
  }
  if (cached?.promise) return cached.promise;
  const promise = (async () => {
    // No consumer abort since this is shared across streams.
    const [files, pieceStates] = await Promise.all([
      client.getFiles(entry.hash),
      client.getPieceStates(entry.hash),
    ]);
    if (pieceStates) {
      let readiness = pieceReadiness.get(key);
      if (!readiness || readiness.pieceCount !== pieceStates.length) {
        readiness = new PieceReadiness(pieceStates.length);
        pieceReadiness.set(key, readiness);
      }
      readiness.observe(pieceStates);
    }
    const value: RawTorrentState = { at: Date.now(), files, pieceStates };
    sharedTorrents.set(key, { value });
    if (sharedTorrents.size > MAX_SHARED_TORRENTS) {
      const oldest = sharedTorrents.keys().next().value;
      if (oldest !== undefined) sharedTorrents.delete(oldest);
      if (pieceReadiness.size > MAX_SHARED_TORRENTS) {
        const oldestReadiness = pieceReadiness.keys().next().value;
        if (oldestReadiness !== undefined) pieceReadiness.delete(oldestReadiness);
      }
      if (pieceSizes.size > MAX_SHARED_TORRENTS) {
        const oldestSize = pieceSizes.keys().next().value;
        if (oldestSize !== undefined) pieceSizes.delete(oldestSize);
      }
    }
    return value;
  })();
  promise.catch(() => sharedTorrents.delete(key));
  sharedTorrents.set(key, { promise });
  return promise;
}

async function getSnapshot(
  client: QBittorrentClient,
  entry: QbittorrentStreamRefEntry
): Promise<Snapshot> {
  const key = torrentKey(entry);
  const { at, files, pieceStates } = await getTorrentState(client, entry);
  let pieceSize = pieceSizes.get(key);
  if (pieceSize === undefined) {
    pieceSize = await client.getPieceSize(entry.hash);
    pieceSizes.set(key, pieceSize);
  }
  const availability = computeFileAvailability({
    files,
    fileIndex: entry.fileIndex,
    pieceStates,
    pieceSize,
    isReadable: pieceReadiness.get(key)?.readable,
  });
  const filePriority =
    files.find((file) => file.index === entry.fileIndex)?.priority ?? 1;
  return { at, pieceSize, availability, filePriority };
}

async function openIfExists(path: string): Promise<string | undefined> {
  const handle = await openRegularFile(path);
  if (!handle) return undefined;
  await handle.close().catch(() => {});
  return path;
}

/** Opens a candidate only when it has reached the file's full size. */
async function openIfComplete(
  path: string,
  fileSize: number
): Promise<boolean> {
  const handle = await openRegularFile(path, { minSize: fileSize });
  if (!handle) return false;
  await handle.close().catch(() => {});
  return true;
}

function pathVariants(path: string): string[] {
  // qBittorrent's "Append .!qB to incomplete files" keeps the suffixed name
  // on disk until the file completes.
  return path.endsWith('.!qB') ? [path] : [path, path + '.!qB'];
}

/** Find the file on disk, following relocations and .!qB naming. */
async function locateEntryFile(
  client: QBittorrentClient,
  entry: QbittorrentStreamRefEntry,
  signal?: AbortSignal
): Promise<string | undefined> {
  const deadline = Date.now() + MOVE_WAIT_MS;
  for (;;) {
    for (const candidate of pathVariants(entry.filePath)) {
      const allowed = await resolveAllowedPath(candidate);
      if (allowed.status === 'invalid' || allowed.status === 'outside') {
        return undefined;
      }
      if (allowed.status === 'allowed' && (await openIfExists(allowed.realPath!))) {
        return allowed.realPath!;
      }
    }
    const torrent = await client.getTorrent(entry.hash, signal);
    const files = torrent
      ? await client.getFiles(entry.hash, signal)
      : [];
    const derived = torrent
      ? applyPathMappings(
          deriveFilePath(torrent, files, entry.fileIndex) ?? '',
          entry.credential.pathMappings
        ) || undefined
      : undefined;
    if (derived && derived !== entry.filePath) {
      // A complete file must have reached full size after a move.
      const fileComplete =
        (files.find((file) => file.index === entry.fileIndex)?.progress ?? 0) >= 1;
      for (const candidate of pathVariants(derived)) {
        const allowed = await resolveAllowedPath(candidate);
        if (allowed.status !== 'allowed') continue;
        const ok = fileComplete
          ? await openIfComplete(allowed.realPath!, entry.fileSize)
          : await openIfExists(allowed.realPath!);
        if (ok) return allowed.realPath!;
      }
    }
    if (torrent?.state !== 'moving' || Date.now() >= deadline) return undefined;
    await abortableDelay(MOVE_RETRY_MS, signal);
  }
}

/**
 * A Readable over a possibly still-downloading file, reads stop at the
 * readable frontier and stalls tear down after STALL_TIMEOUT_MS, players
 * retry.
 */
class QbittorrentPieceStream extends Readable {
  private cursor: number;
  private handle: FileHandle | null = null;
  private pumping = false;
  private stalledSince: number | null = null;
  private path: string;
  private lastSnapshotAt = 0;
  private lastRaisedAt = 0;

  constructor(
    private readonly client: QBittorrentClient,
    private readonly entry: QbittorrentStreamRefEntry,
    locatedPath: string,
    private readonly ownTorrent: boolean,
    private readonly start: number,
    private readonly end: number,
    private readonly signal?: AbortSignal
  ) {
    super();
    this.cursor = start;
    this.path = locatedPath;
    if (signal) {
      const onAbort = () => this.destroy();
      signal.addEventListener('abort', onAbort, { once: true });
      this.once('close', () => signal.removeEventListener('abort', onAbort));
      // The signal may have aborted in the async gap before construction.
      if (signal.aborted) this.destroy();
    }
  }

  override _read(): void {
    void this.pump();
  }

  override _destroy(
    error: Error | null,
    callback: (error: Error | null) => void
  ): void {
    this.handle?.close().catch(() => {});
    this.handle = null;
    callback(error);
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.destroyed) return;
    this.pumping = true;
    try {
      while (this.cursor < this.end && !this.destroyed) {
        // Keep the file live so a concurrent resolve cannot skip it.
        markFileLive(
          this.entry.credential,
          this.entry.hash,
          this.entry.fileIndex
        );
        let snapshot: Snapshot | undefined;
        try {
          snapshot = await getSnapshot(this.client, this.entry);
        } catch (error) {
          // A transient WebUI blip must not end playback while readable data
          // remains, only auth failures and aborts are fatal.
          if (
            this.signal?.aborted ||
            (error instanceof DebridError &&
              (error.statusCode === 401 || error.statusCode === 403))
          ) {
            throw error;
          }
          if (this.stalledSince === null) this.stalledSince = Date.now();
          if (Date.now() - this.stalledSince >= STALL_TIMEOUT_MS) {
            this.destroy(new Error('qBittorrent download stalled'));
            return;
          }
          await delay(AVAILABILITY_POLL_MS);
          continue;
        }
        if (!snapshot || this.destroyed) return;
        if (snapshot.at !== this.lastSnapshotAt) {
          this.lastSnapshotAt = snapshot.at;

          await this.ensureHandleCurrent();
        }
        // Heal a priority skip that slipped past the opener.
        if (
          this.ownTorrent &&
          snapshot.filePriority === FILE_PRIORITY.skip &&
          this.lastRaisedAt !== snapshot.at
        ) {
          this.lastRaisedAt = snapshot.at;
          await this.client.setFilePriority(
            this.entry.hash,
            [this.entry.fileIndex],
            FILE_PRIORITY.max,
            this.signal
          );
        }

        const frontier = snapshot.availability.readableFrom(this.cursor);
        if (frontier > this.cursor) {
          const chunkEnd = Math.min(
            frontier,
            this.end,
            this.cursor + READ_CHUNK_BYTES
          );
          const buffer = await this.readChunk(chunkEnd);
          if (this.destroyed) return;
          if (buffer !== null && buffer.length > 0) {
            this.stalledSince = null;
            // Advance by bytes actually read.
            this.cursor += buffer.length;
            if (!this.push(buffer)) return; // backpressure; _read fires again
            continue;
          }
          // Zero-length read, fall through to the wait.
        }
        if (this.stalledSince === null) this.stalledSince = Date.now();
        if (Date.now() - this.stalledSince >= STALL_TIMEOUT_MS) {
          logger.debug(
            { hash: this.entry.hash, cursor: this.cursor },
            'qBittorrent stream stalled, tearing down connection'
          );
          this.destroy(new Error('qBittorrent download stalled'));
          return;
        }
        await delay(AVAILABILITY_POLL_MS);
      }
      if (this.cursor >= this.end && !this.destroyed) this.push(null);
    } catch (error) {
      // Surface read/poll failures on the stream itself, an error thrown out
      // of pump() would otherwise reject an unwatched promise.
      this.destroy(error as Error);
    } finally {
      this.pumping = false;
    }
  }

  /** Verify the handle still matches the file at the current path. */
  private async ensureHandleCurrent(): Promise<void> {
    if (!this.handle) return;
    try {
      const handleStat = await this.handle.stat();
      if (handleStat.nlink > 0) {
        const pathStat = await stat(this.path);
        if (handleStat.ino === pathStat.ino && handleStat.dev === pathStat.dev) {
          return;
        }
      }
    } catch {
      // fall through: close and re-locate
    }
    await this.handle.close().catch(() => {});
    this.handle = null;
  }

  /**
   * Read up to `chunkEnd` at the cursor, a zero-length read closes the
   * handle for a re-locate and the cursor stays put.
   */
  private async readChunk(chunkEnd: number): Promise<Buffer | null> {
    this.handle ??= await this.openHandle();
    const length = chunkEnd - this.cursor;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await this.handle.read(
      buffer,
      0,
      length,
      this.cursor
    );
    if (this.destroyed) return null;
    if (bytesRead === 0) {
      await this.handle.close().catch(() => {});
      this.handle = null;
      return null;
    }
    return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
  }

  /**
   * Open the handle at the last known path, re-locating if it no longer
   * opens (moves, temp-dir exits, `.!qB` naming).
   */
  private async openHandle(): Promise<FileHandle> {
    if (this.handle) return this.handle;
    // Every open goes through the confinement check, a path swapped for a
    // symlink between checks must not get a raw open.
    const checkedOpen = async (path: string) => {
      const allowed = await resolveAllowedPath(path);
      if (allowed.status !== 'allowed') return undefined;
      return openRegularFile(allowed.realPath!);
    };
    let handle = await checkedOpen(this.path);
    if (!handle) {
      const located = await locateEntryFile(
        this.client,
        this.entry,
        this.signal
      );
      if (located) {
        logger.debug(
          { hash: this.entry.hash, from: this.path, to: located },
          'qBittorrent file moved; re-resolving path'
        );
        this.path = located;
        handle = await checkedOpen(located);
      }
    }
    if (!handle) {
      throw new Error(`qBittorrent file is no longer reachable: ${this.path}`);
    }
    this.handle = handle;
    return this.handle;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Abortable wait (a disconnecting client must not keep a request alive). */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/**
 * Open a byte range on a possibly still-downloading file. Full size is
 * always advertised, unwritten regions are never read.
 */
export async function openQbittorrentStream(opts: {
  token: string;
  range?: ByteRangeRequest;
  signal?: AbortSignal;
}): Promise<OpenedByteStream> {
  opts.signal?.throwIfAborted();
  // Stream references outlive configuration changes (12h TTL), the gate is
  // re-checked here so withdrawing the download roots also ends live links.
  if (FeatureControl.disabledServices.has(QBITTORRENT_SERVICE)) {
    throw new DebridError('qBittorrent playback is disabled on this instance', {
      statusCode: 403,
      statusText: 'Forbidden',
      code: 'FORBIDDEN',
      headers: {},
      body: null,
      type: 'api_error',
    });
  }
  const token = decodeQbittorrentStreamToken(opts.token);
  if (!token) {
    throw new DebridError('invalid or tampered qBittorrent stream token', {
      statusCode: 400,
      statusText: 'Bad Request',
      code: 'BAD_REQUEST',
      headers: {},
      body: null,
      type: 'api_error',
    });
  }
  if (token.exp < Math.floor(Date.now() / 1000)) {
    throw new DebridError('qBittorrent stream link expired; replay to refresh', {
      statusCode: 410,
      statusText: 'Gone',
      code: 'GONE',
      headers: {},
      body: null,
      type: 'api_error',
    });
  }
  const entry = await resolveStreamRef(token.ref);
  if (!entry) {
    throw new DebridError('qBittorrent stream link expired; replay to refresh', {
      statusCode: 410,
      statusText: 'Gone',
      code: 'GONE',
      headers: {},
      body: null,
      type: 'api_error',
    });
  }

  const client = new QBittorrentClient(entry.credential);
  const torrent = await client.getTorrent(entry.hash, opts.signal);
  if (!torrent) {
    throw new DebridError('qBittorrent no longer has this torrent', {
      statusCode: 404,
      statusText: 'Not Found',
      code: 'NOT_FOUND',
      type: 'api_error',
      headers: {},
    });
  }
  // File lists come from the shared per-torrent snapshot so seek-heavy
  // players (one open per range request) cannot hammer the WebUI with
  // redundant calls; the torrent fetch above covers existence and ownership.
  const { files } = await getTorrentState(client, entry);
  const selectedFile = files.find((file) => file.index === entry.fileIndex);
  if (!selectedFile) {
    throw new DebridError('Torrent no longer contains the selected file', {
      statusCode: 400,
      statusText: 'Bad Request',
      code: 'NO_MATCHING_FILE',
      type: 'api_error',
      headers: {},
    });
  }
  // The player asking for bytes makes this file live, heal any skip.
  markFileLive(entry.credential, entry.hash, entry.fileIndex);
  if (selectedFile.priority === FILE_PRIORITY.skip) {
    await client.setFilePriority(
      entry.hash,
      [entry.fileIndex],
      isOwnTorrent(torrent) ? FILE_PRIORITY.max : FILE_PRIORITY.normal,
      opts.signal
    );
  }

  const start =
    opts.range?.suffixLength !== undefined
      ? // A zero suffix length is unsatisfiable (RFC 7233): start = size,
        // which the range server answers with 416.
        Math.max(0, entry.fileSize - opts.range.suffixLength)
      : (opts.range?.start ?? 0);
  const end = Math.min(
    opts.range?.endExclusive ?? entry.fileSize,
    entry.fileSize
  );

    // Follow relocations (temp dir exits, move on finish, .!qB naming)
    // before giving up on the shared-filesystem diagnosis. A spanning
    // request may race a just-added torrent, give the locator a grace.
  const located = await locateEntryFile(client, entry, opts.signal);
  if (!located) {
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
  if (located !== entry.filePath) {
    logger.debug(
      { hash: entry.hash, from: entry.filePath, to: located },
      'qBittorrent file moved; following new path'
    );
  }

  const stream = new QbittorrentPieceStream(
    client,
    entry,
    located,
    isOwnTorrent(torrent),
    start,
    end,
    opts.signal
  );
  return {
    stream,
    size: entry.fileSize,
    start,
    end,
    filename: entry.filename,
    // Stable while the file grows, which a content hash would not be.
    etag: `"qbit-${entry.hash}-${entry.fileIndex}-${entry.fileSize}"`,
    lastModified: new Date(entry.addedAt * 1000),
  };
}
