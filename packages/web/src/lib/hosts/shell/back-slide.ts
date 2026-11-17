import {
  backIsFree,
  isTextField,
  navigationBack,
  runAction,
} from '@/lib/input';
import { UNDER_OPACITY, UNDER_SHIFT } from '@/lib/page-open';
import { washCopy, washShownOn } from '@/lib/artwork/background';
import { pageRtl } from '@/lib/direction';

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

/** What Back leads to, still mounted beneath the page to show. */
interface Under {
  el: HTMLElement;
  path: string;
  /** How far down it was scrolled when left. */
  y: number;
  home: boolean;
  landed(): boolean;
}

interface Slide {
  page: HTMLElement;
  side: 1 | -1;
  under: Under | null;
}

let slide: Slide | null = null;
/** Unknown where no host notes it, so Home can't be shown where it was left. */
let homeY: number | null = null;

const backSide = (): 1 | -1 => (pageRtl() ? -1 : 1);

const pathOf = (hash: string) => hash.slice(1).split('?')[0] || '/';
const pagePath = () => pathOf(location.hash);

/** The document's scroll follows other pages once Home is left. */
export function noteHomeScroll(): () => void {
  homeY = 0;
  const note = () => {
    if (pagePath() === '/') homeY = window.scrollY;
  };
  addEventListener('scroll', note, { passive: true });
  return () => removeEventListener('scroll', note);
}

/** Home isn't one: Back asks there before leaving the app. */
function pageBackLeaves(): HTMLElement | null {
  if (!backIsFree() || isTextField(document.activeElement)) return null;
  if (navigationBack()) return null;
  if (!((window.history.state?.__TSR_index ?? 0) > 0)) return null;
  return document.querySelector<HTMLElement>(
    "main [data-page]:not([data-page='home'])"
  );
}

/**
 * Home, or the page's own layer marked `data-back-under` with the address it
 * shows and `data-back-y`, when Back leads to it.
 */
function behind(page: HTMLElement): Under | null {
  const nav = (window as { navigation?: NavigationEntries }).navigation;
  const url = nav?.entries()[(nav.currentEntry?.index ?? 0) - 1]?.url;
  if (!url) return null;
  const { hash } = new URL(url);
  const layer = page.querySelector<HTMLElement>('[data-back-under][inert]');
  const address = layer?.dataset.backUnder;
  if (layer && address === hash.slice(1))
    return {
      el: layer,
      path: pathOf(hash),
      y: Number(layer.dataset.backY) || 0,
      home: false,
      landed: () => location.hash.slice(1) === address,
    };
  const home = document.querySelector<HTMLElement>("[data-page='home']");
  if (!home || homeY === null || pathOf(hash) !== '/') return null;
  return {
    el: home,
    path: '/',
    y: homeY,
    home: true,
    landed: () => pagePath() === '/',
  };
}

function show({ el, y, home }: Under) {
  el.style.setProperty('--peek-top', `${window.scrollY - y}px`);
  if (home) {
    const left = (FADE_TO - y / innerHeight) / (FADE_TO - FADE_FROM);
    el.style.setProperty('--home-y', `${y}px`);
    el.style.setProperty('--home-fade', String(Math.min(1, Math.max(0, left))));
  }
  el.toggleAttribute('data-peek', true);
}

/** Directly on it, as a custom property would restyle all of it every frame. */
function move(el: HTMLElement, side: number, progress: number) {
  const shift = -side * UNDER_SHIFT * (1 - progress) * 100;
  el.style.transform = `translateX(${shift}%)`;
  el.style.opacity = String(UNDER_OPACITY + (1 - UNDER_OPACITY) * progress);
}

function settle(el: HTMLElement) {
  const { transform, opacity } = el.style;
  el.style.transform = 'none';
  el.style.opacity = '1';
  el.animate(
    { transform: [transform, 'none'], opacity: [opacity, '1'] },
    GLIDE
  );
}

