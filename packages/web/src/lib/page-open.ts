import { pageRtl } from './direction';

/** The page beneath another, as it opens and as a back swipe reveals it. */
export const UNDER_SHIFT = 0.25;
export const UNDER_OPACITY = 0.6;

/** How long the old screen may hold while the new page, and a title's art, get ready. */
const ART_WAIT_MS = 200;
const EASE = 'cubic-bezier(0.05, 0.7, 0.1, 1)';
const ART_MORPH = { duration: 450, easing: EASE };
const SLIDE = { duration: 350, easing: EASE };
/** In the page's picture they would move with it. */
const BARS = {
  "[data-ui='mobile-nav']": 'mobile-nav',
  "[data-ui='touch-rail']": 'touch-rail',
  "[data-ui='sidebar']": 'side-bar',
  "[data-ui='corner-menu']": 'corner-menu',
  "[data-ui='top-tabs']": 'top-tabs',
};
/** Named in styles.css: they leave quickly rather than ghost over the new page. */
const HERO_LEAVING = {
  "[data-slide='0'] [data-ui='hero-content']": 'hero-details',
  "[data-ui='hero-dots']": 'hero-dots',
  "[data-ui='home-rows']": 'home-rows',
};
const LOGO = 'title-logo';

let opening = false;

/** The page then needs no entrance of its own. */
export const pageOpening = (): boolean => opening;

/** The open page's, not those of the pages kept hidden behind it. */
const onPage = (selector: string) =>
  document
    .querySelector('main [data-page]:not([inert])')
    ?.querySelector<HTMLElement>(selector) ?? null;

/** Until the new page is open and, for a title, its art shows. */
const opened = (before: Element | null, title: boolean) =>
  new Promise<void>((done) => {
    const by = performance.now() + ART_WAIT_MS;
    // Not by frame: none are drawn until the update finishes.
    const check = () => {
      const page = document.querySelector('main [data-page]:not([inert])');
      const art = onPage("[data-ui='item-backdrop-image']");
      const shown =
        page !== before &&
        (!title || (art && getComputedStyle(art).opacity !== '0'));
      if (shown || performance.now() > by) done();
      else setTimeout(check, 8);
    };
    check();
  });

/** Both cover by height from the top, so scaled to the hero's height the art frames the picture as the hero does. */
function morphArt(from: DOMRect | undefined) {
  const el = onPage("[data-ui='item-backdrop']");
  const to = el?.getBoundingClientRect();
  if (!el || !to?.height || !from) return;
  el.animate(
    {
      transformOrigin: ['top', 'top'],
      // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS value
      translate: [`0 ${from.top - to.top}px`, '0 0'],
      scale: [String(from.height / to.height), '1'],
    },
    ART_MORPH
  );
}

function slideOver() {
  const root = document.documentElement;
  const side = pageRtl() ? -1 : 1;
  /* eslint-disable lingui/no-unlocalized-strings -- CSS values and pseudo-elements */
  root.animate(
    { transform: [`translateX(${side * 100}%)`, 'none'] },
    { ...SLIDE, pseudoElement: '::view-transition-new(root)' }
  );
  root.animate(
    {
      transform: ['none', `translateX(${-side * UNDER_SHIFT * 100}%)`],
      opacity: [1, UNDER_OPACITY],
    },
    { ...SLIDE, pseudoElement: '::view-transition-old(root)' }
  );
  /* eslint-enable lingui/no-unlocalized-strings */
}

const canTransition = () =>
  !!document.startViewTransition &&
  matchMedia('(pointer: coarse)').matches &&
  !matchMedia('(prefers-reduced-motion: reduce)').matches &&
  !document.documentElement.hasAttribute('data-tv') &&
  // A video surface beneath the page wouldn't be in the transition's pictures.
  !document.querySelector("[data-page='player']") &&
  !!document.querySelector('main [data-page]');

/** The page it leaves fades this long: under the time a TV takes to draw the new one. */
const LEAVE_MS = 320;
/** By then the new page is in, or the press led nowhere. */
const LEAVE_GIVE_UP_MS = 3000;
let leaving = false;

/** What moves as a page leaves or comes back; the rest, backdrops among it, only fades. */
export const CONTENT =
  "[data-ui='item-body'], [data-ui='hero-content'], [data-ui='hero-dots'], [data-ui='home-rows']";

/** As a page shown again rises, on the compositor. */
const WASH_BACK = { duration: 450, easing: 'cubic-bezier(0, 0, 0.6, 1)' };

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Where the title's backdrop was as the player opened over it, for its cover to start from. */
let artFrom: { rect: DOMRect; at: number } | null = null;
const ART_FRESH_MS = 3000;

/** The backdrop's place a player opened from, while fresh. */
export function takeArtFrom(): DOMRect | null {
  // Kept while fresh rather than taken once: a page can draw its cover as it
  // loads and again once it plays, each wanting it.
  return artFrom && performance.now() - artFrom.at < ART_FRESH_MS
    ? artFrom.rect
    : null;
}

/**
 * The next page's rise waits, paused, until it's drawn, which a TV can take
 * most of a second over; begun with it, the rise would be over unseen.
 */
