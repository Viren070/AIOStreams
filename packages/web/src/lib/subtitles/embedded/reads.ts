import type { FetchPastCors } from '@/lib/hosts';
import type { ReadPace } from './harvest';
import {
  concat,
  ReadError,
  readsInTurn,
  type ByteReader,
} from '@/lib/byte-reader';

const CHUNK = 512 * 1024;

/** A 2xx here ignored the range. */
const lasting = (status: number) =>
  (status >= 200 && status < 300) ||
  (status >= 400 && status < 500 && status !== 408 && status !== 429);

/** Once `url` redirects, reads go to the target, and back to `url` when that fails, as a signed address expires. */
export function rangeReader(
  url: string,
  headers: Record<string, string> = {},
  fetchFile: FetchPastCors = (address, init) => fetch(address, init)
): ByteReader {
  let target = url;
  /** Null past the end of the file. */
  const ask = async (start: number, end: number) => {
    const asked = target;
    const failed = () => {
      target = url;
    };
    let response: Response;
    try {
      response = await fetchFile(asked, {
        headers: { ...headers, Range: `bytes=${start}-${end}` },
      });
    } catch (error) {
      failed();
      throw new ReadError(String(error), false);
    }
    if (response.redirected) target = response.url;
    if (response.status === 416) {
      void response.body?.cancel();
      return null;
    }
    if (response.status !== 206 && !(response.status === 200 && !start)) {
      failed();
      void response.body?.cancel();
      const seconds = Number(response.headers.get('retry-after'));
      throw new ReadError(
        // eslint-disable-next-line lingui/no-unlocalized-strings -- only logged
        `The host answered ${response.status}`,
        // Where the download host refused, `url` may redirect somewhere it won't.
        asked === url && lasting(response.status),
        seconds > 0 ? seconds * 1000 : 0
      );
    }
    return response;
  };
  return {
    async read(start, length) {
      const size = Math.min(length, CHUNK);
      const response = await ask(start, start + size - 1);
      if (!response) return new Uint8Array();
      const body = response.body?.getReader();
      if (!body) return new Uint8Array(await response.arrayBuffer());
      const parts: Uint8Array[] = [];
      let got = 0;
      try {
        while (got < size) {
          const { done, value } = await body.read();
          if (done) break;
          parts.push(value);
          got += value.length;
        }
      } catch (error) {
        // What came before the cut is kept; the rest is asked for again.
        if (!got) throw new ReadError(String(error), false);
      }
      void body.cancel().catch(() => {});
      return concat(parts, Math.min(got, size));
    },
    async *stream(start, length) {
      const response = await ask(start, start + length - 1);
      if (!response) return;
      const body = response.body?.getReader();
      if (!body) {
        yield new Uint8Array(await response.arrayBuffer());
        return;
      }
      try {
        for (;;) {
          const { done, value } = await body.read().catch((error) => {
            throw new ReadError(String(error), false);
          });
          if (done) return;
          yield value;
        }
      } finally {
        void body.cancel().catch(() => {});
      }
    },
  };
}

const PLAYING_GAP_MS = 334;
/** Inside the 10 reads a second, 3 at once, a debrid CDN was measured to take beside the video. */
const HURRY_GAP_MS = 150;
const HURRY_LANES = 3;
const QUIET_MS = 10_000;
const MAX_QUIET_MS = 60_000;
const MAX_RETRY_AFTER_MS = 120_000;

/** Paced so the host doesn't throttle the video's own stream. */
export class SideReader implements ByteReader, ReadPace {
  lanes = 1;
  private gapMs = PLAYING_GAP_MS;
  private playing = true;
  private hurried = false;
  private running = 0;
  private lastAt = 0;
  private quietUntil = 0;
  private quietMs = 0;
  private timer = 0;
  private closed = false;
  private queue: { go: () => void; stop: (error: Error) => void }[] = [];

  constructor(private readonly source: ByteReader) {}

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.pace();
  }

  hurry(on: boolean): void {
    if (on === this.hurried) return;
    this.hurried = on;
    this.pace();
  }

  private pace(): void {
    this.lanes = this.playing && !this.hurried ? 1 : HURRY_LANES;
    this.gapMs = !this.playing
      ? 0
      : this.hurried
        ? HURRY_GAP_MS
        : PLAYING_GAP_MS;
    this.wake();
  }

  async read(start: number, length: number): Promise<Uint8Array> {
    await new Promise<void>((go, stop) => {
      if (this.closed) return stop(new ReadError('closed', true));
      this.queue.push({ go, stop });
      this.wake();
    });
    try {
      const bytes = await this.source.read(start, length);
      this.quietMs = 0;
      return bytes;
    } catch (error) {
      this.failed(error);
      throw error;
    } finally {
      this.running--;
      this.wake();
    }
  }

  /** Takes no lane, so reads near the playhead still go, but waits out a host that failed. */
  async *stream(start: number, length: number): AsyncGenerator<Uint8Array> {
    if (!this.source.stream) {
      yield* readsInTurn(this, start, length);
      return;
    }
    while (!this.closed && Date.now() < this.quietUntil)
      await new Promise((done) =>
        window.setTimeout(done, this.quietUntil - Date.now())
      );
    if (this.closed) throw new ReadError('closed', true);
    try {
      for await (const bytes of this.source.stream(start, length)) {
        if (this.closed) throw new ReadError('closed', true);
        yield bytes;
      }
      this.quietMs = 0;
    } catch (error) {
      this.failed(error);
      throw error;
    }
  }

  private failed(error: unknown): void {
    if (error instanceof ReadError && error.lasting) return;
    this.quietMs = Math.min(this.quietMs * 2 || QUIET_MS, MAX_QUIET_MS);
    const asked = error instanceof ReadError ? error.retryAfterMs : 0;
    this.quietUntil =
      Date.now() + Math.max(this.quietMs, Math.min(asked, MAX_RETRY_AFTER_MS));
  }

  close(): void {
    this.closed = true;
    window.clearTimeout(this.timer);
    for (const waiting of this.queue.splice(0))
      waiting.stop(new ReadError('closed', true));
  }

  private wake(): void {
    window.clearTimeout(this.timer);
    while (this.queue.length && this.running < this.lanes) {
      const wait =
        Math.max(this.quietUntil, this.lastAt + this.gapMs) - Date.now();
      if (wait > 0) {
        this.timer = window.setTimeout(() => this.wake(), wait);
        return;
      }
      this.running++;
      this.lastAt = Date.now();
      this.queue.shift()!.go();
    }
  }
}
