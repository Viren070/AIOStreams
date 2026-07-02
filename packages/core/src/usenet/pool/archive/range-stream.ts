import { createLogger } from '../../../logging/logger.js';
import { OrderedParallelStream } from '../ordered-parallel-stream.js';

const logger = createLogger('usenet/archive-range');

export interface ParallelRangeStreamOptions {
  /**
   * Random-access into-reader for the source being streamed; each call
   * fetches one window into the destination buffer and may pull one or more
   * NZB segments.
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
 * A Node Readable that serves a byte range from any `readAtInto` source by
 * fetching fixed-size windows in parallel and emitting them strictly in
 * order, giving archive playback the same throughput as direct segment
 * streaming. Boundary windows that share an underlying segment are de-duped
 * by the pool's single-flight, cache and the FileStream segment memo.
 *
 * On destroy, in-flight windows are deliberately left to resolve into the
 * segment cache (warming it for a likely resume or seek), so there is no
 * abort plumbing; their results are dropped by the base's destroyed guard.
 */
export class ParallelRangeStream extends OrderedParallelStream {
  private readAtIntoFn: ParallelRangeStreamOptions['readAtInto'];
  private start: number;
  private end: number;
  private windowBytes: number;

  constructor(opts: ParallelRangeStreamOptions) {
    const start = Math.max(0, opts.start);
    const end = Math.max(start, opts.end);
    const windowBytes = Math.max(1, opts.windowBytes);
    const concurrency = Math.max(1, opts.concurrency);
    const maxBufferedBytes = Math.max(windowBytes, opts.maxBufferedBytes);
    const prefetchWindows = Math.ceil(maxBufferedBytes / windowBytes);
    super({
      highWaterMark: Math.max(1, opts.maxBufferedBytes),
      totalTasks: Math.ceil((end - start) / windowBytes),
      maxConcurrency: concurrency,
      maxBufferedBytes,
      slotCap: 2 * prefetchWindows + 2 * concurrency + 8,
      initialMaxSlot: windowBytes,
      logger,
    });
    this.readAtIntoFn = opts.readAtInto;
    this.start = start;
    this.end = end;
    this.windowBytes = windowBytes;
  }

  private windowOffset(idx: number): number {
    return this.start + idx * this.windowBytes;
  }

  private windowLength(idx: number): number {
    return Math.min(this.windowBytes, this.end - this.windowOffset(idx));
  }

  protected startTask(idx: number): void {
    const slot = this.slots.acquire(idx, this.windowBytes);
    this.readAtIntoFn(slot, 0, this.windowOffset(idx), this.windowLength(idx))
      .then((written) => this.completeTask(idx, slot.subarray(0, written)))
      .catch((err) => this.failTask(idx, err));
  }

  protected transformChunk(idx: number, chunk: Buffer): Buffer | null {
    // An empty window before the planned end means the source hit EOF
    // (truncated stored entry); stop cleanly. A short but non-empty window
    // still pushes normally and EOF arrives with the next zero read.
    if (chunk.length === 0) {
      this.endAfterChunk = true;
      return null;
    }
    return chunk;
  }

  protected logContext(idx: number): Record<string, unknown> {
    return { windowIndex: idx };
  }
}
