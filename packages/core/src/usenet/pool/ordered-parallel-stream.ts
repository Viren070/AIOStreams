import { Readable, addAbortSignal } from 'node:stream';
import type { Logger } from '../../logging/logger.js';
import { definitiveLossKind } from '../nntp/errors.js';
import type { HoleKind } from '../holes.js';
import { roundSlotSize } from './slot-size.js';
import type { SlotBank } from './slot-bank.js';

/**
 * Read-ahead budget floor, in tasks. Keeps the link busy until the first task
 * lands without splitting it away from that task (1 idles the link, 8 costs
 * first-byte latency).
 */
const FLOOR_TASKS = 4;

export interface SlotPoolOptions {
  /**
   * Hard cap on pooled slots; beyond it acquire() returns throwaway buffers.
   * Size it for everything live at once: reorder buffer, in flight, the
   * Readable's queue and the reclaim allowance.
   */
  slotCap: number;
  /** Floor for the reclaim allowance's largest-slot term. */
  initialMaxSlot: number;
  /** Bytes still queued inside the owning Readable (its `readableLength`). */
  queuedBytes: () => number;
  bank?: SlotBank;
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
  private readonly bank?: SlotBank;
  private destroyed = false;
  private retireRequested = false;

  constructor(opts: SlotPoolOptions) {
    this.slotCap = opts.slotCap;
    this.queuedBytes = opts.queuedBytes;
    this.maxSlotBytes = opts.initialMaxSlot;
    this.bank = opts.bank;
  }

  /** Check out a slot of at least `need` bytes for task `idx`. */
  acquire(idx: number, need: number): Buffer {
    this.reclaim();
    const size = roundSlotSize(need);
    // Smallest free slot that fits; on a miss one undersized slot is dropped
    // so the pool converges on the larger size rather than growing.
    let best = -1;
    for (let i = 0; i < this.free.length; i++) {
      const len = this.free[i].length;
      if (len >= size && (best < 0 || len < this.free[best].length)) best = i;
    }
    let buf: Buffer;
    if (best >= 0) {
      buf = this.free.splice(best, 1)[0];
    } else {
      const dropped = this.free.pop();
      if (dropped) {
        this.allocated--;
        this.bank?.give(dropped);
      }
      if (this.allocated >= this.slotCap) {
        return Buffer.allocUnsafe(need);
      }
      this.allocated++;
      buf = this.bank?.take(size) ?? Buffer.allocUnsafe(size);
    }
    if (buf.length > this.maxSlotBytes) this.maxSlotBytes = buf.length;
    this.live.set(idx, buf);
    return buf;
  }

