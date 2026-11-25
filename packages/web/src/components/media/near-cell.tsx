import React from 'react';
import { cn } from '@aiostreams/ui/core/styling';
import { ScrollRoot, watch } from '@/hooks/use-in-view';

// eslint-disable-next-line lingui/no-unlocalized-strings -- a root margin
const DRAWN_MARGIN = '100% 0px';

/**
 * A cell of a long list or grid, drawing what it holds only near the screen,
 * as every card kept mounted keeps its elements and its artwork. Out of sight
 * it keeps its height, or the last one measured, else `estimate`'s.
 */
export function NearCell({
  first,
  height,
  estimate,
  className,
  style,
  children,
  ref,
  ...props
}: {
  /** Drawn before it's first measured, as the first screen is. */
  first: boolean;
  /** The list's last measured cell height, shared by its cells. */
  height: React.RefObject<number>;
  estimate: string;
} & React.ComponentProps<'div'>) {
  const box = React.useRef<HTMLDivElement | null>(null);
  const root = React.useContext(ScrollRoot);
  const [shown, setShown] = React.useState(first);
  const drawn = React.useRef(shown);
  drawn.current = shown;
  const [held, setHeld] = React.useState<number>();
  const refs = React.useCallback(
    (el: HTMLDivElement | null) => {
      box.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [ref]
  );
  React.useEffect(() => {
    const el = box.current;
    if (!el) return;
    return watch(el, root, DRAWN_MARGIN, (entry) => {
      // Measured only while it holds its content, not an estimate.
      const h = entry.boundingClientRect.height;
      if (drawn.current && h > 0) height.current = h;
      if (entry.isIntersecting) return setShown(true);
      if (drawn.current && h > 0) setHeld(h);
      setShown(false);
    });
  }, [root, height]);
  const kept = shown ? undefined : held || height.current || undefined;
  return (
    <div
      ref={refs}
      {...props}
      className={cn(className, !shown && !kept && estimate)}
      style={kept ? { ...style, height: kept } : style}
    >
      {shown && children}
    </div>
  );
}

/** What `el` scrolls inside, where that isn't the page. */
export function scrollParent(el: Element): Element | null {
  for (
    let p = el.parentElement;
    p && p !== document.body;
    p = p.parentElement
  ) {
    const { overflowY } = getComputedStyle(p);
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      p.scrollHeight > p.clientHeight
    )
      return p;
  }
  return null;
}
