import type * as React from 'react';

export function mergeRefs<T = any>(
  refs: Array<React.MutableRefObject<T> | React.LegacyRef<T> | undefined | null>
): React.RefCallback<T> {
  return (value) => {
    refs.forEach((ref) => {
      if (typeof ref === 'function') {
        ref(value);
      } else if (ref != null) {
        (ref as React.MutableRefObject<T | null>).current = value;
      }
    });
  };
}

export const isEmpty = (obj: any) =>
  [Object, Array].includes((obj || {}).constructor) &&
  !Object.entries(obj || {}).length;

/** A press on a toast or a `data-modal-passthrough` element leaves an open modal as it is. */
export function keepsModalOpen(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest('[data-sonner-toast], [data-modal-passthrough]')
  );
}
