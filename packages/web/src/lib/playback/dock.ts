import React from 'react';
import { createLive, useLive } from '@/lib/live-value';
import { usePageShown } from '@/lib/page-shown';

/** A place in a page the mini player draws its video into, in place of its card. */
const dock = createLive<HTMLElement | null>(null);

export const useDock = () => useLive(dock);

/** For the element a page shows a preview in, while it is mounted and its page shown. */
export function useDockRef(): React.RefCallback<HTMLElement> {
  const shown = usePageShown();
  return React.useCallback(
    (el: HTMLElement | null) => {
      if (el && shown) {
        dock.set(el);
        return () => {
          if (dock.get() === el) dock.set(null);
        };
      }
    },
    [shown]
  );
}
