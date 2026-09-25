import React from 'react';

/**
 * The element a page scrolls inside, where it is not the window. Content it
 * clips never counts as near the screen without it.
 */
export const ScrollRoot = React.createContext<Element | null>(null);

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
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && callback.current(),
      { root, rootMargin }
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, rootMargin, ...deps]);
  return ref;
}
