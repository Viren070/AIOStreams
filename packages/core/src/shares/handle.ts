import type { Readable } from 'node:stream';
import { ShareError, assertNever } from './errors.js';
import type {
  ByteRangeRequest,
  OpenedByteStream,
  ShareFile,
  ShareFileHandle,
} from './types.js';

type Opener = (
  range: ByteRangeRequest | undefined,
  signal: AbortSignal
) => Promise<OpenedByteStream>;

export interface WindowedHandleOptions {
  /** Bytes kept behind the read position for slightly out-of-order reads. */
  historyBytes?: number;
  /** Largest forward gap drained from the open stream instead of reopening. */
  skipBytes?: number;
}

const DEFAULT_HISTORY_BYTES = 4 * 1024 * 1024;
const DEFAULT_SKIP_BYTES = 4 * 1024 * 1024;

// The cross-package release contract; fsmux's release.ts documents it.
const RELEASE_BUFFER: unique symbol = Symbol.for('fsmux.release') as never;
type ReleasableBuffer = Buffer & { [RELEASE_BUFFER]?: () => void };
function releaseBuffer(buf: Buffer): void {
  (buf as ReleasableBuffer)[RELEASE_BUFFER]?.();
}

const SLAB_SIZE = 2 * 1024 * 1024;
const SLAB_POOL_MAX = 16;
const slabPool: Buffer[] = [];

interface Slab {
  buf: Buffer;
  offset: number;
  /** Live chunks plus unreleased handed-out slices; 0 returns it to the pool. */
  refs: number;
}

function takeSlab(): Slab {
  return {
    buf: slabPool.pop() ?? Buffer.allocUnsafe(SLAB_SIZE),
    offset: 0,
    refs: 0,
  };
}

function unrefSlab(slab: Slab): void {
  if (--slab.refs === 0 && slabPool.length < SLAB_POOL_MAX) {
    slabPool.push(slab.buf);
  }
}

/** Open a file for positional reads, whatever its body kind. */
export async function openShareFileHandle(
  file: ShareFile,
  signal?: AbortSignal
): Promise<ShareFileHandle> {
  const body = file.body;
  switch (body.type) {
    case 'inline':
      return inlineHandle(Buffer.from(body.text));
    case 'stream':
      if (body.openHandle) return body.openHandle(signal);
      return new WindowedHandle(body.open, file.size);
    default:
      return assertNever(body);
  }
}

function inlineHandle(bytes: Buffer): ShareFileHandle {
  return {
    async read(offset, length) {
      if (offset >= bytes.length || length <= 0) return Buffer.alloc(0);
      return Buffer.from(bytes.subarray(offset, offset + length));
    },
    async close() {},
  };
}

interface Source {
  stream: Readable;
  iterator: AsyncIterator<Buffer>;
  controller: AbortController;
  ended: boolean;
}

interface Chunk {
  start: number;
  buf: Buffer;
  slab?: Slab;
}

/**
 * Positional reads over a range stream that only opens once per sequential
 * run. Kernel clients read a file as many small offset/length calls, a few
 * in flight at once and not always in order; opening a range per call would
 * abandon the source's read-ahead. A bounded window of served bytes stays in
 * memory so slightly out-of-order reads are answered from it; only a real
 * seek reopens.
 */
export class WindowedHandle implements ShareFileHandle {
  private queue: Promise<unknown> = Promise.resolve();
  private source: Source | undefined;
  private chunks: Chunk[] = [];
  private slab: Slab | undefined;
  private winStart = 0;
  private winEnd = 0;
  private cursor = 0;
  private closed = false;
  private readonly historyBytes: number;
  private readonly skipBytes: number;

  constructor(
    private readonly open: Opener,
    private readonly size: number,
    opts: WindowedHandleOptions = {}
  ) {
    this.historyBytes = opts.historyBytes ?? DEFAULT_HISTORY_BYTES;
    this.skipBytes = opts.skipBytes ?? DEFAULT_SKIP_BYTES;
  }

  readv(
    offset: number,
    length: number,
    signal?: AbortSignal
  ): Promise<Buffer[]> {
    const run = this.queue.then(() => this.readNow(offset, length, signal));
    this.queue = run.catch(() => undefined);
    return run;
  }

  read(offset: number, length: number, signal?: AbortSignal): Promise<Buffer> {
    return this.readv(offset, length, signal).then(joinParts);
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.queue;
    this.dropSource();
    this.dropChunks();
  }

