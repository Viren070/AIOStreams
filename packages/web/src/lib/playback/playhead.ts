import React from 'react';

/**
 * Where playback is. Players report it several times a second, so it is kept
 * out of `PlayerState`: only what shows it, or turns on it, draws again.
 */
export interface Playhead {
  readonly positionMs: number;
  readonly bufferedMs: number;
  subscribe(listener: () => void): () => void;
}

export interface PlayheadWriter extends Playhead {
  set(next: { positionMs?: number; bufferedMs?: number }): void;
}

export function createPlayhead(positionMs: number): PlayheadWriter {
  const listeners = new Set<() => void>();
  const head = {
    positionMs,
    bufferedMs: 0,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set: (next: { positionMs?: number; bufferedMs?: number }) => {
      const { positionMs = head.positionMs, bufferedMs = head.bufferedMs } =
        next;
      if (positionMs === head.positionMs && bufferedMs === head.bufferedMs)
        return;
      head.positionMs = positionMs;
      head.bufferedMs = bufferedMs;
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
