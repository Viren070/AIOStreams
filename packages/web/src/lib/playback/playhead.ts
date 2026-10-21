import React from 'react';

export interface TimeRange {
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * Where playback is. Players report it several times a second, so it is kept
 * out of `PlayerState`: only what shows it, or turns on it, draws again.
 */
export interface Playhead {
  readonly positionMs: number;
  readonly buffered: readonly TimeRange[];
  subscribe(listener: () => void): () => void;
}

export interface PlayheadWriter extends Playhead {
  set(next: { positionMs?: number; buffered?: readonly TimeRange[] }): void;
}

const sameRanges = (a: readonly TimeRange[], b: readonly TimeRange[]) =>
  a.length === b.length &&
  a.every((r, i) => r.startMs === b[i].startMs && r.endMs === b[i].endMs);

export function createPlayhead(positionMs: number): PlayheadWriter {
  const listeners = new Set<() => void>();
  const head = {
    positionMs,
    buffered: [] as readonly TimeRange[],
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set: (next: { positionMs?: number; buffered?: readonly TimeRange[] }) => {
      const { positionMs = head.positionMs } = next;
      // Kept when equal, so what reads it draws again only on a change.
      const buffered =
        next.buffered && !sameRanges(next.buffered, head.buffered)
          ? next.buffered
          : head.buffered;
      if (positionMs === head.positionMs && buffered === head.buffered) return;
      head.positionMs = positionMs;
      head.buffered = buffered;
      for (const listener of listeners) listener();
    },
  };
  return head;
}

export function usePlayheadWriter(startMs: number): PlayheadWriter {
  const [head] = React.useState(() => createPlayhead(startMs));
  return head;
}

const still = () => () => {};

/**
 * What `select` reads from the playhead, drawn again only when it changes and
 * held while not `live`. It has to give a plain value, not a new object.
 */
export function usePlayhead<T>(
  playhead: Playhead,
  select: (head: Playhead) => T,
  live = true
): T {
  return React.useSyncExternalStore(live ? playhead.subscribe : still, () =>
    select(playhead)
  );
}
