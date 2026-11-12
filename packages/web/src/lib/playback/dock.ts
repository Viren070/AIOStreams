import React from 'react';
import { createLive, useLive } from '@/lib/live-value';

/** A place in a page the mini player draws its video into, in place of its card. */
const dock = createLive<HTMLElement | null>(null);

export const useDock = () => useLive(dock);

/** For the element a page shows a preview in, while it is mounted. */
export function useDockRef(): React.RefCallback<HTMLElement> {
  return React.useCallback((el: HTMLElement | null) => {
    if (el) {
      dock.set(el);
      return () => {
        if (dock.get() === el) dock.set(null);
      };
    }
  }, []);
}
