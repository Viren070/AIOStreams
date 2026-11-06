import * as React from 'react';

/**
 * Text the player pushes often (the subtitle line, the stats overlay), read only by
 * what draws it. Held in React state, every new line re-rendered the whole player
 * page and its controls, hidden or not, several times a second during dialogue,
 * which on slow TV sticks left the remote waiting.
 */
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

/** The current text, drawn again only when it changes. */
export function useLiveText(text: LiveText | undefined): string | undefined {
  return React.useSyncExternalStore(text ? text.subscribe : none, () =>
    text?.get()
  );
}
