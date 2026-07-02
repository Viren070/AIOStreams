import { createLogger } from '../../logging/logger.js';
import { MultiProviderPool } from './multi-provider-pool.js';
import { OrderedParallelStream } from './ordered-parallel-stream.js';
import { CommandPriority, NzbSegmentRef } from '../types.js';

const logger = createLogger('usenet/segments');

export interface SegmentsStreamOptions {
  pool: MultiProviderPool;
  /** Segments to stream, in file order. */
  segments: NzbSegmentRef[];
  nzbHash: string;
  /** Max parallel segment fetches. */
  maxWorkers: number;
  /** Soft byte budget for the in-order reorder buffer (back-pressure). */
  bufferSizeBytes: number;
  /** Bytes to discard from the very start of the first segment. */
  skipBytes?: number;
  /** Maximum number of (post-skip) bytes to emit, then EOF. */
  limitBytes?: number;
  priority?: CommandPriority;
  signal?: AbortSignal;
}

/**
 * A Node Readable that fetches NZB segments in parallel and emits their
 * decoded bodies strictly in order. Supports skipping leading bytes and
 * limiting total output so a {@link FileStream} can serve arbitrary byte
 * ranges.
 */
export class SegmentsStream extends OrderedParallelStream {
  private pool: MultiProviderPool;
  private segments: NzbSegmentRef[];
  private nzbHash: string;
  private priority: CommandPriority;
  private signal?: AbortSignal;

  private skipRemaining: number;
  private limitRemaining: number;
  private abortController = new AbortController();
  private onExternalAbort?: () => void;

  constructor(opts: SegmentsStreamOptions) {
    const maxWorkers = Math.max(1, opts.maxWorkers);
    super({
      highWaterMark: opts.bufferSizeBytes,
      totalTasks: opts.segments.length,
      maxConcurrency: maxWorkers,
      maxBufferedBytes: Math.max(1, opts.bufferSizeBytes),
      slotCap: 4 * maxWorkers + 16,
      initialMaxSlot: 1 << 20,
      logger,
    });
    this.pool = opts.pool;
    this.segments = opts.segments;
    this.nzbHash = opts.nzbHash;
    this.priority = opts.priority ?? CommandPriority.High;
    this.signal = opts.signal;
    this.skipRemaining = opts.skipBytes ?? 0;
    this.limitRemaining = opts.limitBytes ?? Number.POSITIVE_INFINITY;

    if (this.signal) {
      if (this.signal.aborted) this.abortController.abort();
      else {
        this.onExternalAbort = () => this.abortController.abort();
        this.signal.addEventListener('abort', this.onExternalAbort, {
          once: true,
        });
      }
    }
  }

  protected startTask(idx: number): void {
    const segment = this.segments[idx];
    // Slots are acquired lazily via the provider (never for cache hits) and
    // idempotently across failover retries. Slot size is bounded by
    // `segment.bytes`, an upper bound on the decoded size; when that is
    // absent or under-declared, `decodeArticle` falls back to an owned
    // buffer.
    let slot: Buffer | undefined;
    this.pool
      .fetchSegmentInto(
        segment,
        this.nzbHash,
        this.abortController.signal,
        this.priority,
        () =>
          (slot ??= this.slots.acquire(
            idx,
            Math.max(1 << 20, segment.bytes ?? 0)
          ))
      )
      .then((data) => {
        // Release the slot if the fetch resolved with an owned body instead.
        if (slot && data.body.buffer !== slot.buffer) this.slots.release(idx);
        this.completeTask(idx, data.body);
      })
      .catch((err) => this.failTask(idx, err));
  }

  protected transformChunk(idx: number, chunk: Buffer): Buffer | null {
    if (this.skipRemaining > 0) {
      if (chunk.length <= this.skipRemaining) {
        this.skipRemaining -= chunk.length;
        return null;
      }
      chunk = chunk.subarray(this.skipRemaining);
      this.skipRemaining = 0;
    }

    if (chunk.length > this.limitRemaining) {
      chunk = chunk.subarray(0, this.limitRemaining);
    }
    this.limitRemaining -= chunk.length;
    if (this.limitRemaining <= 0) this.endAfterChunk = true;
    return chunk;
  }

  protected override shouldIgnoreTaskError(): boolean {
    // Aborted fetches are expected teardown of unneeded prefetches, not
    // stream errors.
    return this.abortController.signal.aborted;
  }

  protected override onDestroy(): void {
    this.abortController.abort();
    if (this.signal && this.onExternalAbort) {
      this.signal.removeEventListener('abort', this.onExternalAbort);
    }
  }

  /**
   * Abort still-in-flight prefetches once EOF is pushed; their now-irrelevant
   * outcomes then hit the {@link shouldIgnoreTaskError} guard instead of
   * destroying the stream.
   */
  protected override onEnd(): void {
    this.abortController.abort();
  }

  protected logContext(idx: number): Record<string, unknown> {
    return { nzbHash: this.nzbHash, segmentIndex: idx };
  }
}
