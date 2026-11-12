import React from 'react';
import { useElementScrollRestoration } from '@tanstack/react-router';

/** A new page's jump to its top, which isn't anyone scrolling. */
let newPageJump = false;
/** Longer than a page transition holds its scroll event back; a page already at the top sends none. */
const NEW_PAGE_JUMP_MS = 1000;

/** The router scrolls a commit after a page renders, so the old offset could paint first. */
export function PageScroll() {
  const saved = useElementScrollRestoration({ getElement: () => window });
  React.useLayoutEffect(() => {
    // Not by its offset: hiding the last page can already have clamped it.
    newPageJump = !saved;
    if (newPageJump) setTimeout(() => (newPageJump = false), NEW_PAGE_JUMP_MS);
    window.scrollTo(saved?.scrollX ?? 0, saved?.scrollY ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Scroll needed before a change of direction counts, so a trackpad's settling doesn't flicker it. */
const SCROLL_TURN_PX = 4;

/** Out of the way while the page scrolls down past `bar`, and back as it scrolls up. */
export function useScrollAway(
  bar: React.RefObject<HTMLElement | null>,
  on: boolean
): [boolean, () => void] {
  const [away, setAway] = React.useState(false);
  React.useEffect(() => {
    setAway(false);
    if (!on) return;
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (newPageJump) {
        // Every bar's listener sees this event before the next task.
        setTimeout(() => (newPageJump = false));
        // Stays as it was, unless a page too short to scroll could never bring it back.
        const canScroll =
          document.documentElement.scrollHeight >
          innerHeight + (bar.current?.offsetHeight ?? 0);
        if (canScroll) {
          last = y;
          return;
        }
      }
      if (y <= (bar.current?.offsetHeight ?? 0)) setAway(false);
      else if (Math.abs(y - last) < SCROLL_TURN_PX) return;
      else setAway(y > last);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [bar, on]);
  const show = React.useCallback(() => setAway(false), []);
  return [away, show];
}