  private dropChunks(): void {
    for (const chunk of this.chunks) {
      if (chunk.slab) unrefSlab(chunk.slab);
    }
    this.chunks = [];
    this.slab = undefined;
  }

  private async readNow(
    offset: number,
    length: number,
    signal?: AbortSignal
  ): Promise<Buffer[]> {
    if (this.closed) throw new ShareError('IoError', 'file handle is closed');
    signal?.throwIfAborted();
    if (offset >= this.size || length <= 0) return [];
    const end = Math.min(offset + length, this.size);

    if (
      !this.source ||
      offset < this.winStart ||
      offset > this.winEnd + this.skipBytes
    ) {
      await this.reopen(offset, signal);
    }
    while (this.winEnd < end && !this.source!.ended) {
      signal?.throwIfAborted();
      await this.pull();
    }
    const out =
      offset >= this.winEnd
        ? []
        : this.sliceParts(offset, Math.min(end, this.winEnd));
    this.cursor = Math.max(this.cursor, end);
    this.trim();
    return out;
  }

  private async reopen(offset: number, signal?: AbortSignal): Promise<void> {
    this.dropSource();
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    let opened: OpenedByteStream;
    try {
      opened = await this.open({ start: offset }, controller.signal);
    } catch (err) {
      throw ShareError.from(err);
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
    this.source = {
      stream: opened.stream,
      iterator: opened.stream[Symbol.asyncIterator](),
      controller,
      ended: false,
    };
    this.dropChunks();
    this.winStart = opened.start;
    this.winEnd = opened.start;
    this.cursor = opened.start;
  }

  private async pull(): Promise<void> {
    const source = this.source!;
    let next: IteratorResult<Buffer>;
    try {
      next = await source.iterator.next();
    } catch (err) {
      this.dropSource();
      throw ShareError.from(err);
    }
    if (next.done) {
      source.ended = true;
      return;
    }
    // Sources may recycle the chunk they yielded once the consumer moves on,
    // so the bytes are copied out; pooled slabs keep the copies from feeding
    // the allocator on every chunk.
    const len = next.value.length;
    if (len === 0) return;
    let buf: Buffer;
    let slab: Slab | undefined;
    if (len > SLAB_SIZE) {
      buf = Buffer.from(next.value);
    } else {
      if (!this.slab || SLAB_SIZE - this.slab.offset < len) {
        this.slab = takeSlab();
      }
      slab = this.slab;
      buf = slab.buf.subarray(slab.offset, slab.offset + len);
      buf.set(next.value);
      slab.offset += len;
      slab.refs++;
    }
    this.chunks.push({ start: this.winEnd, buf, slab });
    this.winEnd += buf.length;
  }

  private sliceParts(from: number, to: number): Buffer[] {
    const parts: Buffer[] = [];
    for (const chunk of this.chunks) {
      const chunkEnd = chunk.start + chunk.buf.length;
      if (chunkEnd <= from) continue;
      if (chunk.start >= to) break;
      const view = chunk.buf.subarray(
        Math.max(from, chunk.start) - chunk.start,
        Math.min(to, chunkEnd) - chunk.start
      ) as ReleasableBuffer;
      const slab = chunk.slab;
      if (slab) {
        slab.refs++;
        let released = false;
        view[RELEASE_BUFFER] = () => {
          if (released) return;
          released = true;
          unrefSlab(slab);
        };
      }
      parts.push(view);
    }
    return parts;
  }

  private trim(): void {
    const keepFrom = this.cursor - this.historyBytes;
    let dropped = 0;
    while (dropped < this.chunks.length) {
      const chunk = this.chunks[dropped];
      if (chunk.start + chunk.buf.length > keepFrom) break;
      dropped++;
    }
    if (dropped === 0) return;
    for (const chunk of this.chunks.slice(0, dropped)) {
      if (chunk.slab) unrefSlab(chunk.slab);
    }
    this.chunks.splice(0, dropped);
    this.winStart = this.chunks[0]?.start ?? this.winEnd;
  }

  private dropSource(): void {
    const source = this.source;
    if (!source) return;
    this.source = undefined;
    source.controller.abort();
    source.stream.destroy();
  }
}

/** One buffer from readv parts; a join consumes (releases) the views. */
function joinParts(parts: Buffer[]): Buffer {
  if (parts.length === 0) return Buffer.alloc(0);
  if (parts.length === 1) return parts[0];
  const out = Buffer.concat(parts);
  for (const p of parts) releaseBuffer(p);
  return out;
}
