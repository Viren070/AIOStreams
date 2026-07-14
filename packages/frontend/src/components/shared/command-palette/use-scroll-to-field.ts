import { useEffect, useRef } from 'react';
import { scrollAndHighlight } from './scroll-highlight';

/**
 * Consume a `?field=` deep link: scroll to that setting, pulse it, and strip
 * the param from the URL.
 *
 * `clearField` must be stable and must navigate with `resetScroll: false`.
 * `ready` gates on the fields having been rendered, on a cold deep link the
 * settings payload has not arrived yet.
 */
export function useScrollToField(
  field: string | undefined,
  ready: boolean,
  clearField: () => void
) {
  const consumed = useRef<string | null>(null);

  useEffect(() => {
    if (!field) {
      consumed.current = null;
      return;
    }
    if (!ready || consumed.current === field) return;
    consumed.current = field;
    clearField();
    scrollAndHighlight([`setting-${field}`]);
  }, [field, ready, clearField]);
}
