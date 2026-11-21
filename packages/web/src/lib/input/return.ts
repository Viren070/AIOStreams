import type { AnyRouter, ParsedLocation } from '@tanstack/react-router';
import { usingKeys } from './dispatch';
import { focusOn, inOverlay, startOf } from './focus';

interface Spot {
  row: string | null;
  href: string | null;
  label: string;
  tag: string;
}

const RETRY_MS = 5000;

const keyOf = (location: ParsedLocation) =>
  location.state.__TSR_key ?? location.href;

const pageOf = (location: ParsedLocation | undefined) =>
  location?.pathname.split('/')[1];

const labelOf = (el: Element) =>
  (el.getAttribute('aria-label') ?? el.textContent ?? '').trim();

const addressOf = (el: Element) =>
  el.getAttribute('href') ?? el.getAttribute('data-href');

function spotOf(el: HTMLElement): Spot {
  return {
    row: el.closest('[data-row]')?.getAttribute('data-row') ?? null,
    href: addressOf(el),
    label: labelOf(el),
    tag: el.tagName,
  };
}

// Pages kept hidden behind this one can have the same rows and items.
const shown = (el: Element) => !el.closest('[inert]');

function find(spot: Spot): HTMLElement | null {
  const row =
    spot.row &&
    [...document.querySelectorAll(`[data-row="${CSS.escape(spot.row)}"]`)].find(
      shown
    );
  return (
    [...(row || document).querySelectorAll<HTMLElement>(spot.tag)].find(
      (el) =>
        (spot.href
          ? addressOf(el) === spot.href
          : labelOf(el) === spot.label) && shown(el)
    ) ?? null
  );
}

/**
 * Going back to a page puts the keyboard or remote back where it left it; a
 * page they open starts on its `data-nav-start`, where it has one.
 */
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
    if (!usingKeys()) spots.delete(keyOf(fromLocation));
    // A redirect as the next page opens leaves again, after the page is gone.
    else if (onPage?.isConnected)
      spots.set(keyOf(fromLocation), spotOf(onPage));
  });
  const arrive = router.subscribe(
    'onRendered',
    ({ fromLocation, toLocation }) => {
      cancelAnimationFrame(frame);
      const spot = spots.get(keyOf(toLocation));
      if (!spot && !usingKeys()) return;
      // A new entry of the same kind of page keeps the keys on the same control, where it has one.
      const same =
        !spot &&
        onPage?.isConnected &&
        pageOf(fromLocation) === pageOf(toLocation)
          ? spotOf(onPage)
          : undefined;
      const until = performance.now() + RETRY_MS;
      // Rows and catalogs can render a while after the page; anything focused meanwhile wins.
      const look = () => {
        const active = document.activeElement;
        // Focus left on a page now kept hidden (inert) counts as none.
        if (active && active !== document.body && !active.closest('[inert]'))
          return;
        const el = spot ? find(spot) : ((same && find(same)) ?? startOf());
        if (el?.getClientRects().length) focusOn(el);
        else if (performance.now() < until) frame = requestAnimationFrame(look);
      };
      look();
    }
  );
  return () => {
    document.removeEventListener('focusin', track);
    leave();
    arrive();
    cancelAnimationFrame(frame);
  };
}
