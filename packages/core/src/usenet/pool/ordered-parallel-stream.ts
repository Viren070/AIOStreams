import { Readable } from 'node:stream';
import type { Logger } from '../../logging/logger.js';
import { ArticleNotFoundError } from '../nntp/errors.js';

export interface SlotPoolOptions {
  /** Hard cap on pooled slots; beyond it acquire() returns throwaway buffers. */
  slotCap: number;
  /** Floor for the reclaim allowance's largest-slot term. */
  initialMaxSlot: number;
  /** Bytes still queued inside the owning Readable (its `readableLength`). */
  queuedBytes: () => number;
}

/**
 * Per-stream pool of task slot buffers for an {@link OrderedParallelStream}:
 * tasks decode/copy into pooled slots so the steady-state serve path allocates
 * nothing per chunk.
 *
 * A slot may be recycled only once every reference to the bytes written into
 * it is gone; premature reuse is silent corruption. Emission is strictly
 * in-order, so liveness is tracked with a consumption watermark: everything
 * at or before `pushedBytes - queuedBytes() - allowance` has left the owning
 * stream's queue and the small downstream holds. The pool is hard-capped at
 * `slotCap`, so it tracks actual concurrency, not stream length.
 */
export class SlotPool {
  private free: Buffer[] = [];
  private allocated = 0;
  private readonly slotCap: number;
  private readonly queuedBytes: () => number;
  /** Task idx to pooled slot backing its not-yet-reclaimed bytes. */
  private live = new Map<number, Buffer>();
  /** In-order pushed pooled chunks awaiting the consumption watermark. */
  private pushedFifo: Array<{ idx: number; pushedEnd: number }> = [];
  private pushedBytes = 0;
  private maxSlotBytes: number;

  constructor(opts: SlotPoolOptions) {
    this.slotCap = opts.slotCap;
    this.queuedBytes = opts.queuedBytes;
    this.maxSlotBytes = opts.initialMaxSlot;
  }

  /** Check out a slot of at least `need` bytes for task `idx`. */
  acquire(idx: number, need: number): Buffer {
    this.reclaim();
    let buf: Buffer | undefined;
    while ((buf = this.free.pop()) && buf.length < need) {
      // Undersized slot (mixed task sizes): drop it.
      this.allocated--;
    }
    if (!buf) {
      if (this.allocated >= this.slotCap) {
        return Buffer.allocUnsafe(need);
      }
      this.allocated++;
      buf = Buffer.allocUnsafe(need);
    }
    if (buf.length > this.maxSlotBytes) this.maxSlotBytes = buf.length;
    this.live.set(idx, buf);
    return buf;
  }

  /** Return `idx`'s pooled slot to the free list (no-op for throwaways). */
  release(idx: number): void {
    const slot = this.live.get(idx);
    if (slot) {
      this.live.delete(idx);
      this.free.push(slot);
    }
  }

  /** Account a pushed chunk; pooled chunks join the watermark FIFO. */
  recordPush(idx: number, chunkLength: number): void {
    this.pushedBytes += chunkLength;
    if (this.live.has(idx)) {
      this.pushedFifo.push({ idx, pushedEnd: this.pushedBytes });
    }
  }

  /**
   * Free every pooled slot whose chunk has provably been consumed. The
   * allowance covers the downstream holds (at most a relay Readable plus the
   * HTTP writable, each up to its HWM plus one overflow chunk); it must grow
   * if the wiring ever gains a larger buffer layer.
   */
  reclaim(): void {
    if (this.pushedFifo.length === 0) return;
    const allowance = 3 * this.maxSlotBytes + 65536;
    const consumed = this.pushedBytes - this.queuedBytes() - allowance;
    while (
      this.pushedFifo.length > 0 &&
      this.pushedFifo[0].pushedEnd <= consumed
    ) {
      this.release(this.pushedFifo.shift()!.idx);
    }
  }

  /**
   * Drop all bookkeeping on stream destroy; a task settling later still holds
   * its own slot reference and is dropped by the stream's destroyed guard.
   */
  clear(): void {
    this.free = [];
    this.live.clear();
    this.pushedFifo = [];
  }

  /** Test-only introspection. */
  stats(): { allocated: number; free: number; live: number; fifo: number } {
    return {
      allocated: this.allocated,
      free: this.free.length,
      live: this.live.size,
      fifo: this.pushedFifo.length,
    };
  }
}

export interface OrderedParallelStreamOptions {
  highWaterMark: number;
  /** Number of tasks to run (segments / windows). */
  totalTasks: number;
  /** Max tasks in flight at once. */
  maxConcurrency: number;
  /** Soft byte budget for completed-but-not-yet-emitted chunks. */
  maxBufferedBytes: number;
  slotCap: number;
  initialMaxSlot: number;
  /** Subclass logger so log scopes stay per stream kind. */
  logger: Logger;
}

/**
 * Base for the engine's serve-path Readables ({@link SegmentsStream} and
 * {@link ParallelRangeStream}): run up to `maxConcurrency` tasks in parallel,
 * bounded by a byte budget of not-yet-emitted chunks, and emit their results
 * strictly in task order, decoding into {@link SlotPool} slots.
 */
export abstract class OrderedParallelStream extends Readable {
  protected readonly slots: SlotPool;
  /**
   * Set by a subclass during {@link transformChunk} to end the stream after
   * the current chunk; reset by the base before each call.
   */
  protected endAfterChunk = false;

  private readonly totalTasks: number;
  private readonly maxConcurrency: number;
  private readonly maxBufferedBytes: number;
  private readonly logger: Logger;

