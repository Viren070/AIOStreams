import React from 'react';

/** A dialog opened from code has no trigger, so its `onCloseAutoFocus` returns focus to where it was. */
export function useRestoreFocus(open: boolean): (e: Event) => void {
  const opener = React.useRef<Element | null>(null);
  React.useLayoutEffect(() => {
    if (open) opener.current = document.activeElement;
  }, [open]);
  return React.useCallback((e: Event) => {
    if (!(opener.current instanceof HTMLElement)) return;
    e.preventDefault();
    opener.current.focus({ preventScroll: true });
  }, []);
}
