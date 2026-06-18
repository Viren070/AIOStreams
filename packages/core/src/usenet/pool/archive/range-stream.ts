import { Readable } from 'node:stream';
import { createLogger } from '../../../logging/logger.js';

const logger = createLogger('usenet/archive-range');

export interface ParallelRangeStreamOptions {
  /**
   * Random-access reader for the source being streamed (an
   * {@link ../file-stream.js#SeekableStream} `readAt`, an
   * {@link ./inner-stream.js#ArchiveInnerStream} `readAt`, ...). Each call fetches
   * one window; internally it may pull one or more NZB segments, but multiple
   * windows are driven **concurrently** by this stream.
   */
  readAt: (offset: number, length: number) => Promise<Buffer>;
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
 * A Node {@link Readable} that serves a byte range from any `readAt` source by
 * fetching fixed-size windows **in parallel** (bounded by `concurrency` and a
 * read-ahead byte budget) and emitting them **strictly in order**.
 *
 * Driving multiple `readAt` windows concurrently gives archive playback the same
 * throughput as direct segment streaming. Boundary windows that share an underlying
 * segment are de-duped by the pool's single-flight + cache, so there is no
 * wasted network.
 */
export class ParallelRangeStream extends Readable {
  private readAtFn: ParallelRangeStreamOptions['readAt'];
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

  constructor(opts: ParallelRangeStreamOptions) {
    super({ highWaterMark: Math.max(1, opts.maxBufferedBytes) });
    this.readAtFn = opts.readAt;
    this.start = Math.max(0, opts.start);
    this.end = Math.max(this.start, opts.end);
    this.windowBytes = Math.max(1, opts.windowBytes);
    this.concurrency = Math.max(1, opts.concurrency);
    this.maxBufferedBytes = Math.max(this.windowBytes, opts.maxBufferedBytes);
    this.totalWindows = Math.ceil((this.end - this.start) / this.windowBytes);
  }

  override _read(): void {
    this.paused = false;
    this.flush();
    this.dispatch();
  }

  override _destroy(err: Error | null, cb: (e?: Error | null) => void): void {
    this.destroyedFlag = true;
    this.buffered.clear();
    this.bufferedBytes = 0;
    // In-flight readAts are intentionally left to resolve into the segment
    // cache (warming it for a likely resume/seek); they hold no consumer signal.
    cb(err);
  }

  private windowOffset(idx: number): number {
    return this.start + idx * this.windowBytes;
  }

  private windowLength(idx: number): number {
    return Math.min(this.windowBytes, this.end - this.windowOffset(idx));
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
      this.readAtFn(this.windowOffset(idx), this.windowLength(idx))
        .then((buf) => {
          if (this.destroyedFlag) return;
          this.inflight--;
          this.buffered.set(idx, buf);
          this.bufferedBytes += buf.length;
          this.flush();
          this.dispatch();
        })
        .catch((err) => {
          if (this.destroyedFlag) return;
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
        this.finishEnd();
        return;
      }
      const more = this.push(chunk);
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
