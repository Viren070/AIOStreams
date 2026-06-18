import { Readable } from 'node:stream';
import { SeekableStream } from '../file-stream.js';
import { RandomAccess } from './random-access.js';
import { DataFragment } from './types.js';
import { LazyFragmentResolver } from './lazy-resolver.js';
import { ParallelRangeStream } from './range-stream.js';

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
  }

  size(): number {
    return this._size;
  }

  async open(): Promise<void> {
    // The backing source is already opened by the caller.
  }

  async readAt(offset: number, length: number): Promise<Buffer> {
    if (length <= 0 || offset >= this._size) return Buffer.alloc(0);
    if (this.resolver?.hasPending()) {
      // Bytes are only served from the exact prefix: resolve every pending
      // fragment the read overlaps (parallel, single-flight), then pre-resolve
      // the next volume so sequential playback never blocks at a crossing.
      this.fragments = await this.resolver.resolveThrough(offset + length);
      this.resolver.resolveAhead(offset + length, 1);
    }
    const out: Buffer[] = [];
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
      const chunk = await this.source.readAt(frag.offset + within, want);
      if (chunk.length === 0) break;
      out.push(chunk);
      pos += chunk.length;
      remaining -= chunk.length;
    }
    return Buffer.concat(out);
  }

  createReadStream(range?: { start?: number; end?: number }): Readable {
    const start = Math.max(0, range?.start ?? 0);
    const end = Math.min(this._size, range?.end ?? this._size);
    if (end <= start) return Readable.from([]);
    // Drive `readAt` windows in parallel + in order. Each window composes the
    // inner offset onto its fragment/volume/segment(s); running several windows
    // concurrently gives archive playback the same throughput as a plain file.
    return new ParallelRangeStream({
      readAt: (offset, length) => this.readAt(offset, length),
      start,
      end,
      windowBytes: this.windowBytes,
      concurrency: this.concurrency,
      maxBufferedBytes: this.prefetchWindows * this.windowBytes,
    });
  }
}
