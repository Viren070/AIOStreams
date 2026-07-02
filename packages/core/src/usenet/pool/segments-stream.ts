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
   * Per-stream decode slot pool: fetches decode into pooled slots so the
   * steady-state serve path allocates nothing per article.
   *
   * Recycling is load-bearing (premature reuse is silent corruption): a slot
   * may be recycled only once every reference to the body decoded into it is
   * gone. Emission is strictly in-order, so liveness is tracked with a
   * consumption watermark: each pushed pooled chunk records its cumulative
   * pushed-byte end (`pushedFifo`), and everything at or before
   * `pushedBytes - readableLength - allowance` has left both this stream's
   * queue and the small downstream holds (relay Readable and HTTP writable
   * each hold at most their small HWM plus one overflow chunk). Slots are
   * acquired lazily at decode time (never for cache hits, never while queued
   * on the semaphore), returned on the watermark / full-skip / owned-body
   * resolution, and hard-capped at `slotCap`, beyond which decodes fall back
   * to throwaway owned buffers; the pool therefore tracks actual concurrency,
   * not stream length.
   */
  private slotPool: Buffer[] = [];
  private slotsAllocated = 0;
  private readonly slotCap: number;
  /** dispatch idx → pooled slot backing its (not yet reclaimed) body. */
  private liveSlots = new Map<number, Buffer>();
  /** In-order pushed pooled chunks awaiting the consumption watermark. */
  private pushedFifo: Array<{ idx: number; pushedEnd: number }> = [];
  private pushedBytes = 0;
  private maxSlotBytes = 1 << 20;
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
    this.nzbHash = opts.nzbHash;
    this.maxWorkers = Math.max(1, opts.maxWorkers);
    this.slotCap = 4 * this.maxWorkers + 16;
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
    // Draining may have advanced the watermark.
    this.reclaimSlots();
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
    // Drop the pool; a fetch resolving after destroy still holds its own slot
    // reference and hits the destroyedFlag guard in dispatch().
    this.slotPool = [];
    this.liveSlots.clear();
    this.pushedFifo = [];
    cb(err);
  }

  /**
   * Check out a decode slot for dispatch index `idx`, sized by `encodedBytes`
   * (the raw article size, an upper bound on the decoded size). When that is
   * absent or under-declared, `decodeArticle` falls back to an owned buffer.
   */
  private acquireSlot(idx: number, encodedBytes?: number): Buffer {
    const need = Math.max(1 << 20, encodedBytes ?? 0);
    this.reclaimSlots();
    let buf: Buffer | undefined;
    while ((buf = this.slotPool.pop()) && buf.length < need) {
      // Undersized slot (mixed part sizes): drop it.
      this.slotsAllocated--;
    }
    if (!buf) {
      if (this.slotsAllocated >= this.slotCap) {
        // Deep backpressure: degrade to a throwaway owned buffer instead of
        // growing the pool.
        return Buffer.allocUnsafe(need);
      }
      this.slotsAllocated++;
      buf = Buffer.allocUnsafe(need);
    }
    if (buf.length > this.maxSlotBytes) this.maxSlotBytes = buf.length;
    this.liveSlots.set(idx, buf);
    return buf;
  }

  /** Return `idx`'s pooled slot to the free list (no-op for throwaways). */
  private releaseSlot(idx: number): void {
    const slot = this.liveSlots.get(idx);
    if (slot) {
      this.liveSlots.delete(idx);
      this.slotPool.push(slot);
    }
  }

  /**
   * Free every pooled slot whose chunk has provably been consumed (see the
   * slot pool doc). If the downstream wiring ever gains a larger-than-HWM
   * buffer layer, the allowance must grow with it.
   */
  private reclaimSlots(): void {
    if (this.pushedFifo.length === 0) return;
    const allowance = 3 * this.maxSlotBytes + 65536;
    const consumed = this.pushedBytes - this.readableLength - allowance;
    while (
      this.pushedFifo.length > 0 &&
      this.pushedFifo[0].pushedEnd <= consumed
    ) {
      this.releaseSlot(this.pushedFifo.shift()!.idx);
    }
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
      // The slot provider is idempotent across failover retries.
      let slot: Buffer | undefined;
      this.pool
        .fetchSegmentInto(
          segment,
          this.nzbHash,
          this.abortController.signal,
          this.priority,
          () => (slot ??= this.acquireSlot(idx, segment.bytes))
        )
        .then((data) => {
          if (this.destroyedFlag || this.ended) return;
          this.inflight--;
          // Return the slot if the fetch resolved with an owned body (cache
          // hit / oversized decode).
          if (slot && data.body.buffer !== slot.buffer) this.releaseSlot(idx);
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
      const emitIdx = this.nextEmit;
      let chunk = this.buffered.get(emitIdx)!;
      this.buffered.delete(emitIdx);
      this.bufferedBytes -= chunk.length;
      this.nextEmit++;

      // Discard leading bytes if seeking into the middle of the first segment.
      if (this.skipRemaining > 0) {
        if (chunk.length <= this.skipRemaining) {
          this.skipRemaining -= chunk.length;
          // Never pushed: the slot has no downstream references.
          this.releaseSlot(emitIdx);
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

      let more = true;
      if (chunk.length === 0) {
        this.releaseSlot(emitIdx);
      } else {
        more = this.push(chunk);
        this.pushedBytes += chunk.length;
        if (this.liveSlots.has(emitIdx)) {
          this.pushedFifo.push({ idx: emitIdx, pushedEnd: this.pushedBytes });
        }
      }

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
