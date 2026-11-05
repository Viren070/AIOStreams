import React from 'react';

/** A place in a page the mini player draws its video into, in place of its card. */
let dock: HTMLElement | null = null;
const listeners = new Set<() => void>();

function set(next: HTMLElement | null) {
  dock = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const useDock = () => React.useSyncExternalStore(subscribe, () => dock);

/** For the element a page shows a preview in, while it is mounted. */
export function useDockRef(): React.RefCallback<HTMLElement> {
  return React.useCallback((el: HTMLElement | null) => {
    if (el) {
      set(el);
      return () => {
        if (dock === el) set(null);
      };
    }
  }, []);
}
