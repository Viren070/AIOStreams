import type JASSUB from '@aiostreams/jassub';
import {
  overlayCanvas,
  type PictureSurface,
  type ShownFrame,
  type SubtitleLayer,
} from './surface';

export const canDrawAss = () =>
  typeof Worker === 'function' &&
  typeof WebAssembly === 'object' &&
  typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';

/** A Matroska block's fields and its time in the file. */
export interface AssEvent {
  text: string;
  startMs: number;
  endMs: number;
}

export type AssSource = { url: string } | { header: string };

export interface AssLayer extends SubtitleLayer {
  /** Events libass already has are skipped. */
  addEvents(events: AssEvent[]): void;
  addFonts(fonts: Uint8Array[]): void;
}

/** Fed events this long past are pruned; seeking back feeds them again. */
export const PRUNE_AFTER_MS = 60_000;

export function assLayer(
  surface: PictureSurface,
  source: AssSource,
  start: { delayMs: number; height: number },
  onFail: (error: unknown) => void
): AssLayer {
  const { canvas, place, unwatch } = overlayCanvas(surface);

  let delayMs = start.delayMs;
  let height = start.height;
  let destroyed = false;
  let jassub: JASSUB | null = null;
  let created: JASSUB | null = null;
  let frame: ShownFrame | null = null;
  let stopFrames = () => {};
  let waitingEvents: AssEvent[] = [];
  let waitingFonts: Uint8Array[] = [];
  const feed = (target: JASSUB, events: AssEvent[]) => {
    for (const { text, startMs, endMs } of events)
      void target.renderer.processChunk(text, startMs, endMs - startMs);
  };

  const draw = (repaint = false) => {
    if (!frame || !jassub) return;
    void jassub
      .manualRender({ ...frame, expectedDisplayTime: 0 }, repaint)
      .catch(() => {});
  };
  const onFrame = (next: ShownFrame) => {
    const sized = frame?.width === next.width && frame.height === next.height;
    const same = sized && frame?.mediaTime === next.mediaTime;
    frame = next;
    if (!sized) place();
    if (!same) draw();
  };

  void import('@aiostreams/jassub')
    .then(async ({ default: JASSUB }) => {
      if (destroyed) return;
      created = new JASSUB({
        canvas,
        ...('url' in source
          ? { subUrl: source.url }
          : { subContent: source.header }),
        queryFonts: false,
      });
      created.timeOffset = -delayMs / 1000;
      await created.ready;
      if (destroyed) return;
      void created.renderer.setLinePosition(height);
      if ('header' in source)
        void created.renderer.configurePrune(PRUNE_AFTER_MS);
      if (waitingFonts.length)
        void created.renderer.addFonts(waitingFonts.splice(0));
      feed(created, waitingEvents.splice(0));
      jassub = created;
      stopFrames = surface.frames(onFrame);
    })
    .catch((error: unknown) => {
      if (!destroyed) onFail(error);
    });

  return {
    addEvents(events) {
      if (jassub) feed(jassub, events);
      else waitingEvents.push(...events);
    },
    addFonts(fonts) {
      if (!fonts.length) return;
      if (jassub) void jassub.renderer.addFonts(fonts);
      else waitingFonts.push(...fonts);
    },
    setDelay(ms) {
      delayMs = ms;
      if (created) created.timeOffset = -ms / 1000;
      draw(true);
    },
    setHeight(percent) {
      if (percent === height) return;
      height = percent;
      if (jassub) void jassub.renderer.setLinePosition(percent);
    },
    place,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopFrames();
      unwatch();
      if (created) void created.destroy();
      else canvas.remove();
    },
  };
}
