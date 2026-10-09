import React from 'react';
import { currentHost } from './hosts';

/**
 * The element a page scrolls inside, where it is not the window. Content it
 * clips never counts as near the screen without it.
 */
export const ScrollRoot = React.createContext<Element | null>(null);

/**
 * A row's own scroller, which clips its cards so a page's margin never reaches
 * them: in a row nearness is measured by it, a row's width either way.
 */
export const RowScroller =
  React.createContext<React.RefObject<Element | null> | null>(null);

const ROW_MARGIN = '0px 100%';

/** In the row's own width, rather than in the width it reaches ahead by on each side. */
function inRowSight(entry: Sighting): boolean {
  const root = entry.rootBounds;
  if (!root) return true;
  const ahead = root.width / 3;
  const box = entry.boundingClientRect;
  return box.left < root.right - ahead && box.right > root.left + ahead;
}

/** The parts of an IntersectionObserverEntry read here. */
export interface Sighting {
  target: Element;
  isIntersecting: boolean;
  boundingClientRect: DOMRectReadOnly;
  rootBounds: DOMRectReadOnly | null;
}

type Watch = (entry: Sighting) => void;

interface Pool {
  root: Element | null;
  rootMargin: string;
  watches: Map<Element, Watch>;
  observer?: IntersectionObserver;
  /** Whether each target was in sight when last measured, on TVs. */
  seen: Map<Element, boolean>;
  /**
   * Where each target was against the pool's bounds, and the scroll that moves
   * it then: the page's for the screen, else the root's.
   */
  boxes: Map<Element, Box>;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  x: number;
  y: number;
  layout: number;
}

/**
 * One observer for each root and margin, as the browser checks every observer
 * on each frame the page scrolls, and one per card costs a TV dearly.
 */
const pools = new Map<Element | null, Map<string, Pool>>();

/*
 * TVs measure by hand after scrolls instead: while any intersection observer
 * watches, the web view runs a main-thread frame on every frame of a transform
 * animation, as each key's glide and focus scale are.
 */
const measured = new Set<Pool>();
/** Past a keyed scroll's glide, when targets are drawn where they are. */
const SETTLE_MS = 300;
const due = new Set<Pool>();
let queued = false;
/** Counts changes that can move targets other than scrolls. */
let layout = 0;
/** How far out of sight a target stays unread, as page scrolls only move it. */
const FAR_SCREENS = 2;

function measureSoon(pools: Iterable<Pool> = measured) {
  for (const pool of pools) due.add(pool);
  if (queued) return;
  queued = true;
  // After the frame, when layout is clean.
  requestAnimationFrame(() =>
    setTimeout(() => {
      queued = false;
      const changes: Change[] = [];
      // Each read of the page's layout costs a TV dearly, so these are shared.
      const screen = {
        y: scrollY,
        box: new DOMRect(0, 0, innerWidth, innerHeight),
      };
      for (const pool of due)
        if (measured.has(pool)) measure(pool, screen, changes);
      due.clear();
      for (const [onEntry, entry] of changes) onEntry(entry);
    })
  );
}

/** Now and once a glide has settled. */
function measureTwice(pools: Pool[]) {
  measureSoon(pools);
  setTimeout(() => measureSoon(pools), SETTLE_MS);
}

/** A row's scroll changes only what is measured against that row or the screen. */
function onScroll(e: Event) {
  const scroller = e.target instanceof Element ? e.target : null;
  measureTwice(
    [...measured].filter((p) => p.root === scroller || p.root === null)
  );
}

let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  const all = () => {
    layout++;
    measureTwice([...measured]);
  };
  document.addEventListener('scroll', onScroll, {
    capture: true,
    passive: true,
  });
  addEventListener('resize', all);
  addEventListener('hashchange', all);
  new ResizeObserver(() => {
    layout++;
    measureSoon();
  }).observe(document.documentElement);
}

/** The root's box grown by a CSS-style margin, whose percentages are of the root's size. */
function rootBounds(
  root: Element | null,
  margin: string,
  screen: DOMRect
): DOMRect | null {
  if (root && (!root.isConnected || root.checkVisibility?.() === false))
    return null;
  const box = root ? root.getBoundingClientRect() : screen;
  const [top, right = top, bottom = top, left = right] = margin
    .trim()
    .split(/\s+/)
    .map((v, i) =>
      v.endsWith('%')
        ? (parseFloat(v) / 100) * (i % 2 ? box.width : box.height)
        : parseFloat(v) || 0
    );
  return new DOMRect(
    box.left - left,
    box.top - top,
    box.width + left + right,
    box.height + top + bottom
  );
}

type Change = [Watch, Sighting];

interface Screen {
  y: number;
  box: DOMRect;
}

