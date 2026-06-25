import { Readable } from 'node:stream';
import { createLogger } from '../../logging/logger.js';
import { MultiProviderPool } from './multi-provider-pool.js';
import { CommandPriority, NzbSegmentRef } from '../types.js';

const logger = createLogger('usenet/segments');

/** Only log an in-order wait as a stall once it exceeds this (ms). */
const STALL_LOG_MS = 200;

export interface SegmentsStreamOptions {
  pool: MultiProviderPool;
  /** Segments to stream, in file order. */
  segments: NzbSegmentRef[];
  /** Newsgroups for GROUP selection. */
  groups: string[];
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
 * A Node Readable that fetches NZB segments in parallel (bounded by
 * `maxWorkers` and a byte budget) and emits their decoded bodies strictly
 * in order. Supports skipping leading bytes and limiting total output so a
 * {@link FileStream} can serve arbitrary byte ranges.
 */
export class SegmentsStream extends Readable {
  private pool: MultiProviderPool;
  private segments: NzbSegmentRef[];
  private groups: string[];
  private nzbHash: string;
  private maxWorkers: number;
  private bufferSizeBytes: number;
  private priority: CommandPriority;
  private signal?: AbortSignal;

  private nextDispatch = 0;
  private nextEmit = 0;
  private inflight = 0;
  private buffered = new Map<number, Buffer>();
  private bufferedBytes = 0;
  private paused = false;
  private destroyedFlag = false;
  /**
   * Set once EOF has been pushed (range limit reached or all segments emitted).
   */
  private ended = false;

  private skipRemaining: number;
  private limitRemaining: number;
  private abortController = new AbortController();
  private onExternalAbort?: () => void;

  /**
   * Stall instrumentation: epoch ms since the consumer wanted data but the next
   * in-order segment was not yet buffered (0 = not stalled), and a running count
   * of stalls long enough to be felt during playback.
   */
  private stallSince = 0;
  private stalls = 0;

  constructor(opts: SegmentsStreamOptions) {
    super({ highWaterMark: opts.bufferSizeBytes });
    this.pool = opts.pool;
    this.segments = opts.segments;
    this.groups = opts.groups;
    this.nzbHash = opts.nzbHash;
    this.maxWorkers = Math.max(1, opts.maxWorkers);
    this.bufferSizeBytes = Math.max(1, opts.bufferSizeBytes);
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

  override _read(): void {
    this.paused = false;
    this.flush();
    this.dispatch();
  }

  override _destroy(err: Error | null, cb: (e?: Error | null) => void): void {
    this.destroyedFlag = true;
    this.abortController.abort();
    if (this.signal && this.onExternalAbort) {
      this.signal.removeEventListener('abort', this.onExternalAbort);
    }
    this.buffered.clear();
    this.bufferedBytes = 0;
    cb(err);
  }

  private dispatch(): void {
    while (
      !this.destroyedFlag &&
      !this.ended &&
      this.inflight < this.maxWorkers &&
      this.nextDispatch < this.segments.length &&
      this.bufferedBytes < this.bufferSizeBytes
    ) {
      const idx = this.nextDispatch++;
      const segment = this.segments[idx];
      this.inflight++;
      this.pool
        .fetchSegment(
          segment,
          this.groups,
          this.nzbHash,
          this.abortController.signal,
          this.priority
        )
        .then((data) => {
          if (this.destroyedFlag || this.ended) return;
          this.inflight--;
          this.buffered.set(idx, data.body);
          this.bufferedBytes += data.body.length;
          this.flush();
          this.dispatch();
        })
        .catch((err) => {
          if (this.destroyedFlag || this.ended) return;
          // An aborted fetch is expected teardown of an unneeded prefetch;
          // never surface it as a stream error (it would kill the consumer).
          if (this.abortController.signal.aborted) return;
          logger.debug(
            { nzbHash: this.nzbHash, segmentIndex: idx, err },
            'segment fetch failed; destroying stream'
          );
          this.destroy(err instanceof Error ? err : new Error(String(err)));
        });
    }
  }

  private flush(): void {
    if (this.paused || this.destroyedFlag || this.ended) return;
    while (this.buffered.has(this.nextEmit)) {
      // The head-of-line segment we were waiting on just arrived: close out the
      // stall window and report it if it was long enough to be felt.
      if (this.stallSince !== 0) {
        const stallMs = Date.now() - this.stallSince;
        this.stallSince = 0;
        if (stallMs >= STALL_LOG_MS) {
          this.stalls++;
          logger.debug(
            {
              nzbHash: this.nzbHash,
              segmentIndex: this.nextEmit,
              stallMs,
              stalls: this.stalls,
              inflight: this.inflight,
              maxWorkers: this.maxWorkers,
            },
            'usenet stream stalled on in-order segment'
          );
        }
      }
      let chunk = this.buffered.get(this.nextEmit)!;
      this.buffered.delete(this.nextEmit);
      this.bufferedBytes -= chunk.length;
      this.nextEmit++;

      // Discard leading bytes if seeking into the middle of the first segment.
      if (this.skipRemaining > 0) {
        if (chunk.length <= this.skipRemaining) {
          this.skipRemaining -= chunk.length;
          continue;
        }
        chunk = chunk.subarray(this.skipRemaining);
        this.skipRemaining = 0;
      }

      // Trim to the byte limit.
      if (chunk.length > this.limitRemaining) {
        chunk = chunk.subarray(0, this.limitRemaining);
      }
      this.limitRemaining -= chunk.length;

      const more = chunk.length === 0 ? true : this.push(chunk);

      if (this.limitRemaining <= 0) {
        this.finishEnd();
        return;
      }
      if (!more) {
        this.paused = true;
        return;
      }
    }

    if (this.nextEmit >= this.segments.length && this.inflight === 0) {
      this.finishEnd();
    }
  }

  /**
   * Emit EOF exactly once and abort any still-in-flight prefetches. Aborting
   * both stops wasted fetches and ensures their (now-irrelevant) outcomes hit
   * the `abortController.signal.aborted` guard in {@link dispatch} rather than
   * destroying a stream whose consumer has already detached.
   */
  private finishEnd(): void {
    if (this.ended || this.destroyedFlag) return;
    this.ended = true;
    this.abortController.abort();
    this.push(null);
  }
}
