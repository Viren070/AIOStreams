import { Readable } from 'node:stream';
import { createLogger } from '../../../logging/logger.js';

const logger = createLogger('usenet/archive-range');

export interface ParallelRangeStreamOptions {
  /**
   * Random-access into-reader for the source being streamed. Each call fetches
   * one window straight into a pooled window buffer; internally it may pull
   * one or more NZB segments, but multiple windows are driven concurrently.
   */
  readAtInto: (
    dst: Buffer,
    dstOffset: number,
    offset: number,
    length: number
  ) => Promise<number>;
  /** Half-open byte range to emit: [start, end). */
  start: number;
  end: number;
  /** Window granularity: roughly one segment so each window ≈ one fetch. */
  windowBytes: number;
  /** Max windows fetched concurrently (the per-stream connection budget). */
  concurrency: number;
  /** Soft cap on buffered (fetched-but-not-yet-emitted) bytes (read-ahead). */
  maxBufferedBytes: number;
}

/**
 * A Node {@link Readable} that serves a byte range from any `readAtInto` source
 * by fetching fixed-size windows **in parallel** (bounded by `concurrency` and a
 * read-ahead byte budget) and emitting them **strictly in order**.
 *
 * Driving multiple windows concurrently gives archive playback the same
 * throughput as direct segment streaming. Boundary windows that share an
 * underlying segment are de-duped by the pool's single-flight + cache + the
 * FileStream segment memo, so there is no wasted network.
 *
 * Windows land in a per-stream pool of reusable buffers, so steady-state
 * playback allocates nothing per window.
 */
export class ParallelRangeStream extends Readable {
  private readAtIntoFn: ParallelRangeStreamOptions['readAtInto'];
  private start: number;
  private end: number;
  private windowBytes: number;
  private concurrency: number;
  private maxBufferedBytes: number;
  private totalWindows: number;

  private nextDispatch = 0;
  private nextEmit = 0;
  private inflight = 0;
  private buffered = new Map<number, Buffer>();
  private bufferedBytes = 0;
  private paused = false;
  private destroyedFlag = false;
  private ended = false;

  /**
   * Per-stream window-buffer pool: free list plus consumption watermark,
   * mirroring SegmentsStream's slot pool (see its doc for the recycling
   * contract; this stream is handed straight to the HTTP writable, so the
   * downstream hold is one small HWM plus one overflow chunk).
   */
  private slotPool: Buffer[] = [];
  private slotsAllocated = 0;
  private readonly slotCap: number;
  private liveSlots = new Map<number, Buffer>();
  private pushedFifo: Array<{ idx: number; pushedEnd: number }> = [];
  private pushedBytes = 0;

  constructor(opts: ParallelRangeStreamOptions) {
    super({ highWaterMark: Math.max(1, opts.maxBufferedBytes) });
    this.readAtIntoFn = opts.readAtInto;
    this.start = Math.max(0, opts.start);
    this.end = Math.max(this.start, opts.end);
    this.windowBytes = Math.max(1, opts.windowBytes);
    this.concurrency = Math.max(1, opts.concurrency);
    this.maxBufferedBytes = Math.max(this.windowBytes, opts.maxBufferedBytes);
    this.totalWindows = Math.ceil((this.end - this.start) / this.windowBytes);
    const prefetchWindows = Math.ceil(this.maxBufferedBytes / this.windowBytes);
    this.slotCap = 2 * prefetchWindows + 2 * this.concurrency + 8;
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
    this.buffered.clear();
    this.bufferedBytes = 0;
    // Drop the pool; an in-flight readAtInto still holds its own slot
    // reference and its result is dropped by the destroyedFlag guard.
    // In-flight reads are intentionally left to resolve into the segment
    // cache (warming it for a likely resume/seek).
    this.slotPool = [];
    this.liveSlots.clear();
    this.pushedFifo = [];
    cb(err);
  }

  private windowOffset(idx: number): number {
    return this.start + idx * this.windowBytes;
  }

  private windowLength(idx: number): number {
    return Math.min(this.windowBytes, this.end - this.windowOffset(idx));
  }

  private acquireSlot(idx: number): Buffer {
    this.reclaimSlots();
    let buf = this.slotPool.pop();
    if (!buf) {
      if (this.slotsAllocated >= this.slotCap) {
        // Deep backpressure: degrade to a throwaway owned buffer instead of
        // growing the pool.
        return Buffer.allocUnsafe(this.windowBytes);
      }
      this.slotsAllocated++;
      buf = Buffer.allocUnsafe(this.windowBytes);
    }
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
   * Free every pooled slot whose window has provably been consumed (left this
   * stream's queue plus the downstream allowance).
   */
  private reclaimSlots(): void {
    if (this.pushedFifo.length === 0) return;
    const allowance = 3 * this.windowBytes + 65536;
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
      this.inflight < this.concurrency &&
      this.nextDispatch < this.totalWindows &&
      this.bufferedBytes < this.maxBufferedBytes
    ) {
      const idx = this.nextDispatch++;
      this.inflight++;
      const slot = this.acquireSlot(idx);
      this.readAtIntoFn(slot, 0, this.windowOffset(idx), this.windowLength(idx))
        .then((written) => {
          if (this.destroyedFlag || this.ended) return;
          this.inflight--;
          const buf = slot.subarray(0, written);
          this.buffered.set(idx, buf);
          this.bufferedBytes += buf.length;
          this.flush();
          this.dispatch();
        })
        .catch((err) => {
          if (this.destroyedFlag || this.ended) return;
          this.inflight--;
          logger.debug(
            { windowIndex: idx, err: (err as Error)?.message },
            'archive range window failed; destroying stream'
          );
          this.destroy(err instanceof Error ? err : new Error(String(err)));
        });
    }
  }

  private flush(): void {
    if (this.paused || this.destroyedFlag || this.ended) return;
    while (this.buffered.has(this.nextEmit)) {
      const chunk = this.buffered.get(this.nextEmit)!;
      this.buffered.delete(this.nextEmit);
      this.bufferedBytes -= chunk.length;
      this.nextEmit++;

      // A short/empty window before the planned end means the source hit EOF
      // (truncated stored entry); emit what we have and stop cleanly.
      if (chunk.length === 0) {
        this.releaseSlot(this.nextEmit - 1);
        this.finishEnd();
        return;
      }
      const more = this.push(chunk);
      this.pushedBytes += chunk.length;
      if (this.liveSlots.has(this.nextEmit - 1)) {
        this.pushedFifo.push({
          idx: this.nextEmit - 1,
          pushedEnd: this.pushedBytes,
        });
      }
      if (!more) {
        this.paused = true;
        return;
      }
    }

    if (this.nextEmit >= this.totalWindows && this.inflight === 0) {
      this.finishEnd();
    }
  }

  private finishEnd(): void {
    if (this.ended) return;
    this.ended = true;
    this.push(null);
  }
}
