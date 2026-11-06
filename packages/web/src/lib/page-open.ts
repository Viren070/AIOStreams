import { pageRtl } from './direction';

/** The page beneath another, as it opens and as a back swipe reveals it. */
export const UNDER_SHIFT = 0.25;
export const UNDER_OPACITY = 0.6;

/** How long the old screen may hold while the new page's art gets ready. */
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

const artShown = () =>
  new Promise<void>((done) => {
    const by = performance.now() + ART_WAIT_MS;
    // Not by frame: none are drawn until the update finishes.
    const check = () => {
      const art = document.querySelector("[data-ui='item-backdrop-image']");
      const shown = art && getComputedStyle(art).opacity !== '0';
      if (shown || performance.now() > by) done();
      else setTimeout(check, 8);
    };
    check();
  });

/** Both cover by height from the top, so scaled to the hero's height the art frames the picture as the hero does. */
function morphArt(from: DOMRect | undefined) {
  const el = document.querySelector("[data-ui='item-backdrop']");
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

/**
 * Holds the old screen until the new page can draw, which otherwise leaves
 * nothing on screen meanwhile. From the hero, its art and logo carry over as the
 * rest crossfades; otherwise the page slides over.
 */
export function openPage(go: () => void, fromHero = false): void {
  if (!canTransition()) return go();
  const root = document.documentElement;
  const art = fromHero
    ? document
        .querySelector("[data-ui='hero-backdrops']")
        ?.getBoundingClientRect()
    : undefined;
  const named: HTMLElement[] = [];
  const name = (selector: string, viewTransitionName: string) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return;
    el.style.viewTransitionName = viewTransitionName;
    named.push(el);
  };
  const nameAll = (names: Record<string, string>) =>
    Object.entries(names).forEach(([selector, each]) => name(selector, each));
  nameAll(BARS);
  if (fromHero) {
    nameAll(HERO_LEAVING);
    name("[data-slide='0'] [data-ui='hero-logo']", LOGO);
  } else root.toggleAttribute('data-sliding-open', true);
  opening = true;
  const transition = document.startViewTransition(async () => {
    go();
    await artShown();
    if (fromHero) {
      name("[data-ui='item-logo']", LOGO);
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
