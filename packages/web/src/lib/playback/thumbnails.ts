import { blobAddress, type BlobAddress } from '../artwork';
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
  /** As `wantRow`, but only while nothing else asks, and kept until the feed stops. */
  keep(positions: number[], focusMs?: number): void;
  /** The kept pictures by position, or null when the file has none. */
  kept(): ReadonlyMap<number, Thumbnail> | null;
  subscribe(listener: () => void): () => void;
}

/** Faster pictures don't look smoother, and each costs the app a decode and the page a draw. */
const ASK_MS = 80;
/** How long a row waits on a picture before moving on without it. */
const ROW_WAIT_MS = 5000;
/** Pictures a row keeps for positions it no longer shows, for going back. */
const ROW_KEPT = 16;
/** How long an ask may still be answered, after the app drops it for a newer one. */
const ANSWERABLE_MS = 15_000;

type Open = (
  onThumbnail: (thumbnail: Thumbnail | null) => void
) => ReturnType<NonNullable<PlayerEngine['thumbnails']>>;

interface Ask {
  seek: boolean;
  row: boolean;
  kept: boolean;
  at: number;
}

export const nearestFirst = (positions: number[], focusMs: number) =>
  [...positions].sort((a, b) => Math.abs(a - focusMs) - Math.abs(b - focusMs));

export function thumbnailFeed(
  open: Open
): ThumbnailFeed & { prepare(): void; stop(): void } {
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  let current: Thumbnail | null = null;
  let wanted: number | null = null;
  let none = false;
  let stopped = false;
  let asked = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /*
   * Answers name their keyframe, not the position asked. The smallest open ask
   * at or after it always has that keyframe, whichever ask it answers.
   */
  const asks = new Map<number, Ask>();
  // Rows ask one position at a time, since the app answers only the newest.
  let rowWanted: number[] = [];
  let row = new Map<number, Thumbnail>();
  const rowSkipped = new Set<number>();
  let keptWanted: number[] = [];
  let kept = new Map<number, Thumbnail>();
  const keptDone = new Set<number>();
  const keptSkipped = new Set<number>();
  const addresses: BlobAddress[] = [];
  let asking: { ms: number; kept: boolean } | null = null;
  let askTimer: ReturnType<typeof setTimeout> | undefined;

  const show = (next: Thumbnail | null) => {
    if (next === current) return;
    current = next;
    notify();
  };
  const note = (ms: number, by: keyof Omit<Ask, 'at'>) => {
    const now = performance.now();
    for (const [p, ask] of asks)
      if (now - ask.at > ANSWERABLE_MS) asks.delete(p);
    const ask = asks.get(ms) ?? { seek: false, row: false, kept: false, at: 0 };
    ask[by] = true;
    ask.at = now;
    asks.set(ms, ask);
  };
  const ownerOf = (keyframeMs: number) => {
    let owner: number | undefined;
    let last: number | undefined;
    for (const p of asks.keys()) {
      if (p >= keyframeMs && (owner === undefined || p < owner)) owner = p;
      if (last === undefined || p > last) last = p;
    }
    // Before the first keyframe, positions are answered with it.
    return owner ?? last;
  };
  const drop = () => {
    clearTimeout(askTimer);
    asking = null;
  };
  // The app's server copy may be gone by the time a list shows it.
  const hold = async (ms: number, thumbnail: Thumbnail) => {
    try {
      const res = await fetch(thumbnail.src);
      if (!res.ok) throw new Error(String(res.status));
      const address = await blobAddress(await res.blob());
      if (stopped) return address.revoke();
      addresses.push(address);
      kept = new Map(kept).set(ms, { ...thumbnail, src: address.src });
      notify();
    } catch {
      keptDone.delete(ms);
      keptSkipped.add(ms);
    }
  };
  const ask = (ms: number, forKept: boolean) => {
    asking = { ms, kept: forKept };
    askTimer = setTimeout(() => {
      (forKept ? keptSkipped : rowSkipped).add(ms);
      asking = null;
      askNext();
    }, ROW_WAIT_MS);
    note(ms, forKept ? 'kept' : 'row');
    requests.want(ms);
  };
  const askNext = () => {
    if (asking || none || stopped) return;
    const forRow = rowWanted.find((p) => !row.has(p) && !rowSkipped.has(p));
    if (forRow !== undefined) return ask(forRow, false);
    // Kept pictures wait, so they never slow down the ones being looked at.
    if (wanted !== null || rowWanted.length) return;
    const toKeep = keptWanted.find(
      (p) => !keptDone.has(p) && !keptSkipped.has(p)
    );
    if (toKeep !== undefined) ask(toKeep, true);
  };

  const requests = open((thumbnail) => {
    if (!thumbnail) {
      none = true;
      drop();
      current = null;
      return notify();
    }
    const ms = ownerOf(thumbnail.positionMs);
    const owner = ms === undefined ? undefined : asks.get(ms);
    if (ms === undefined || !owner)
      return show(wanted === null ? null : thumbnail);
    asks.delete(ms);
    if (owner.seek) show(wanted === null ? null : thumbnail);
    if (owner.row && rowWanted.length) {
      row = new Map(row).set(ms, thumbnail);
      notify();
    }
    if (owner.kept && !keptDone.has(ms)) {
      keptDone.add(ms);
      void hold(ms, thumbnail);
    }
    if (asking?.ms === ms) {
      drop();
      askNext();
    }
  });
  return {
    want(ms) {
      wanted = ms;
      if (ms === null) {
        show(null);
        return askNext();
      }
      // The app drops it for newer asks, so it's asked again once these stop.
      if (asking?.kept) drop();
      if (none || timer) return;
      const send = () => {
        timer = undefined;
        asked = performance.now();
        if (wanted === null) return;
        note(wanted, 'seek');
        requests.want(wanted, current?.positionMs);
      };
      const wait = asked + ASK_MS - performance.now();
      if (wait <= 0) send();
      else timer = setTimeout(send, wait);
    },
    wantRow(positions, focusMs = 0) {
      if (!positions) {
        rowWanted = [];
        rowSkipped.clear();
        if (row.size) row = new Map();
        return askNext();
      }
      rowWanted = nearestFirst(positions, focusMs);
      const stale = [...row.keys()].filter((p) => !positions.includes(p));
      if (stale.length > ROW_KEPT) {
        row = new Map(row);
        for (const p of stale.slice(0, stale.length - ROW_KEPT)) row.delete(p);
      }
      if (asking?.kept) drop();
      askNext();
    },
    row: () => (none ? null : row),
    keep(positions, focusMs = 0) {
      keptWanted = nearestFirst(positions, focusMs);
      keptSkipped.clear();
      askNext();
    },
    kept: () => (none ? null : kept),
    prepare() {
      if (!none) requests.prepare();
    },
    current: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      drop();
      requests.stop();
      for (const address of addresses) address.revoke();
    },
  };
}
