import { open } from 'fs/promises';
import { FileHandle } from 'fs/promises';
import { Readable } from 'stream';
import { DebridError } from '../base.js';
import type { ByteRangeRequest, OpenedByteStream } from '../../shares/types.js';
import { createLogger } from '../../utils/index.js';
import { QBittorrentClient } from './client.js';
import { computeFileAvailability, type FileAvailability } from './availability.js';
import {
  QbittorrentStreamToken,
  decodeQbittorrentStreamToken,
  resolveCredentialRef,
} from './tokens.js';

const logger = createLogger('debrid:qbittorrent');

const AVAILABILITY_POLL_MS = 2_000;
/** Destroy the stream (and with it the connection) after this long stalled. */
const STALL_TIMEOUT_MS = 60_000;
const READ_CHUNK_BYTES = 512 * 1024;

interface Snapshot {
  at: number;
  pieceSize: number;
  availability: FileAvailability;
}

 * A Readable over a possibly still-downloading file, reads stop at the
 * readable frontier and stalls tear down after STALL_TIMEOUT_MS, players
 * retry.
class QbittorrentPieceStream extends Readable {
  private cursor: number;
  private handle: FileHandle | null = null;
  private pumping = false;
  private stalledSince: number | null = null;
  private snapshot: Snapshot | null = null;

  constructor(
    private readonly client: QBittorrentClient,
    private readonly token: QbittorrentStreamToken,
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
        const snapshot = await this.currentSnapshot();
        const frontier = this.diskFrontier(snapshot);
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
            { hash: this.token.hash, cursor: this.cursor },
            'qBittorrent stream stalled, tearing down connection'
          );
          this.destroy(new Error('qBittorrent download stalled'));
          return;
        }
        await delay(AVAILABILITY_POLL_MS);
      }
      if (this.cursor >= this.end && !this.destroyed) this.push(null);
    } finally {
      this.pumping = false;
    }
  }

  /** The largest byte (exclusive) known to be on disk behind the cursor. */
  private diskFrontier(snapshot: Snapshot): number {
    const contiguous = snapshot.availability.contiguousFrom(this.cursor);
    if (snapshot.availability.complete) return contiguous;
    return Math.max(this.cursor, contiguous - snapshot.pieceSize);
  }

  private async currentSnapshot(): Promise<Snapshot> {
    if (
      this.snapshot &&
      Date.now() - this.snapshot.at < AVAILABILITY_POLL_MS &&
      !this.snapshot.availability.complete
    ) {
      return this.snapshot;
    }
    const [files, pieceSize, pieceStates] = await Promise.all([
      this.client.getFiles(this.token.hash, this.signal),
      this.client.getPieceSize(this.token.hash, this.signal),
      this.client.getPieceStates(this.token.hash, this.signal),
    ]);
    const availability = computeFileAvailability({
      files,
      fileIndex: this.token.fileIndex,
      pieceStates,
      pieceSize,
    });
    this.snapshot = { at: Date.now(), pieceSize, availability };
    return this.snapshot;
  }

  private async readChunk(chunkEnd: number): Promise<Buffer | null> {
    this.handle ??= await open(this.token.filePath, 'r');
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
  const credential = await resolveCredentialRef(token.credentialRef);
  if (!credential) {
    throw new DebridError('qBittorrent stream link expired; replay to refresh', {
      statusCode: 410,
      statusText: 'Gone',
      code: 'GONE',
      headers: {},
      body: null,
      type: 'api_error',
    });
  }

  const client = new QBittorrentClient(credential);
  const torrent = await client.getTorrent(token.hash, opts.signal);
  if (!torrent) {
    throw new DebridError('qBittorrent no longer has this torrent', {
      statusCode: 404,
      statusText: 'Not Found',
      code: 'NOT_FOUND',
      type: 'api_error',
      headers: {},
    });
  }
  const files = await client.getFiles(token.hash, opts.signal);
  if (!files.some((file) => file.index === token.fileIndex)) {
    throw new DebridError('Torrent no longer contains the selected file', {
      statusCode: 400,
      statusText: 'Bad Request',
      code: 'NO_MATCHING_FILE',
      type: 'api_error',
      headers: {},
    });
  }

  const start = opts.range?.suffixLength
    ? Math.max(0, token.fileSize - opts.range.suffixLength)
    : (opts.range?.start ?? 0);
  const end = Math.min(opts.range?.endExclusive ?? token.fileSize, token.fileSize);

  try {
    const handle = await open(token.filePath, 'r');
    // The path was reachable when the token was minted; if it is gone now the
    // mount or qBittorrent's layout changed underneath us.
    await handle.close();
  } catch {
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

  const stream = new QbittorrentPieceStream(
    client,
    token,
    start,
    end,
    opts.signal
  );
  return {
    stream,
    size: token.fileSize,
    start,
    end,
    filename: token.filename,
    // Stable while the file grows, which a content hash would not be.
    etag: `"qbit-${token.hash}-${token.fileIndex}-${token.fileSize}"`,
    lastModified: new Date(token.addedAt * 1000),
  };
}
