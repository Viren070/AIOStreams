import type { AnyRouter, ParsedLocation } from '@tanstack/react-router';
import { usingKeys } from './dispatch';
import { focusOn, inOverlay } from './focus';

interface Spot {
  row: string | null;
  href: string | null;
  label: string;
  tag: string;
}

const RETRY_MS = 2000;

const keyOf = (location: ParsedLocation) =>
  location.state.__TSR_key ?? location.href;

const labelOf = (el: Element) =>
  (el.getAttribute('aria-label') ?? el.textContent ?? '').trim();

function spotOf(el: HTMLElement): Spot {
  return {
    row: el.closest('[data-row]')?.getAttribute('data-row') ?? null,
    href: el.getAttribute('href'),
    label: labelOf(el),
    tag: el.tagName,
  };
}

function find(spot: Spot): HTMLElement | null {
  const row =
    spot.row && document.querySelector(`[data-row="${CSS.escape(spot.row)}"]`);
  return (
    [...(row || document).querySelectorAll<HTMLElement>(spot.tag)].find((el) =>
      spot.href
        ? el.getAttribute('href') === spot.href
        : labelOf(el) === spot.label
    ) ?? null
  );
}

/** Going back to a page puts the keyboard or remote back where it left it. */
export function returnFocus(router: AnyRouter): () => void {
  const spots = new Map<string, Spot>();
  let frame = 0;
  // A menu or dialog the page opened can be what navigates, so the page's own element is kept.
  let onPage: HTMLElement | null = null;
  const track = (e: FocusEvent) => {
    if (e.target instanceof HTMLElement && !inOverlay(e.target))
      onPage = e.target;
  };
  document.addEventListener('focusin', track);
  const leave = router.subscribe('onBeforeNavigate', ({ fromLocation }) => {
    if (!fromLocation) return;
    const el = usingKeys() && onPage?.isConnected ? onPage : null;
    if (el) spots.set(keyOf(fromLocation), spotOf(el));
    else spots.delete(keyOf(fromLocation));
  });
  const arrive = router.subscribe('onRendered', ({ toLocation }) => {
    cancelAnimationFrame(frame);
    const spot = spots.get(keyOf(toLocation));
    if (!spot) return;
    const until = performance.now() + RETRY_MS;
    // Rows can render a little after the page; anything focused meanwhile wins.
    const look = () => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const el = find(spot);
      if (el?.getClientRects().length) focusOn(el);
      else if (performance.now() < until) frame = requestAnimationFrame(look);
    };
    look();
  });
  return () => {
    document.removeEventListener('focusin', track);
    leave();
    arrive();
    cancelAnimationFrame(frame);
  };
}
