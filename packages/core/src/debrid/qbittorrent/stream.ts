import { open, FileHandle } from 'fs/promises';
import { Readable } from 'stream';
import { DebridError } from '../base.js';
import type { ByteRangeRequest, OpenedByteStream } from '../../shares/types.js';
import { createLogger } from '../../utils/index.js';
import {
  FILE_PRIORITY,
  isOwnTorrent,
  QBittorrentClient,
} from './client.js';
import {
  computeFileAvailability,
  deriveFilePath,
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
const MAX_SHARED_SNAPSHOTS = 256;

interface Snapshot {
  at: number;
  pieceSize: number;
  availability: FileAvailability;
}

interface SharedSnapshot {
  value?: Snapshot;
  promise?: Promise<Snapshot>;
}

/** Shared per-torrent state, deduplicates polling across concurrent streams. */
const sharedSnapshots = new Map<string, SharedSnapshot>();

function getSharedSnapshot(
  client: QBittorrentClient,
  entry: QbittorrentStreamRefEntry,
  signal?: AbortSignal
): Promise<Snapshot> {
  const cached = sharedSnapshots.get(entry.hash);
  if (cached?.value && Date.now() - cached.value.at < SNAPSHOT_TTL_MS) {
    return Promise.resolve(cached.value);
  }
  if (cached?.promise) return cached.promise;
  const promise = (async () => {
    const [files, pieceSize, pieceStates] = await Promise.all([
      client.getFiles(entry.hash, signal),
      client.getPieceSize(entry.hash, signal),
      client.getPieceStates(entry.hash, signal),
    ]);
    const availability = computeFileAvailability({
      files,
      fileIndex: entry.fileIndex,
      pieceStates,
      pieceSize,
    });
    const value: Snapshot = { at: Date.now(), pieceSize, availability };
    sharedSnapshots.set(entry.hash, { value });
    if (sharedSnapshots.size > MAX_SHARED_SNAPSHOTS) {
      const oldest = sharedSnapshots.keys().next().value;
      if (oldest !== undefined) sharedSnapshots.delete(oldest);
    }
    return value;
  })();
  promise.catch(() => sharedSnapshots.delete(entry.hash));
  sharedSnapshots.set(entry.hash, { promise });
  return promise;
}

 * A Readable over a possibly still-downloading file, reads stop at the
 * readable frontier and stalls tear down after STALL_TIMEOUT_MS, players
 * retry.
class QbittorrentPieceStream extends Readable {
  private cursor: number;
  private handle: FileHandle | null = null;
  private pumping = false;
  private stalledSince: number | null = null;

  constructor(
    private readonly client: QBittorrentClient,
    private readonly entry: QbittorrentStreamRefEntry,
    private readonly start: number,
    private readonly end: number,
    private readonly signal?: AbortSignal
  ) {
    super();
    this.cursor = start;
    if (signal) {
      const onAbort = () => this.destroy();
      signal.addEventListener('abort', onAbort, { once: true });
      this.once('close', () => signal.removeEventListener('abort', onAbort));
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
        markFileLive(this.entry.hash, this.entry.fileIndex);
        const snapshot = await getSharedSnapshot(
          this.client,
          this.entry,
          this.signal
        );
        if (this.destroyed) return;
        // The largest byte (exclusive) known to be on disk behind the
        // cursor; one piece behind the piece frontier unless complete,
        // because piece states flip before the flush.
        const contiguous = snapshot.availability.contiguousFrom(this.cursor);
        const frontier = snapshot.availability.complete
          ? contiguous
          : Math.max(this.cursor, contiguous - snapshot.pieceSize);
        if (frontier > this.cursor) {
          const chunkEnd = Math.min(
            frontier,
            this.end,
            this.cursor + READ_CHUNK_BYTES
          );
          const buffer = await this.readChunk(chunkEnd);
          if (!buffer) return; // destroyed mid-read
          this.stalledSince = null;
          this.cursor = chunkEnd;
          if (!this.push(buffer)) return; // backpressure; _read fires again
          continue;
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
    return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
  }

  /**
   * Open the file handle, following qBittorrent relocations if the current
   * path no longer opens (mid-stream "move on finish", temp-dir exits,
   * `.!qB` naming). An already-open handle keeps reading the same inode
   * across a rename.
   */
  private async openHandle(): Promise<FileHandle> {
    if (this.handle) return this.handle;
    const located = await locateEntryFile(
      this.client,
      this.entry,
      this.signal
    );
    if (!located) {
      throw new Error(`qBittorrent file is no longer reachable: ${this.entry.filePath}`);
    }
    if (located !== this.entry.filePath) {
      logger.debug(
        { hash: this.entry.hash, from: this.entry.filePath, to: located },
        'qBittorrent file moved; re-resolving path'
      );
      this.entry.filePath = located;
    }
    this.handle = await open(located, 'r');
    return this.handle;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Find the on-disk path of a stream entry's file, following qBittorrent
 * relocations: the registered path, its `.!qB` variant ("append .!qB to
 * incomplete files"), and a freshly derived path (the torrent may have been
 * moved out of its temp dir by "finished" handling, or relocated on
 * completion) plus that variant. Returns undefined when nothing opens.
 */
async function locateEntryFile(
  client: QBittorrentClient,
  entry: QbittorrentStreamRefEntry,
  signal?: AbortSignal
): Promise<string | undefined> {
  for (const candidate of [entry.filePath, entry.filePath + '.!qB']) {
    try {
      const handle = await open(candidate, 'r');
      await handle.close();
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  const torrent = await client.getTorrent(entry.hash, signal);
  const files = torrent
    ? await client.getFiles(entry.hash, signal)
    : [];
  const derived = torrent
    ? deriveFilePath(torrent, files, entry.fileIndex)
    : undefined;
  if (!derived || derived === entry.filePath) return undefined;
  for (const candidate of [derived, derived + '.!qB']) {
    try {
      const handle = await open(candidate, 'r');
      await handle.close();
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  return undefined;
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
  const files = await client.getFiles(entry.hash, opts.signal);
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
  markFileLive(entry.hash, entry.fileIndex);
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
    entry.filePath = located;
  }

  const stream = new QbittorrentPieceStream(
    client,
    entry,
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
