import { backIsFree, isTextField, runAction } from '../../input';
import { UNDER_OPACITY, UNDER_SHIFT } from '../../page-open';

const GLIDE = { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
/** Longer than `history.back` takes to land. */
const BACK_MS = 500;
/** The hero's `scroll-fade` range, in window heights. */
const FADE_FROM = 0.1;
const FADE_TO = 0.5;

interface NavigationEntries {
  currentEntry: { index: number } | null;
  entries(): { url: string | null }[];
}

interface Slide {
  page: HTMLElement;
  side: 1 | -1;
  home: HTMLElement | null;
}

let slide: Slide | null = null;
let homeY = 0;

const pathOf = (hash: string) => hash.slice(1).split('?')[0] || '/';
const pagePath = () => pathOf(location.hash);

/** The document's scroll follows other pages once Home is left. */
export function noteHomeScroll(): () => void {
  const note = () => {
    if (pagePath() === '/') homeY = window.scrollY;
  };
  addEventListener('scroll', note, { passive: true });
  return () => removeEventListener('scroll', note);
}

/** Home isn't one: Back asks there before leaving the app. */
function pageBackLeaves(): HTMLElement | null {
  if (!backIsFree() || isTextField(document.activeElement)) return null;
  if (!((window.history.state?.__TSR_index ?? 0) > 0)) return null;
  return document.querySelector<HTMLElement>(
    "main [data-page]:not([data-page='home'])"
  );
}

/** Home when Back leads to it, the only page that stays mounted to show. */
function homeBehind(): HTMLElement | null {
  const nav = (window as { navigation?: NavigationEntries }).navigation;
  const url = nav?.entries()[(nav.currentEntry?.index ?? 0) - 1]?.url;
  if (!url || pathOf(new URL(url).hash) !== '/') return null;
  return document.querySelector<HTMLElement>("[data-page='home']");
}

function showHome(home: HTMLElement) {
  const left = (FADE_TO - homeY / innerHeight) / (FADE_TO - FADE_FROM);
  const fade = Math.min(1, Math.max(0, left));
  home.style.setProperty('--home-top', `${window.scrollY - homeY}px`);
  home.style.setProperty('--home-y', `${homeY}px`);
  home.style.setProperty('--home-fade', String(fade));
  home.toggleAttribute('data-peek', true);
}

/** Directly on Home, as a custom property would restyle all of it every frame. */
function moveHome(home: HTMLElement, side: number, progress: number) {
  const shift = -side * UNDER_SHIFT * (1 - progress) * 100;
  home.style.transform = `translateX(${shift}%)`;
  home.style.opacity = String(UNDER_OPACITY + (1 - UNDER_OPACITY) * progress);
}

function settleHome(home: HTMLElement) {
  const { transform, opacity } = home.style;
  home.style.transform = 'none';
  home.style.opacity = '1';
  home.animate(
    { transform: [transform, 'none'], opacity: [opacity, '1'] },
    GLIDE
  );
}

function hideHome(home: HTMLElement) {
  home.removeAttribute('data-peek');
  home.style.transform = '';
  home.style.opacity = '';
}

function glide(page: HTMLElement, to: string, done: () => void) {
  const from = page.style.transform;
  page.style.transform = to;
  page.animate({ transform: [from, to] }, GLIDE).onfinish = done;
}

function release(page: HTMLElement) {
  page.style.transform = '';
  page.removeAttribute('data-sliding');
}

function leave({ page, home }: Slide) {
  const from = pagePath();
  const landed = () => {
    // An entry of the same path keeps this element, which has to come back.
    if (pagePath() === from) release(page);
    if (home && pagePath() !== '/') hideHome(home);
  };
  addEventListener('popstate', landed, { once: true });
  setTimeout(landed, BACK_MS);
  if (home) {
    const returned = new MutationObserver(() => {
      if (home.inert) return;
      returned.disconnect();
      // The hero's scroll-driven effects see the restored scroll from the next frame.
      requestAnimationFrame(() => hideHome(home));
    });
    returned.observe(home, { attributeFilter: ['inert'] });
  }
  runAction('back');
}

export function backGesture(
  m:
    | { event: 'start'; fromRight: boolean }
    | { event: 'move'; progress: number }
    | { event: 'cancel' }
): void {
  if (m.event === 'start') {
    const page = pageBackLeaves();
    if (!page) return;
    const side = m.fromRight ? -1 : 1;
    const home = homeBehind();
    if (home) {
      moveHome(home, side, 0);
      showHome(home);
    }
    page.toggleAttribute('data-sliding', true);
    slide = { page, side, home };
    return;
  }
  if (!slide) return;
  const { page, side, home } = slide;
  if (m.event === 'move') {
    page.style.transform = `translateX(${side * m.progress * 100}%)`;
    if (home) moveHome(home, side, m.progress);
    return;
  }
  slide = null;
  glide(page, 'none', () => {
    release(page);
    if (home) hideHome(home);
  });
}

export function backPressed(): void {
  if (!slide) {
    runAction('back');
    return;
  }
  const current = slide;
  slide = null;
  if (current.home) settleHome(current.home);
  glide(current.page, `translateX(${current.side * 100}%)`, () =>
    leave(current)
  );
}
