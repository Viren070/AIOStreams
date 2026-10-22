import React from 'react';
import { usingKeys } from './dispatch';
import { focusOn, startOf } from './focus';

/** For a dialog's `onOpenAutoFocus`: it holds focus itself rather than its first control. */
export function focusDialog(e: Event): void {
  e.preventDefault();
  (e.target as HTMLElement).focus();
}

/**
 * Keys start on the `data-nav-start` in the dialog around `box` once `ready`,
 * unless they have already moved on from the dialog itself.
 */
export function useDialogStart(
  box: React.RefObject<HTMLElement | null>,
  ready: boolean
): void {
  React.useEffect(() => {
    if (!ready) return;
    // After the dialog takes focus as it opens.
    const timer = setTimeout(() => {
      const dialog = box.current?.closest<HTMLElement>('[role=dialog]');
      const at = document.activeElement;
      if (!dialog || !usingKeys() || (at !== document.body && at !== dialog))
        return;
      const start = startOf(dialog);
      if (start) focusOn(start);
    });
    return () => clearTimeout(timer);
  }, [box, ready]);
}
