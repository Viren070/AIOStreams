import type { AnyRouter, ParsedLocation } from '@tanstack/react-router';
import { usingKeys } from './dispatch';
import { focusOn, inOverlay, startOf } from './focus';
import { jumpingTo } from './glide';

interface Spot {
  row: string | null;
  href: string | null;
  label: string;
  tag: string;
}

const RETRY_MS = 5000;
/** A first page can wait on the server for longer before its start shows. */
const START_RETRY_MS = 15_000;
/** A place not found by then is gone, and the page's start stands in. */
const GONE_MS = 1000;
const HOME = '/';

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
          : labelOf(el) === spot.label) &&
        shown(el) &&
        // Nor one a stylesheet hides, as the phone bar's, which would keep the page's start from standing in.
        el.getClientRects().length > 0
    ) ?? null
  );
}

/**
 * Going back to a page puts the keyboard or remote back where it left it; a
 * page they open starts on its `data-nav-start`, where it has one. On a TV,
 * where only the remote moves focus, the first page starts there too before
 * any press.
 */
export function returnFocus(
  router: AnyRouter,
  { remote = false }: { remote?: boolean } = {}
): () => void {
  const spots = new Map<string, Spot>();
  let frame = 0;
  // A menu or dialog the page opened can be what navigates, so the page's own element is kept.
  let onPage: HTMLElement | null = null;
  // Home, however it's reached again, goes back to where its own content was left.
  let inContent: HTMLElement | null = null;
  let home: Spot | null = null;
  const track = (e: FocusEvent) => {
    if (!(e.target instanceof HTMLElement) || inOverlay(e.target)) return;
    onPage = e.target;
    if (e.target.closest('main')) inContent = e.target;
  };
  document.addEventListener('focusin', track);
  const leave = router.subscribe('onBeforeNavigate', ({ fromLocation }) => {
    if (!fromLocation) return;
    if (!usingKeys()) spots.delete(keyOf(fromLocation));
    // A redirect as the next page opens leaves again, after the page is gone.
    else if (onPage?.isConnected)
      spots.set(keyOf(fromLocation), spotOf(onPage));
    if (fromLocation.pathname === HOME && inContent?.isConnected)
      home = spotOf(inContent);
  });
  const arrive = router.subscribe(
    'onRendered',
    ({ fromLocation, toLocation }) => {
      cancelAnimationFrame(frame);
      inContent = null;
      const spot =
        (toLocation.pathname === HOME && usingKeys() ? home : null) ??
        spots.get(keyOf(toLocation));
      if (!spot && !usingKeys() && !remote) return;
      // A new entry of the same kind of page keeps the keys on the same control, where it has one.
      const same =
        !spot &&
        onPage?.isConnected &&
        pageOf(fromLocation) === pageOf(toLocation)
          ? spotOf(onPage)
          : undefined;
      const until = performance.now() + (spot ? RETRY_MS : START_RETRY_MS);
      const gone = performance.now() + GONE_MS;
      // Rows and catalogs can render a while after the page; anything focused meanwhile wins.
      const look = () => {
        const active = document.activeElement;
        // Focus left on a page now kept hidden (inert) counts as none.
        if (active && active !== document.body && !active.closest('[inert]'))
          return;
        const el = spot
          ? (find(spot) ?? (performance.now() >= gone ? startOf() : null))
          : ((same && find(same)) ?? startOf());
        if (el?.getClientRects().length) {
          // Back where it was, not scrolled there from the page's top.
          if (spot) jumpingTo(() => focusOn(el));
          else focusOn(el);
        } else if (performance.now() < until)
          frame = requestAnimationFrame(look);
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
