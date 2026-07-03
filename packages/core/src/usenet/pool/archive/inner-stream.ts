import { Readable } from 'node:stream';
import { SeekableStream } from '../file-stream.js';
import { RandomAccess, readAtIntoFrom } from './random-access.js';
import { DataFragment } from './types.js';
import { LazyFragmentResolver } from './lazy-resolver.js';
import {
  ParallelRangeStream,
  type ParallelRangeStreamOptions,
} from './range-stream.js';

/** Default read window: roughly one NZB segment, so a window ≈ one fetch. */
const DEFAULT_WINDOW_BYTES = 1 << 20; // 1 MiB
/** Fallback per-stream concurrency when the engine doesn't thread one through. */
const DEFAULT_CONCURRENCY = 8;
/** Fallback read-ahead depth, in windows. */
const DEFAULT_PREFETCH_WINDOWS = 32;

/** Playback tuning threaded from {@link EngineOptions} for the final stream. */
export interface ArchiveStreamOptions {
  /** Max windows fetched concurrently (= per-stream connection budget). */
  concurrency?: number;
  /** Window granularity in bytes. */
  windowBytes?: number;
  /** Read-ahead depth in windows (buffer = windows × windowBytes). */
  prefetchWindows?: number;
  /** Hole (all-providers 430) pad-vs-fail hook for the final range stream. */
  onHole?: ParallelRangeStreamOptions['onHole'];
}

/**
 * A {@link SeekableStream} over a **stored** inner archive file. The inner file
 * is described by an ordered list of {@link DataFragment}s (one per volume it
 * spans) within a backing {@link RandomAccess} (the concatenated VolumeSet).
 * Logical offsets map onto fragments, so HTTP Range reads compose the archive
 * offset with the inner offset (no decompression).
 */
export class ArchiveInnerStream implements SeekableStream {
  private readonly _size: number;
  private readonly windowBytes: number;
  private readonly concurrency: number;
  private readonly prefetchWindows: number;
  private readonly onHole?: ParallelRangeStreamOptions['onHole'];

  constructor(
    private source: RandomAccess,
    private fragments: DataFragment[],
    readonly filename?: string,
    declaredSize?: number,
    streamOpts: ArchiveStreamOptions = {},
    /**
     * Present when {@link fragments} contains PENDING (estimated) entries from
     * a lazy parse; resolves them on first touch. Estimates are never served.
     */
    private readonly resolver?: LazyFragmentResolver
  ) {
    const fragTotal = fragments.reduce((acc, f) => acc + f.length, 0);
    // Stored entries: packed bytes == decoded bytes. Trust the fragment total,
    // clamped to the declared unpacked size when known. (For lazy fragments
    // the estimate sum is forced exact, so this stays the true size.)
    this._size =
      declaredSize && declaredSize > 0
        ? Math.min(declaredSize, fragTotal)
        : fragTotal;
    this.windowBytes = Math.max(
      1,
      streamOpts.windowBytes ?? DEFAULT_WINDOW_BYTES
    );
    this.concurrency = Math.max(
      1,
      streamOpts.concurrency ?? DEFAULT_CONCURRENCY
    );
    this.prefetchWindows = Math.max(
      1,
      streamOpts.prefetchWindows ?? DEFAULT_PREFETCH_WINDOWS
    );
    this.onHole = streamOpts.onHole;
  }

  size(): number {
    return this._size;
  }

  async open(): Promise<void> {
    // The backing source is already opened by the caller.
  }

  async readAt(offset: number, length: number): Promise<Buffer> {
    if (length <= 0 || offset >= this._size) return Buffer.alloc(0);
    const want = Math.min(length, this._size - Math.max(0, offset));
    const dst = Buffer.allocUnsafe(want);
    const written = await this.readAtInto(dst, 0, offset, length);
    return written === dst.length ? dst : dst.subarray(0, written);
  }

  /** {@link readAt} into a caller-owned buffer (see RandomAccess.readAtInto). */
  async readAtInto(
    dst: Buffer,
    dstOffset: number,
    offset: number,
    length: number
  ): Promise<number> {
    if (length <= 0 || offset >= this._size) return 0;
    if (this.resolver?.hasPending()) {
      // Resolve enough pending fragments that the read maps through exact
      // lengths, anchored from whichever side is cheaper
      const end = offset + length;
      this.fragments =
        this._size - offset < end
          ? await this.resolver.resolveFrom(offset)
          : await this.resolver.resolveThrough(end);
      this.resolver.resolveAhead(end, 1);
    }
    let written = 0;
    let pos = Math.max(0, offset);
    let remaining = Math.min(length, this._size - pos);
    let logical = 0;
    for (const frag of this.fragments) {
      if (remaining <= 0) break;
      const fragStart = logical;
      const fragEnd = logical + frag.length;
      logical = fragEnd;
      if (pos >= fragEnd) continue;
      const within = pos - fragStart;
      const want = Math.min(remaining, frag.length - within);
      const n = await readAtIntoFrom(
        this.source,
        dst,
        dstOffset + written,
        frag.offset + within,
        want
      );
      if (n === 0) break;
      written += n;
      pos += n;
      remaining -= n;
    }
    return written;
  }

  createReadStream(range?: { start?: number; end?: number }): Readable {
    const start = Math.max(0, range?.start ?? 0);
    const end = Math.min(this._size, range?.end ?? this._size);
    if (end <= start) return Readable.from([]);
    // Drive `readAtInto` windows in parallel + in order. Each window composes
    // the inner offset onto its fragment/volume/segment(s); running several
    // windows concurrently gives archive playback the same throughput as a
    // plain file.
    return new ParallelRangeStream({
      readAtInto: (dst, dstOffset, offset, length) =>
        this.readAtInto(dst, dstOffset, offset, length),
      start,
      end,
      windowBytes: this.windowBytes,
      concurrency: this.concurrency,
      maxBufferedBytes: this.prefetchWindows * this.windowBytes,
      onHole: this.onHole,
    });
  }
}
