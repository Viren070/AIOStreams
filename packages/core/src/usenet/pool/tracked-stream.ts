import { Readable } from 'node:stream';
import { StatsAccumulator } from '../stats/accumulator.js';
import { SeekableStream } from './file-stream.js';

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
  nzbHash: string
): SeekableStream {
  return new TrackedSeekableStream(stream, stats, nzbHash);
}

class TrackedSeekableStream implements SeekableStream {
  constructor(
    private readonly inner: SeekableStream,
    private readonly stats: StatsAccumulator,
    private readonly nzbHash: string
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
    // 'close' always follows end/destroy (autoDestroy default), so the gauge
    // can't leak an open entry.
    out.once('close', () => this.stats.streamClosed(id));
    return out;
  }
}
