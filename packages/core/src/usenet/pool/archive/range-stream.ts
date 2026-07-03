import { createLogger } from '../../../logging/logger.js';
import { OrderedParallelStream } from '../ordered-parallel-stream.js';
import type { HoleDecision } from '../../holes.js';

const logger = createLogger('usenet/archive-range');

export interface ParallelRangeStreamOptions {
  /**
   * Random-access into-reader for the source being streamed; each call
   * fetches one window into the destination buffer and may pull one or more
   * NZB segments. The `signal` fires on destroy/EOF: the window's remaining
   * segment fetches are stale and should stop.
   */
  readAtInto: (
    dst: Buffer,
    dstOffset: number,
    offset: number,
    length: number,
    signal?: AbortSignal
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
  /**
   * Decision hook for a window whose read died on an all-providers 430:
   * `pad` zero-fills the window and keeps streaming, `fail` destroys the
   * stream (legacy behaviour, also used when the hook is absent). Window
   * geometry is byte-exact, so a pad preserves every downstream offset by
   * construction. Offsets are archive-LOGICAL (post-decrypt/assembly) bytes.
   */
  onHole?: (info: {
    windowOffset: number;
    windowLength: number;
  }) => HoleDecision;
}

/**
 * A Node Readable that serves a byte range from any `readAtInto` source by
 * fetching fixed-size windows in parallel and emitting them strictly in
 * order, giving archive playback the same throughput as direct segment
 * streaming. Boundary windows that share an underlying segment are de-duped
 * by the pool's single-flight, cache and the FileStream segment memo.
 *
 * On destroy (seek/disconnect) in-flight windows are aborted: queued segment
 * downloads cancel so stale prefetches do not hold download budget ahead of
 * the follow-up stream, while downloads already on the wire complete into the
 * segment cache for a likely nearby resume. Window results are dropped by the
 * base's destroyed guard.
 */
export class ParallelRangeStream extends OrderedParallelStream {
  private readAtIntoFn: ParallelRangeStreamOptions['readAtInto'];
  private start: number;
  private end: number;
  private windowBytes: number;
  private onHole?: ParallelRangeStreamOptions['onHole'];
  /** Fired on destroy/EOF to stop stale window walks (see class doc). */
  private abortController = new AbortController();

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
    this.onHole = opts.onHole;
  }

  private windowOffset(idx: number): number {
    return this.start + idx * this.windowBytes;
  }

  private windowLength(idx: number): number {
    return Math.min(this.windowBytes, this.end - this.windowOffset(idx));
  }

  protected startTask(idx: number): void {
    const slot = this.slots.acquire(idx, this.windowBytes);
    this.readAtIntoFn(
      slot,
      0,
      this.windowOffset(idx),
      this.windowLength(idx),
      this.abortController.signal
    )
      .then((written) => this.completeTask(idx, slot.subarray(0, written)))
      .catch((err) => this.settleTaskFailure(idx, err));
  }

  protected override shouldIgnoreTaskError(): boolean {
    // Aborted window walks are expected teardown of stale prefetches, not
    // stream errors.
    return this.abortController.signal.aborted;
  }

  protected override onDestroy(): void {
    this.abortController.abort();
  }

  /** Stop still-in-flight window walks once EOF has been pushed. */
  protected override onEnd(): void {
    this.abortController.abort();
  }

  /**
   * Window geometry is byte-exact, so padding the full window length
   * preserves every downstream offset; pad-vs-fail policy (and caps
   * accounting) lives in the owner's hook.
   */
  protected override tryPadHole(idx: number): number | undefined {
    if (!this.onHole) return undefined;
    const len = this.windowLength(idx);
    const decision = this.onHole({
      windowOffset: this.windowOffset(idx),
      windowLength: len,
    });
    return decision === 'pad' ? len : undefined;
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