function riseOnceDrawn(left: Element): void {
  const root = document.documentElement;
  root.setAttribute('data-rise-wait', '');
  const until = performance.now() + LEAVE_GIVE_UP_MS;
  const release = () => root.removeAttribute('data-rise-wait');
  const look = () => {
    const shown = document.querySelector('main [data-page]:not([inert])');
    if (shown && shown !== left)
      return requestAnimationFrame(() => requestAnimationFrame(release));
    if (performance.now() > until) return release();
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

/**
 * On a TV, which draws a page for a good part of a second, the page it leaves
 * starts fading in the frame the press lands, on the compositor, which goes on
 * while the new page is drawn a frame later. Kept beneath the next page, it is
 * unfaded once it's hidden, to show as it was on return. Elsewhere it goes at once.
 *
 * For the player, the page's content leaves while its backdrop stays, which
 * the player's cover takes over from where it is. `waitOut`: the page it
 * leaves goes all the way before the next is made, as a title's page holds
 * the thread long enough to hide the leaving otherwise.
 */
export function leaveThenOpen(
  go: () => void,
  toPlayer = false,
  waitOut = false
): void {
  const page = document.querySelector<HTMLElement>(
    'main [data-page]:not([inert])'
  );
  // A press while the last is still leaving is the same press again.
  if (leaving) return;
  if (
    !page ||
    // Under the player it is out of sight already.
    page.closest('[inert]') ||
    still() ||
    !document.documentElement.hasAttribute('data-tv')
  )
    return go();
  leaving = true;
  // A cover's carried backdrop is for the player this opens, not a later one.
  if (!toPlayer) artFrom = null;
  // It fades; its content rises away as the title's will rise into place,
  // while its backdrops stay where they are.
  const timing = {
    duration: LEAVE_MS,
    easing: 'cubic-bezier(0.4, 0, 1, 1)',
    fill: 'forwards',
  } as const;
  const content = [...page.querySelectorAll<HTMLElement>(CONTENT)];
  const art = toPlayer
    ? page.querySelector<HTMLElement>("[data-ui='item-backdrop-image']")
    : null;
  // The artwork wash, bright without the page's shades over it, fades with it.
  const washes = art
    ? []
    : [
        ...document.querySelectorAll<HTMLElement>(
          "[data-ui='page-background'] > [data-ui='art-wash']"
        ),
      ];
  const washFades = washes.map((el) =>
    el.animate([{ opacity: 1 }, { opacity: 0 }], timing)
  );
  if (art?.getClientRects().length)
    artFrom = { rect: art.getBoundingClientRect(), at: performance.now() };
  const fades = art
    ? content.map((el) =>
        el.animate(
          [
            { opacity: 1, transform: 'translateY(0)' },
            { opacity: 0, transform: 'translateY(-0.5rem)' },
          ],
          timing
        )
      )
    : [
        page.animate([{ opacity: 1 }, { opacity: 0 }], timing),
        ...(content.length ? content : [page]).map((el) =>
          el.animate(
            [
              { transform: 'translateY(0)' },
              { transform: 'translateY(-0.5rem)' },
            ],
            timing
          )
        ),
      ];
  const done = () => {
    observer.disconnect();
    clearTimeout(giveUp);
    leaving = false;
    for (const each of fades) each.cancel();
    // It comes back as the new page rises, rather than at once.
    for (const [i, each] of washFades.entries()) {
      washes[i]?.animate([{ opacity: 0 }, { opacity: 1 }], WASH_BACK);
      each.cancel();
    }
  };
  const observer = new MutationObserver(() => {
    if (page.closest('[inert]') || !page.isConnected) done();
  });
  // Kept beneath the next page, or under the player with the rest of the shell.
  for (const el of [page, page.closest("[data-ui='shell']")])
    if (el)
      observer.observe(el, { attributes: true, attributeFilter: ['inert'] });
  // The page Back leaves is taken out instead.
  if (page.parentElement)
    observer.observe(page.parentElement, { childList: true });
  const giveUp = setTimeout(done, LEAVE_GIVE_UP_MS);
  // Drawn first, so the fade is under way before the new page holds the thread.
  const open = () => {
    if (waitOut) riseOnceDrawn(page);
    go();
  };
  if (waitOut) setTimeout(open, LEAVE_MS);
  else requestAnimationFrame(() => setTimeout(open));
}

/**
 * Holds the old screen until the new page can draw, which otherwise leaves
 * nothing on screen meanwhile; a title's until its art shows. From the hero,
 * its art and logo carry over as the rest crossfades; otherwise the page slides over.
 */
export function openPage(
  go: () => void,
  { fromHero = false, title = true } = {}
): void {
  // A TV has no slide: a title's page leaves in full first, and what slides over elsewhere opens at once.
  if (document.documentElement.hasAttribute('data-tv'))
    return title ? leaveThenOpen(go, false, true) : go();
  if (!canTransition()) return go();
  const root = document.documentElement;
  const art = fromHero
    ? onPage("[data-ui='hero-backdrops']")?.getBoundingClientRect()
    : undefined;
  const named: HTMLElement[] = [];
  const name = (el: HTMLElement | null, viewTransitionName: string) => {
    if (!el) return;
    el.style.viewTransitionName = viewTransitionName;
    named.push(el);
  };
  for (const [selector, each] of Object.entries(BARS))
    name(document.querySelector<HTMLElement>(selector), each);
  if (fromHero) {
    for (const [selector, each] of Object.entries(HERO_LEAVING))
      name(onPage(selector), each);
    name(onPage("[data-slide='0'] [data-ui='hero-logo']"), LOGO);
  } else root.toggleAttribute('data-sliding-open', true);
  opening = true;
  const before = document.querySelector('main [data-page]:not([inert])');
  const transition = document.startViewTransition(async () => {
    go();
    await opened(before, title);
    if (fromHero) {
      name(onPage("[data-ui='item-logo']"), LOGO);
      morphArt(art);
    }
  });
  if (!fromHero) void transition.ready.then(slideOver).catch(() => undefined);
  void transition.finished.finally(() => {
    opening = false;
    root.removeAttribute('data-sliding-open');
    for (const el of named) el.style.viewTransitionName = '';
  });
}
