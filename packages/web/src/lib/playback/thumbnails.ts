import type { PlayerEngine, Thumbnail } from './engine';

/** The seek bar's picture: the newest answer to the positions it asks for, cleared when it stops asking. */
export interface ThumbnailFeed {
  /** Asks for the keyframe at or before `ms`, or with null, for none. */
  want(ms: number | null): void;
  current(): Thumbnail | null;
  subscribe(listener: () => void): () => void;
}

/** Faster pictures don't look smoother, and each costs the app a decode and the page a draw. */
const ASK_MS = 80;

type Open = (
  onThumbnail: (thumbnail: Thumbnail | null) => void
) => ReturnType<NonNullable<PlayerEngine['thumbnails']>>;

export function thumbnailFeed(
  open: Open
): ThumbnailFeed & { prepare(): void; stop(): void } {
  const listeners = new Set<() => void>();
  let current: Thumbnail | null = null;
  let wanted: number | null = null;
  let none = false;
  let asked = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const show = (next: Thumbnail | null) => {
    if (next === current) return;
    current = next;
    for (const listener of listeners) listener();
  };
  const requests = open((thumbnail) => {
    if (!thumbnail) none = true;
    show(wanted === null ? null : thumbnail);
  });
  return {
    want(ms) {
      wanted = ms;
      if (ms === null) return show(null);
      if (none || timer) return;
      const ask = () => {
        timer = undefined;
        asked = performance.now();
        if (wanted !== null) requests.want(wanted, current?.positionMs);
      };
      const wait = asked + ASK_MS - performance.now();
      if (wait <= 0) ask();
      else timer = setTimeout(ask, wait);
    },
    prepare() {
      if (!none) requests.prepare();
    },
    current: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    stop() {
      clearTimeout(timer);
      requests.stop();
    },
  };
}
