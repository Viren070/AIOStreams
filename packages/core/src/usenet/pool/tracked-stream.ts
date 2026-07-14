import { Readable } from 'node:stream';
import { StatsAccumulator } from '../stats/accumulator.js';
import { SeekableStream } from './file-stream.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('usenet/tracked-stream');

/**
 * The engine force-closed a read stream
 */
export class UsenetStreamReapedError extends Error {
  readonly code = 'USENET_STREAM_REAPED';
}

/**
 * Destroy every tracked reader that has pushed no bytes for `thresholdMs`.
 * Cleanup then flows through the reader's own 'close' handler (the one
 * registered at open), so there is no second bookkeeping path. Returns the
 * number of readers reaped.
 */
export function reapIdleStreams(
  stats: StatsAccumulator,
  liveReaders: ReadonlyMap<number, Readable>,
  thresholdMs: number,
  now = Date.now()
): number {
  let reaped = 0;
  for (const idle of stats.idleStreams(thresholdMs, now)) {
    const reader = liveReaders.get(idle.id);
    if (!reader || reader.destroyed) continue;
    logger.warn(
      {
        id: idle.id,
        filename: idle.filename,
        nzbHash: idle.nzbHash,
        idleMs: idle.idleMs,
        bytesServed: idle.bytesServed,
      },
      'reaping idle usenet stream'
    );
    reader.destroy(
      new UsenetStreamReapedError(
        `stream idle for ${Math.round(idle.idleMs / 1000)}s`
      )
    );
    reaped++;
  }
  return reaped;
}

/**
 * Wrap a {@link SeekableStream} handed out by the engine so every read stream
 * opened on it is registered with the engine's {@link StatsAccumulator}: the
 * live "Streams" dashboard view and the active-stream gauge. Registration
 * lives at this single choke point so plain files and archive inner streams
 * are counted uniformly; the engine's internal per-volume streams (opened
 * directly, not through the public open methods) stay untracked.
 */
export function trackSeekableStream(
  stream: SeekableStream,
  stats: StatsAccumulator,
  nzbHash: string,
  liveReaders?: Map<number, Readable>
): SeekableStream {
  return new TrackedSeekableStream(stream, stats, nzbHash, liveReaders);
}

class TrackedSeekableStream implements SeekableStream {
  constructor(
    private readonly inner: SeekableStream,
    private readonly stats: StatsAccumulator,
    private readonly nzbHash: string,
    private readonly liveReaders?: Map<number, Readable>
  ) {}

  get filename(): string | undefined {
    return this.inner.filename;
  }

  size(): number {
    return this.inner.size();
  }

  open(signal?: AbortSignal): Promise<void> {
    return this.inner.open(signal);
  }

  readAt(offset: number, length: number): Promise<Buffer> {
    return this.inner.readAt(offset, length);
  }

  readAtInto(
    dst: Buffer,
    dstOffset: number,
    offset: number,
    length: number
  ): Promise<number> {
    if (this.inner.readAtInto) {
      return this.inner.readAtInto(dst, dstOffset, offset, length);
    }
    return this.inner.readAt(offset, length).then((buf) => {
      buf.copy(dst, dstOffset);
      return buf.length;
    });
  }

  createReadStream(range?: { start?: number; end?: number }): Readable {
    const out = this.inner.createReadStream(range);
    const id = this.stats.streamOpened({
      nzbHash: this.nzbHash,
      filename: this.inner.filename,
      size: this.inner.size(),
      start: Math.max(0, range?.start ?? 0),
    });
    // Count served bytes by intercepting push() rather than listening to
    // 'data', which would flip the stream into flowing mode before the real
    // consumer attaches and lose chunks.
    const push = out.push.bind(out);
    out.push = (chunk: unknown, encoding?: BufferEncoding): boolean => {
      const length = (chunk as { length?: number } | null)?.length;
      if (typeof length === 'number' && length > 0) {
        this.stats.streamBytes(id, length);
      }
      return push(chunk, encoding);
    };
    this.liveReaders?.set(id, out);
    // 'close' always follows end/destroy (autoDestroy default), so neither
    // the gauge nor the live-reader registry can leak an open entry as long
    // as the reader is eventually destroyed; the engine's idle reaper is the
    // backstop for readers whose response socket never closes.
    out.once('close', () => {
      this.liveReaders?.delete(id);
      this.stats.streamClosed(id);
    });
    return out;
  }
}
