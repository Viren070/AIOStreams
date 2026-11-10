import React from 'react';

/** A value outside React's state, so only what reads it draws again when it changes. */
export interface Live<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

export interface LiveWriter<T> extends Live<T> {
  set(value: T): void;
}

export function createLive<T>(initial: T): LiveWriter<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const none = () => () => {};

export function useLive<T>(live: Live<T>): T;
export function useLive<T>(live: Live<T> | undefined): T | undefined;
export function useLive<T>(live: Live<T> | undefined): T | undefined {
  return React.useSyncExternalStore(live ? live.subscribe : none, () =>
    live?.get()
  );
}
