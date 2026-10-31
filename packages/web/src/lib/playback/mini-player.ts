import React from 'react';
import { currentHost } from '../hosts';
import { appBridge } from '../hosts/shell/bridge';

export interface MiniPlay {
  itemId: string;
  sourceId: string;
  startMs: number;
  playlist?: string;
}

interface Stored extends MiniPlay {
  expanded: boolean;
}

let stored: Stored | null = null;
const listeners = new Set<() => void>();

function write(next: Stored | null) {
  stored = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const playKey = (play: MiniPlay) => `${play.itemId}|${play.sourceId}`;

export const miniPlayer = {
  read: () => stored,
  use: () => React.useSyncExternalStore(subscribe, () => stored),
  shrink: (play: MiniPlay) => write({ ...play, expanded: false }),
  expand: () => {
    if (stored) write({ ...stored, expanded: true });
  },
  close: () => write(null),
};

export function miniPlayerSupported(): boolean {
  const host = currentHost();
  if (host.tv || host.play) return false;
  return !host.player || appBridge()?.miniPlayer === true;
}
