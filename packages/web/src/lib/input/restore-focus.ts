import React from 'react';

/** The last element focused outside a menu, for a dialog that a menu entry opens. */
let outsideMenu: Element | null = null;
document.addEventListener(
  'focusin',
  (e) => {
    if (e.target instanceof Element && !e.target.closest('[role=menu]'))
      outsideMenu = e.target;
  },
  true
);

/** A dialog opened from code has no trigger, so its `onCloseAutoFocus` returns focus to where it was. */
export function useRestoreFocus(open: boolean): (e: Event) => void {
  const opener = React.useRef<Element | null>(null);
  React.useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    // A menu entry is gone once the dialog closes, so what opened the menu takes focus back.
    opener.current = active?.closest('[role=menu]') ? outsideMenu : active;
  }, [open]);
  return React.useCallback((e: Event) => {
    if (!(opener.current instanceof HTMLElement)) return;
    e.preventDefault();
    opener.current.focus({ preventScroll: true });
  }, []);
}