/** Collects what changed, so every box is read before callbacks write to the page. */
function measure(pool: Pool, screen: Screen, changes: Change[]) {
  const { root } = pool;
  const bounds = rootBounds(root, pool.rootMargin, screen.box);
  const x = root ? root.scrollLeft : 0;
  const y = root ? root.scrollTop : screen.y;
  // Rows scroll sideways inside the page, so the screen's targets skip only up and down.
  const farX = root && bounds ? bounds.width * FAR_SCREENS : Infinity;
  const farY =
    (root && bounds ? bounds.height : screen.box.height) * FAR_SCREENS;
  for (const [el, onEntry] of pool.watches) {
    const last = pool.boxes.get(el);
    if (bounds && last?.layout === layout && !pool.seen.get(el)) {
      const dx = x - last.x;
      const dy = y - last.y;
      if (
        last.left - dx > bounds.width + farX ||
        last.right - dx < -farX ||
        last.top - dy > bounds.height + farY ||
        last.bottom - dy < -farY
      )
        continue;
    }
    // A kept page is inert, and its boxes still read as on screen.
    const shown = !!bounds && el.isConnected && !el.closest('[inert]');
    const box = shown ? el.getBoundingClientRect() : new DOMRect();
    if (shown)
      pool.boxes.set(el, {
        left: box.left - bounds.left,
        top: box.top - bounds.top,
        right: box.right - bounds.left,
        bottom: box.bottom - bounds.top,
        x,
        y,
        layout,
      });
    const isIntersecting =
      shown &&
      box.right >= bounds.left &&
      box.left <= bounds.right &&
      box.bottom >= bounds.top &&
      box.top <= bounds.bottom;
    if (pool.seen.get(el) === isIntersecting) continue;
    pool.seen.set(el, isIntersecting);
    changes.push([
      onEntry,
      {
        target: el,
        isIntersecting,
        boundingClientRect: box,
        rootBounds: bounds,
      },
    ]);
  }
}

/** Calls `onEntry` as the element comes near `root` (the screen when null) and leaves it. */
export function watch(
  el: Element,
  root: Element | null,
  rootMargin: string,
  onEntry: Watch
): () => void {
  const tv = !!currentHost().tv;
  let byMargin = pools.get(root);
  if (!byMargin) pools.set(root, (byMargin = new Map()));
  let pool = byMargin.get(rootMargin);
  if (!pool) {
    const watches = new Map<Element, Watch>();
    pool = { root, rootMargin, watches, seen: new Map(), boxes: new Map() };
    if (tv) measured.add(pool);
    else
      pool.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) watches.get(entry.target)?.(entry);
        },
        { root, rootMargin }
      );
    byMargin.set(rootMargin, pool);
  }
  const { observer, watches, seen, boxes } = pool;
  const owner = pool;
  watches.set(el, onEntry);
  if (observer) observer.observe(el);
  else {
    listen();
    measureSoon([pool]);
  }
  return () => {
    if (watches.get(el) !== onEntry) return;
    watches.delete(el);
    seen.delete(el);
    boxes.delete(el);
    observer?.unobserve(el);
    if (watches.size) return;
    observer?.disconnect();
    measured.delete(owner);
    byMargin.delete(rootMargin);
    if (!byMargin.size) pools.delete(root);
  };
}

/**
 * Calls `onVisible` while the element is near the screen. `deps` re-arm it, so
 * a list sentinel still in view after a page loads asks for the next one.
 */
export function useInView<T extends Element>(
  onVisible: () => void,
  rootMargin = '600px',
  deps: unknown[] = []
) {
  const ref = React.useRef<T>(null);
  const root = React.useContext(ScrollRoot);
  const callback = React.useRef(onVisible);
  callback.current = onVisible;
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return watch(
      el,
      root,
      rootMargin,
      (entry) => entry.isIntersecting && callback.current()
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, rootMargin, ...deps]);
  return ref;
}

/**
 * Whether the element has come near the screen, which it then stays, and
 * whether it was in sight then rather than only coming up in a row.
 */
export function useNear<T extends Element>(
  rootMargin = '600px',
  already = false
) {
  const ref = React.useRef<T>(null);
  const root = React.useContext(ScrollRoot);
  const row = React.useContext(RowScroller);
  const [near, setNear] = React.useState(already);
  const [sight, setSight] = React.useState(true);
  React.useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    const scroller = row?.current;
    const stop = watch(
      el,
      scroller ?? root,
      scroller ? ROW_MARGIN : rootMargin,
      (entry) => {
        if (!entry.isIntersecting) return;
        stop();
        if (scroller) setSight(inRowSight(entry));
        setNear(true);
      }
    );
    return stop;
  }, [near, root, row, rootMargin]);
  return [ref, near, sight] as const;
}