  private nextDispatch = 0;
  private nextEmit = 0;
  private inflight = 0;
  private buffered = new Map<number, Buffer>();
  private bufferedBytes = 0;
  private paused = false;
  private destroyedFlag = false;
  /** Set once EOF has been pushed. */
  private ended = false;

  protected constructor(opts: OrderedParallelStreamOptions) {
    super({ highWaterMark: opts.highWaterMark });
    this.totalTasks = opts.totalTasks;
    this.maxConcurrency = opts.maxConcurrency;
    this.maxBufferedBytes = opts.maxBufferedBytes;
    this.logger = opts.logger;
    this.slots = new SlotPool({
      slotCap: opts.slotCap,
      initialMaxSlot: opts.initialMaxSlot,
      queuedBytes: () => this.readableLength,
    });
  }

  /**
   * Begin task `idx`. Must eventually settle by calling exactly one of
   * {@link completeTask} / {@link failTask}; settling after destroy/end is
   * tolerated (both guard).
   */
  protected abstract startTask(idx: number): void;

  /**
   * Per-chunk emit hook, called in strict task order: return the buffer to
   * push, or null/empty to push nothing (the base then releases `idx`'s
   * slot). Set {@link endAfterChunk} to end the stream after this chunk.
   */
  protected abstract transformChunk(idx: number, chunk: Buffer): Buffer | null;

  /** Structured log fields identifying task `idx`. */
  protected abstract logContext(idx: number): Record<string, unknown>;

  /** Failures the stream should survive rather than destroy on (e.g. own abort). */
  protected shouldIgnoreTaskError(_err: unknown): boolean {
    return false;
  }

  /** Subclass teardown, run first in {@link _destroy}. */
  protected onDestroy(): void {}

  /** Runs as EOF is pushed. */
  protected onEnd(): void {}

  protected completeTask(idx: number, body: Buffer): void {
    if (this.destroyedFlag || this.ended) return;
    this.inflight--;
    this.buffered.set(idx, body);
    this.bufferedBytes += body.length;
    this.flush();
    this.dispatch();
  }

  protected failTask(idx: number, err: unknown): void {
    if (this.destroyedFlag || this.ended) return;
    this.inflight--;
    if (this.shouldIgnoreTaskError(err)) return;
    this.logger.debug(
      { ...this.logContext(idx), err },
      'ordered stream task failed; destroying stream'
    );
    this.destroy(err instanceof Error ? err : new Error(String(err)));
  }

  /**
   * Approved zero-fill length for task `idx`, or undefined to refuse.
   * Subclasses that support hole padding override this with their geometry
   * (exact segment size / window length) AND their policy-owner consult; the
   * base owns the shared pad-or-destroy flow ({@link settleTaskFailure}).
   */
  protected tryPadHole(_idx: number): number | undefined {
    return undefined;
  }

  /** Zero-fill task `idx` if {@link tryPadHole} approves; true when padded. */
  protected padTask(idx: number): boolean {
    const bytes = this.tryPadHole(idx);
    if (bytes === undefined || bytes <= 0) return false;
    this.logger.warn(
      { ...this.logContext(idx), bytes },
      'task data missing on all providers; zero-filled'
    );
    this.completeTask(idx, Buffer.alloc(bytes));
    return true;
  }

  /**
   * Settle a failed task: a definitive all-providers miss may be zero-filled
   * (exact length only, policy-approved); anything else (transient errors,
   * partial-provider misses, refused pads) destroys the stream.
   */
  protected settleTaskFailure(idx: number, err: unknown): void {
    if (
      err instanceof ArticleNotFoundError &&
      err.allProviders &&
      this.padTask(idx)
    ) {
      return;
    }
    this.failTask(idx, err);
  }

  override _read(): void {
    this.paused = false;
    // Draining may have advanced the watermark.
    this.slots.reclaim();
    this.flush();
    this.dispatch();
  }

  override _destroy(err: Error | null, cb: (e?: Error | null) => void): void {
    this.destroyedFlag = true;
    this.onDestroy();
    this.buffered.clear();
    this.bufferedBytes = 0;
    this.slots.clear();
    cb(err);
  }

  private dispatch(): void {
    while (
      !this.destroyedFlag &&
      !this.ended &&
      this.inflight < this.maxConcurrency &&
      this.nextDispatch < this.totalTasks &&
      this.bufferedBytes < this.maxBufferedBytes
    ) {
      const idx = this.nextDispatch++;
      this.inflight++;
      this.startTask(idx);
    }
  }

  private flush(): void {
    if (this.paused || this.destroyedFlag || this.ended) return;
    while (this.buffered.has(this.nextEmit)) {
      const idx = this.nextEmit;
      const raw = this.buffered.get(idx)!;
      this.buffered.delete(idx);
      this.bufferedBytes -= raw.length;
      this.nextEmit++;

      this.endAfterChunk = false;
      const out = this.transformChunk(idx, raw);

      let more = true;
      if (out === null || out.length === 0) {
        // Never pushed, so no downstream references to the slot.
        this.slots.release(idx);
      } else {
        more = this.push(out);
        this.slots.recordPush(idx, out.length);
      }
      if (this.endAfterChunk) {
        this.finishEnd();
        return;
      }
      if (!more) {
        this.paused = true;
        return;
      }
    }

    if (this.nextEmit >= this.totalTasks && this.inflight === 0) {
      this.finishEnd();
    }
  }

  /** Emit EOF exactly once, running {@link onEnd} first. */
  private finishEnd(): void {
    if (this.ended || this.destroyedFlag) return;
    this.ended = true;
    this.onEnd();
    this.push(null);
  }
}
