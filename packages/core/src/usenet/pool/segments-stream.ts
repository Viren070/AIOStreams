import { createLogger } from '../../logging/logger.js';
import { MultiProviderPool } from './multi-provider-pool.js';
import { OrderedParallelStream } from './ordered-parallel-stream.js';
import { CommandPriority, NzbSegmentRef } from '../types.js';
import type { HoleDecision } from '../holes.js';

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
  /**
   * Exact decoded size of task `idx` (LOCAL index within `segments`), or
   * undefined when the part grid can't guarantee it. Zero-fill padding
   * requires an exact size: a wrong pad length silently shifts every later
   * byte, which is worse than the stream dying.
   */
  sizeForSegment?: (idx: number) => number | undefined;
  /**
   * Decision hook for a definitive all-providers miss: `pad` emits exactly
   * `bytes` zeros in the segment's place, `fail` destroys the stream (legacy
   * behaviour, also used when the hook or the exact size is absent).
   */
  onHole?: (idx: number, bytes: number) => HoleDecision;
  /**
   * Segments (LOCAL indices) already known missing from a persisted hole
   * map: zero-filled immediately, without burning a failover round-trip.
   */
  knownHoles?: ReadonlySet<number>;
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
  private sizeForSegment?: (idx: number) => number | undefined;
  private onHole?: (idx: number, bytes: number) => HoleDecision;
  private knownHoles?: ReadonlySet<number>;

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
    this.sizeForSegment = opts.sizeForSegment;
    this.onHole = opts.onHole;
    this.knownHoles = opts.knownHoles;

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
    // Replay pre-pad: a segment already known missing (persisted hole map)
    // zero-fills immediately, with no fetch or failover round-trip.
    if (this.knownHoles?.has(idx) && this.padTask(idx)) return;
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
      .catch((err) => {
        if (slot) this.slots.release(idx);
        this.settleTaskFailure(idx, err);
      });
  }

  /**
   * A segment may be zero-filled only with its exact decoded size and only
   * when the owner's hole hook approves.
   */
  protected override tryPadHole(idx: number): number | undefined {
    if (!this.onHole || !this.sizeForSegment) return undefined;
    const bytes = this.sizeForSegment(idx);
    if (bytes === undefined || bytes <= 0) {
      logger.warn(
        { ...this.logContext(idx) },
        'segment missing on all providers but its exact size is unknown (no locked part grid); cannot pad'
      );
      return undefined;
    }
    return this.onHole(idx, bytes) === 'pad' ? bytes : undefined;
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