function hide(el: HTMLElement) {
  el.removeAttribute('data-peek');
  el.style.transform = '';
  el.style.opacity = '';
  holdWash(false);
}

function holdWash(off: boolean) {
  const wash = document.querySelector<HTMLElement>(
    "[data-ui='page-background'] > [data-ui='art-wash']"
  );
  // Not visibility, which its canvases set for themselves.
  if (wash) wash.style.display = off ? 'none' : '';
}

/** The artwork behind the pages, which the page's own background hides while it slides. */
function carryWash(page: HTMLElement) {
  const wash = washCopy();
  if (!wash) return;
  const box = page.getBoundingClientRect();
  const { clientWidth, clientHeight } = document.documentElement;
  Object.assign(wash.style, {
    position: 'absolute',
    left: `${-box.left}px`,
    top: `${-box.top}px`,
    width: `${clientWidth}px`,
    height: `${clientHeight}px`,
    zIndex: '-10',
  });
  page.prepend(wash);
}

function glide(page: HTMLElement, to: string, done: () => void) {
  const from = page.style.transform;
  page.style.transform = to;
  page.animate({ transform: [from, to] }, GLIDE).onfinish = done;
}

function release(page: HTMLElement) {
  page.style.transform = '';
  page.removeAttribute('data-sliding');
  page.querySelector(':scope > [data-ui=art-wash]')?.remove();
}

function leave({ page, under }: Slide) {
  const from = pagePath();
  const landed = () => {
    const onUnder = !!under?.landed();
    // An entry of the same path keeps this element, which has to come back,
    // unless it lay over the page's own layer, which it leaves with.
    if (pagePath() === from && (!onUnder || under?.home)) release(page);
    if (under && !onUnder) hide(under.el);
  };
  addEventListener('popstate', landed, { once: true });
  setTimeout(landed, BACK_MS);
  if (under) {
    const { el } = under;
    const returned = new MutationObserver(() => {
      if (el.inert) return;
      returned.disconnect();
      // The hero's scroll-driven effects see the restored scroll from the next frame.
      requestAnimationFrame(() => hide(el));
    });
    returned.observe(el, { attributeFilter: ['inert'] });
  }
  runAction('back');
}

function begin(side: 1 | -1): boolean {
  const whole = pageBackLeaves();
  if (!whole) return false;
  // A page's `data-back-slide` layer leaves alone, over the rest of the page.
  const page = whole.querySelector<HTMLElement>('[data-back-slide]') ?? whole;
  const under = behind(whole);
  if (under) {
    move(under.el, side, 0);
    show(under);
    // The pages' wash follows the route, which stays this page's until Back lands.
    holdWash(!washShownOn(under.path));
  }
  page.toggleAttribute('data-sliding', true);
  carryWash(page);
  slide = { page, side, under };
  return true;
}

export function backGesture(
  m:
    | { event: 'start'; fromRight: boolean }
    | { event: 'move'; progress: number }
    | { event: 'cancel' }
): void {
  if (m.event === 'start') {
    begin(backSide());
    return;
  }
  if (!slide) return;
  const { page, side, under } = slide;
  if (m.event === 'move') {
    page.style.transform = `translateX(${side * m.progress * 100}%)`;
    if (under) move(under.el, side, m.progress);
    return;
  }
  slide = null;
  glide(page, 'none', () => {
    release(page);
    if (under) hide(under.el);
  });
}

export function backPressed(): void {
  if (!slide) {
    runAction('back');
    return;
  }
  const current = slide;
  slide = null;
  if (current.under) settle(current.under.el);
  glide(current.page, `translateX(${current.side * 100}%)`, () =>
    leave(current)
  );
}

/** Back from a button on a touch screen, leaving as a swipe does; false where no page slides. */
export function slideBack(): boolean {
  if (
    slide ||
    document.documentElement.hasAttribute('data-tv') ||
    !matchMedia('(pointer: coarse)').matches ||
    matchMedia('(prefers-reduced-motion: reduce)').matches ||
    !begin(backSide())
  )
    return false;
  backPressed();
  return true;
}
