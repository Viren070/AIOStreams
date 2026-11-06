import React from 'react';

/** Text that changes often, kept out of the player page's state. */
export interface LiveText {
  get(): string | undefined;
  subscribe(listener: () => void): () => void;
}

export interface LiveTextWriter extends LiveText {
  set(text: string | undefined): void;
}

export function createLiveText(): LiveTextWriter {
  let text: string | undefined;
  const listeners = new Set<() => void>();
  return {
    get: () => text,
    set(next) {
      if (next === text) return;
      text = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const none = () => () => {};

export function useLiveText(text: LiveText | undefined): string | undefined {
  return React.useSyncExternalStore(text ? text.subscribe : none, () =>
    text?.get()
  );
}
