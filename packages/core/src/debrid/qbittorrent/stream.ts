import { open, FileHandle } from 'fs/promises';
import { Readable } from 'stream';
import { DebridError } from '../base.js';
import type { ByteRangeRequest, OpenedByteStream } from '../../shares/types.js';
import { createLogger } from '../../utils/index.js';
import {
  FILE_PRIORITY,
  isOwnTorrent,
  qbittorrentCredentialKey,
  QBittorrentClient,
  type QbittorrentFile,
} from './client.js';
import {
  computeFileAvailability,
  deriveFilePath,
  PieceReadiness,
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
  return `${qbittorrentCredentialKey(entry.credential)}:${entry.hash}`;
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
  return { at, pieceSize, availability };
}

async function openIfExists(path: string): Promise<boolean> {
  try {
    const handle = await open(path, 'r');
    await handle.close();
    return true;
  } catch {
    return false;
  }
}

/** Opens a candidate only when it has reached the file's full size. */
async function openIfComplete(
  path: string,
  fileSize: number
): Promise<boolean> {
  try {
    const handle = await open(path, 'r');
    try {
      const { size } = await handle.stat();
      return size >= fileSize;
    } finally {
      await handle.close().catch(() => {});
    }
  } catch {
    return false;
  }
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
      if (await openIfExists(candidate)) return candidate;
    }
    const torrent = await client.getTorrent(entry.hash, signal);
    const files = torrent
      ? await client.getFiles(entry.hash, signal)
      : [];
    const derived = torrent
      ? deriveFilePath(torrent, files, entry.fileIndex)
      : undefined;
    if (derived && derived !== entry.filePath) {
      const moving = torrent?.state === 'moving';
      for (const candidate of pathVariants(derived)) {
        const ok = moving
          ? await openIfComplete(candidate, entry.fileSize)
          : await openIfExists(candidate);
        if (ok) return candidate;
      }
    }
    if (torrent?.state !== 'moving' || Date.now() >= deadline) return undefined;
    await delay(MOVE_RETRY_MS);
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

  constructor(
    private readonly client: QBittorrentClient,
    private readonly entry: QbittorrentStreamRefEntry,
    locatedPath: string,
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
        const snapshot = await getSnapshot(this.client, this.entry);
        if (this.destroyed) return;

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
    try {
      this.handle = await open(this.path, 'r');
      return this.handle;
    } catch {
      const located = await locateEntryFile(
        this.client,
        this.entry,
        this.signal
      );
      if (!located) {
        throw new Error(
          `qBittorrent file is no longer reachable: ${this.path}`
        );
      }
      logger.debug(
        { hash: this.entry.hash, from: this.path, to: located },
        'qBittorrent file moved; re-resolving path'
      );
      this.path = located;
      this.handle = await open(located, 'r');
      return this.handle;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  const start = opts.range?.suffixLength
    ? Math.max(0, entry.fileSize - opts.range.suffixLength)
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
