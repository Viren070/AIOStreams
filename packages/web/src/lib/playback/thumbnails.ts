import type { PlayerEngine, Thumbnail } from './engine';

/** The seek bar's picture: the newest answer to the positions it asks for, cleared when it stops asking. */
export interface ThumbnailFeed {
  /** Asks for the keyframe at or before `ms`, or with null, for none. */
  want(ms: number | null): void;
  current(): Thumbnail | null;
  /** Asks for a picture at each of `positions`, nearest `focusMs` first, or with null, for none. */
  wantRow(positions: number[] | null, focusMs?: number): void;
  /** The row's pictures by position, or null when the file has none. */
  row(): ReadonlyMap<number, Thumbnail> | null;
  subscribe(listener: () => void): () => void;
}

/** Faster pictures don't look smoother, and each costs the app a decode and the page a draw. */
const ASK_MS = 80;
/** How long a row waits on a picture before moving on without it. */
const ROW_WAIT_MS = 5000;
/** Pictures a row keeps for positions it no longer shows, for going back. */
const ROW_KEPT = 16;

type Open = (
  onThumbnail: (thumbnail: Thumbnail | null) => void
) => ReturnType<NonNullable<PlayerEngine['thumbnails']>>;

export function thumbnailFeed(
  open: Open
): ThumbnailFeed & { prepare(): void; stop(): void } {
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  let current: Thumbnail | null = null;
  let wanted: number | null = null;
  let none = false;
  let asked = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A row asks one position at a time, since the app answers only the newest.
  let rowWanted: number[] = [];
  let row = new Map<number, Thumbnail>();
  let rowAsking: number | null = null;
  let rowTimer: ReturnType<typeof setTimeout> | undefined;
  const rowSkipped = new Set<number>();
  const show = (next: Thumbnail | null) => {
    if (next === current) return;
    current = next;
    notify();
  };
  const askRow = () => {
    if (rowAsking !== null || none) return;
    const next = rowWanted.find((p) => !row.has(p) && !rowSkipped.has(p));
    if (next === undefined) return;
    rowAsking = next;
    rowTimer = setTimeout(() => {
      rowSkipped.add(next);
      rowAsking = null;
      askRow();
    }, ROW_WAIT_MS);
    requests.want(next);
  };
  const requests = open((thumbnail) => {
    if (!thumbnail) none = true;
    if (rowAsking === null) return show(wanted === null ? null : thumbnail);
    clearTimeout(rowTimer);
    if (thumbnail) row = new Map(row).set(rowAsking, thumbnail);
    rowAsking = null;
    notify();
    askRow();
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
    wantRow(positions, focusMs = 0) {
      if (!positions) {
        rowWanted = [];
        rowSkipped.clear();
        if (row.size) row = new Map();
        return;
      }
      rowWanted = [...positions].sort(
        (a, b) => Math.abs(a - focusMs) - Math.abs(b - focusMs)
      );
      const stale = [...row.keys()].filter((p) => !positions.includes(p));
      if (stale.length > ROW_KEPT) {
        row = new Map(row);
        for (const p of stale.slice(0, stale.length - ROW_KEPT)) row.delete(p);
      }
      askRow();
    },
    row: () => (none ? null : row),
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
      clearTimeout(rowTimer);
      requests.stop();
    },
  };
}
