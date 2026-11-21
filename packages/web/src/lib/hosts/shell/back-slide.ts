import {
  backIsFree,
  isTextField,
  navigationBack,
  runAction,
} from '@/lib/input';
import { UNDER_OPACITY, UNDER_SHIFT } from '@/lib/page-open';
import {
  holdArt,
  keepHeldArt,
  washCopy,
  washShownOn,
} from '@/lib/artwork/background';
import { pageRtl } from '@/lib/direction';

const GLIDE = { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
/** Longer than `history.back` takes to land. */
const BACK_MS = 500;

interface Slide {
  page: HTMLElement;
  side: 1 | -1;
  /** The page Back leads to, which the page stack keeps beneath. */
  under: HTMLElement | null;
}

/** The one following a swipe. */
let slide: Slide | null = null;
/** One let go, from its glide away until Back lands. */
let leaving: Slide | null = null;
/** The newest begun: an older one's clean-up leaves the pages it has taken alone. */
let latest: Slide | null = null;

const backSide = (): 1 | -1 => (pageRtl() ? -1 : 1);

/** Home isn't one: Back asks there before leaving the app. */
function pageBackLeaves(): HTMLElement | null {
  if (!backIsFree() || isTextField(document.activeElement)) return null;
  if (navigationBack()) return null;
  if (!((window.history.state?.__TSR_index ?? 0) > 0)) return null;
  return document.querySelector<HTMLElement>(
    "main [data-page]:not([inert]):not([data-page='home'])"
  );
}

/** Directly on it, as a custom property would restyle all of it every frame. */
function move(el: HTMLElement, side: number, progress: number) {
  const shift = -side * UNDER_SHIFT * (1 - progress) * 100;
  el.style.transform = `translateX(${shift}%)`;
  el.style.opacity = String(UNDER_OPACITY + (1 - UNDER_OPACITY) * progress);
}

/** At the scroll it was left at, over the art it showed; `--peek-at` is in window heights. */
function peek(el: HTMLElement, side: number) {
  const y = Number(el.dataset.backY) || 0;
  el.style.setProperty('--peek-top', `${window.scrollY - y}px`);
  el.style.setProperty('--peek-at', String(y / innerHeight));
  move(el, side, 0);
  el.toggleAttribute('data-peek', true);
  holdWash(washShownOn(el.dataset.backTo ?? '/'));
  if (el.dataset.backArt) holdArt(el.dataset.backArt);
}

/** `opened` once Back has made it the open page, whose art then stays. */
function unpeek(el: HTMLElement, opened = false) {
  el.removeAttribute('data-peek');
  el.style.transform = '';
  el.style.opacity = '';
  holdWash(null);
  if (opened) keepHeldArt();
  else holdArt(null);
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

/** The pages' wash follows the route, which stays the open page's until Back lands. */
function holdWash(shown: boolean | null) {
  const wash = document.querySelector<HTMLElement>(
    "[data-ui='page-background'] > [data-ui='art-wash']"
  );
  // Not visibility, which its canvases set for themselves.
  if (wash) wash.style.display = shown === null ? '' : shown ? 'block' : 'none';
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

function leave(gone: Slide) {
  const { page, under } = gone;
  // Its scroll-driven effects see the restored scroll only from the next frame.
  const opened =
    under &&
    new MutationObserver(() => {
      if (under.inert) return;
      opened?.disconnect();
      if (leaving === gone) leaving = null;
      requestAnimationFrame(() => {
        if (latest === gone) unpeek(under, true);
      });
    });
  if (under) opened?.observe(under, { attributeFilter: ['inert'] });
  setTimeout(() => {
    opened?.disconnect();
    if (leaving === gone) leaving = null;
    if (latest !== gone) return;
    // Back stayed on the page, or went elsewhere.
    if (page.isConnected && !page.inert) release(page);
    if (under?.inert) unpeek(under);
  }, BACK_MS);
  runAction('back');
}

function begin(side: 1 | -1): boolean {
  if (leaving) return false;
  const page = pageBackLeaves();
  if (!page) return false;
  page.toggleAttribute('data-sliding', true);
  // Before the pages' wash turns to the art of the page beneath.
  carryWash(page);
  const under = document.querySelector<HTMLElement>('main [data-back-to]');
  if (under) peek(under, side);
  latest = slide = { page, side, under };
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
    if (under) move(under, side, m.progress);
    return;
  }
  const back = slide;
  slide = null;
  glide(page, 'none', () => {
    if (latest !== back) return;
    release(page);
    if (under) unpeek(under);
  });
}

export function backPressed(): void {
  if (!slide) {
    runAction('back');
    return;
  }
  const current = slide;
  slide = null;
  leaving = current;
  if (current.under) settle(current.under);
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
