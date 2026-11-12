import { PRUNE_AFTER_MS } from '@/lib/subtitles/libass';
import { startsEpoch } from './display-set';
import { PgsSets, type DrawnSet } from './sets';
import type { PgsReply, PgsRequest } from './worker';
import {
  overlayCanvas,
  type PictureSurface,
  type ShownFrame,
  type SubtitleLayer,
} from '@/lib/subtitles/surface';

export interface PictureEvent {
  startMs: number;
  endMs: number;
  data: Uint8Array;
}

export interface PgsLayer extends SubtitleLayer {
  addEvents(events: PictureEvent[]): void;
}

interface Kept extends PictureEvent {
  epochStart: boolean;
}

interface Decoder {
  add(events: PictureEvent[]): void;
  drop(startMs: number): void;
  draw(startMs: number): Promise<DrawnSet | null>;
  close(): void;
}

function pageDecoder(): Decoder {
  const sets = new PgsSets();
  return {
    add: (events) => sets.add(events),
    drop: (startMs) => sets.drop(startMs),
    draw: (startMs) => sets.draw(startMs).catch(() => null),
    close() {},
  };
}

function workerDecoder(failed: () => void): Decoder | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url));
  } catch {
    return null;
  }
  let asked = 0;
  const waiting = new Map<number, (drawn: DrawnSet | null) => void>();
  worker.onmessage = ({ data }: MessageEvent<PgsReply>) => {
    waiting.get(data.id)?.(data.drawn);
    waiting.delete(data.id);
  };
  worker.onerror = () => {
    for (const done of waiting.values()) done(null);
    waiting.clear();
    worker.terminate();
    failed();
  };
  const post = (request: PgsRequest, transfer: Transferable[] = []) =>
    worker.postMessage(request, transfer);
  return {
    add(events) {
      // A block is a view into a bigger read, which would be copied whole.
      const add = events.map(({ startMs, data }) => ({
        startMs,
        data: data.slice(),
      }));
      post(
        { add },
        add.map(({ data }) => data.buffer)
      );
    },
    drop: (startMs) => post({ drop: startMs }),
    draw: (startMs) =>
      new Promise((resolve) => {
        const id = ++asked;
        waiting.set(id, resolve);
        post({ draw: startMs, id });
      }),
    close: () => worker.terminate(),
  };
}

const release = (drawn: DrawnSet | null | undefined) => {
  for (const { image } of drawn?.pictures ?? []) image.close();
};

export function pgsLayer(
  surface: PictureSurface,
  start: { delayMs: number; height: number }
): PgsLayer {
  const { canvas, place, box, unwatch } = overlayCanvas(surface, () => {
    painted = '';
    paint();
  });
  const context = canvas.getContext('2d');
  let delayMs = start.delayMs;
  let height = start.height;
  let frame: ShownFrame | null = null;
  // In time order.
  let kept: Kept[] = [];
  // By start; only those near the playhead stay.
  const drawn = new Map<number, DrawnSet | null>();
  const asked = new Set<number>();
  let painted = '';
  let destroyed = false;

  const forget = (startMs: number) => {
    release(drawn.get(startMs));
    drawn.delete(startMs);
    asked.delete(startMs);
  };
  let decoder: Decoder =
    workerDecoder(() => {
      if (destroyed) return;
      decoder = pageDecoder();
      decoder.add(kept);
      for (const startMs of [...drawn.keys(), ...asked]) forget(startMs);
      painted = '';
      paint();
    }) ?? pageDecoder();

  const showing = (ms: number) => {
    let at = -1;
    for (let i = 0; i < kept.length && kept[i].startMs <= ms; i++) at = i;
    // A set shows until the next, or for as long as its block says without one.
    const end = kept[at + 1]?.startMs ?? kept[at]?.endMs;
    return at >= 0 && ms < end ? at : -1;
  };

  const ask = (startMs: number) => {
    if (drawn.has(startMs) || asked.has(startMs)) return;
    asked.add(startMs);
    const from = decoder;
    void from.draw(startMs).then((result) => {
      if (from !== decoder || destroyed || !asked.delete(startMs))
        return release(result);
      drawn.set(startMs, result);
      painted = '';
      paint();
    });
  };

  const paint = () => {
    if (!frame || !context) return;
    const ms = frame.mediaTime * 1000 - delayMs;
    const at = showing(ms);
    const entry = kept[at];
    // The one showing, and the next ready before its time.
    const next = kept.find((k) => k.startMs > ms);
    for (const startMs of drawn.keys())
      if (startMs !== entry?.startMs && startMs !== next?.startMs)
        forget(startMs);
    if (entry) ask(entry.startMs);
    if (next) ask(next.startMs);
    const shown = entry ? drawn.get(entry.startMs) : null;
    const { width: wide, height: high } = box();
    const scale = window.devicePixelRatio || 1;
    const width = Math.round(wide * scale);
    const tall = Math.round(high * scale);
    const key = `${entry?.startMs}:${shown ? 'drawn' : 'none'}:${width}x${tall}:${height}`;
    if (key === painted) return;
    painted = key;
    if (canvas.width !== width || canvas.height !== tall) {
      canvas.width = width;
      canvas.height = tall;
    } else context.clearRect(0, 0, width, tall);
    if (!shown) return;
    const sx = width / shown.width;
    const sy = tall / shown.height;
    // Lower-half pictures lift with the other subtitles.
    const lift = (height / 100) * tall;
    for (const { x, y, image } of shown.pictures) {
      const low = y + image.height / 2 > shown.height / 2;
      context.drawImage(
        image,
        x * sx,
        y * sy - (low ? lift : 0),
        image.width * sx,
        image.height * sy
      );
    }
  };

  /** From an epoch start, so later sets keep their palettes and pictures. */
  const prune = (ms: number) => {
    let cut = 0;
    for (let i = 1; i < kept.length && kept[i].endMs < ms - PRUNE_AFTER_MS; i++)
      if (kept[i].epochStart) cut = i;
    if (!cut) return;
    for (const { startMs } of kept.slice(0, cut)) forget(startMs);
    kept = kept.slice(cut);
    decoder.drop(kept[0].startMs);
  };

  let size = '';
  const stopFrames = surface.frames((next) => {
    frame = next;
    const nextSize = `${next.width}x${next.height}`;
    if (nextSize !== size) {
      size = nextSize;
      place();
    }
    paint();
    prune(next.mediaTime * 1000 - delayMs);
  });

  return {
    addEvents(events) {
      const fresh = events.filter(
        (e) => !kept.some((k) => k.startMs === e.startMs)
      );
      if (!fresh.length) return;
      kept.push(
        ...fresh.map((e) => ({ ...e, epochStart: startsEpoch(e.data) }))
      );
      kept.sort((a, b) => a.startMs - b.startMs);
      decoder.add(fresh);
      // A set drawn before an earlier one in its epoch arrived may lack its pictures.
      const from = Math.min(...fresh.map((e) => e.startMs));
      for (const startMs of [...drawn.keys(), ...asked])
        if (startMs >= from) forget(startMs);
      painted = '';
      paint();
    },
    setDelay(ms) {
      delayMs = ms;
      paint();
    },
    setHeight(percent) {
      height = percent;
      paint();
    },
    place,
    destroy() {
      destroyed = true;
      stopFrames();
      unwatch();
      decoder.close();
      for (const startMs of [...drawn.keys()]) forget(startMs);
      canvas.remove();
    },
  };
}