  /**
   * Return `idx`'s pooled slot to the free list, or to the bank once the
   * stream is destroyed (no-op for throwaways).
   */
  release(idx: number): void {
    const slot = this.live.get(idx);
    if (slot) {
      this.live.delete(idx);
      if (this.destroyed) this.bank?.give(slot);
      else this.free.push(slot);
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
   * allowance covers the downstream holds (a relay Readable, the optional
   * Matroska hole-fill Transform's writable + readable queues, and the HTTP
   * writable, each up to its HWM plus one overflow chunk); it must grow if
   * the wiring ever gains a larger buffer layer.
   */
  reclaim(): void {
    if (this.pushedFifo.length === 0) return;
    const allowance = 5 * this.maxSlotBytes + 65536;
    const consumed = this.pushedBytes - this.queuedBytes() - allowance;
    while (
      this.pushedFifo.length > 0 &&
      this.pushedFifo[0].pushedEnd <= consumed
    ) {
      this.release(this.pushedFifo.shift()!.idx);
    }
  }

  /**
   * Stream destroy. Only slots nothing can still reference are banked now:
   * the free list and `unemitted` completed chunks. In-flight slots follow
   * when their task settles ({@link release}), pushed chunks when the
   * consumer is done ({@link retire})
   */
  destroy(unemitted: Iterable<number>): void {
    this.destroyed = true;
    for (const slot of this.free) this.bank?.give(slot);
    this.free = [];
    for (const idx of unemitted) this.release(idx);
    if (this.retireRequested) this.retire();
  }

  /**
   * The consumer holds no pushed chunk any more. Pending socket writes may
   * still read a pushed slot until its response has closed, so this is the
   * only safe point to recycle them.
   */
  retire(): void {
    if (!this.destroyed) {
      this.retireRequested = true;
      return;
    }
    for (const { idx } of this.pushedFifo) this.release(idx);
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
  /** Nominal bytes per task, for the read-ahead budget. */
  taskBytes: number;
  /** Subclass logger so log scopes stay per stream kind. */
  logger: Logger;
  slotBank?: SlotBank;
  /** See SeekableStream.createReadStream. */
  signal?: AbortSignal;
}

/**
 * Base for the engine's serve-path Readables ({@link SegmentsStream} and
 * {@link ParallelRangeStream}): run up to `maxConcurrency` tasks in parallel
 * under a read-ahead budget (see {@link dispatch}) and emit their results
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
  private readonly taskBytes: number;
  private readonly maxBufferedBytes: number;
  private readonly logger: Logger;

  private nextDispatch = 0;
  private nextEmit = 0;
  private inflight = 0;
  private buffered = new Map<number, Buffer>();
  private bufferedBytes = 0;
  private paused = false;
  private pushedBytes = 0;
  private destroyedFlag = false;
  /** Set once EOF has been pushed. */
  private ended = false;

  protected constructor(opts: OrderedParallelStreamOptions) {
    super({ highWaterMark: Math.max(1, Math.ceil(opts.highWaterMark)) });
    this.totalTasks = opts.totalTasks;
    this.maxConcurrency = opts.maxConcurrency;
    this.taskBytes = Math.max(1, opts.taskBytes);
    this.maxBufferedBytes = opts.maxBufferedBytes;
    this.logger = opts.logger;
    this.slots = new SlotPool({
      slotCap: opts.slotCap,
      initialMaxSlot: opts.initialMaxSlot,
      queuedBytes: () => this.readableLength,
      bank: opts.slotBank,
    });
    if (opts.signal) {
      addAbortSignal(opts.signal, this);
      opts.signal.addEventListener('abort', () => this.slots.retire(), {
        once: true,
      });
    }
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
    if (this.destroyedFlag || this.ended) {
      this.slots.release(idx);
      return;
    }
    this.inflight--;
    this.buffered.set(idx, body);
    this.bufferedBytes += body.length;
    this.flush();
    this.dispatch();
  }

  protected failTask(idx: number, err: unknown): void {
    if (this.destroyedFlag || this.ended) {
      this.slots.release(idx);
      return;
    }
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
  protected tryPadHole(_idx: number, _kind: HoleKind): number | undefined {
    return undefined;
  }

  /** Zero-fill task `idx` if {@link tryPadHole} approves; true when padded. */
  protected padTask(idx: number, kind: HoleKind): boolean {
    const bytes = this.tryPadHole(idx, kind);
    if (bytes === undefined || bytes <= 0) return false;
    this.logger.warn(
      { ...this.logContext(idx), bytes, kind },
      kind === 'undecodable'
        ? 'task data undecodable on all providers; zero-filled'
        : 'task data missing on all providers; zero-filled'
    );
    this.completeTask(idx, Buffer.alloc(bytes));
    return true;
  }

  /**
   * Settle a failed task: a definitive all-providers verdict may be zero-filled
   * (exact length only, policy-approved); anything else (transient errors,
   * partial-provider misses, refused pads) destroys the stream.
   */
  protected settleTaskFailure(idx: number, err: unknown): void {
    const kind = definitiveLossKind(err);
    if (kind !== undefined && this.padTask(idx, kind)) return;
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
    this.slots.destroy(this.buffered.keys());
    this.buffered.clear();
    this.bufferedBytes = 0;
    cb(err);
  }

  /**
   * Read-ahead budget: bytes in flight plus settled-but-unemitted bytes may
   * not exceed what the consumer has taken so far, between a floor and the
   * full window plus reorder buffer.
   */
  private dispatch(): void {
    const budget = Math.min(
      this.maxConcurrency * this.taskBytes + this.maxBufferedBytes,
      Math.max(FLOOR_TASKS * this.taskBytes, this.pushedBytes)
    );
    while (
      !this.destroyedFlag &&
      !this.ended &&
      this.inflight < this.maxConcurrency &&
      this.nextDispatch < this.totalTasks &&
      this.bufferedBytes + this.inflight * this.taskBytes < budget
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
        this.pushedBytes += out.length;
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
