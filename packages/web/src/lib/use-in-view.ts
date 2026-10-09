import React from 'react';

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
function inRowSight(entry: IntersectionObserverEntry): boolean {
  const root = entry.rootBounds;
  if (!root) return true;
  const ahead = root.width / 3;
  const box = entry.boundingClientRect;
  return box.left < root.right - ahead && box.right > root.left + ahead;
}

type Watch = (entry: IntersectionObserverEntry) => void;

interface Pool {
  observer: IntersectionObserver;
  watches: Map<Element, Watch>;
}

/**
 * One observer for each root and margin, as the browser checks every observer
 * on each frame the page scrolls, and one per card costs a TV dearly.
 */
const pools = new Map<Element | null, Map<string, Pool>>();

function watch(
  el: Element,
  root: Element | null,
  rootMargin: string,
  onEntry: Watch
): () => void {
  let byMargin = pools.get(root);
  if (!byMargin) pools.set(root, (byMargin = new Map()));
  let pool = byMargin.get(rootMargin);
  if (!pool) {
    const watches = new Map<Element, Watch>();
    pool = {
      watches,
      observer: new IntersectionObserver(
        (entries) => {
          for (const entry of entries) watches.get(entry.target)?.(entry);
        },
        { root, rootMargin }
      ),
    };
    byMargin.set(rootMargin, pool);
  }
  const { observer, watches } = pool;
  watches.set(el, onEntry);
  observer.observe(el);
  return () => {
    if (watches.get(el) !== onEntry) return;
    watches.delete(el);
    observer.unobserve(el);
    if (watches.size) return;
    observer.disconnect();
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
