import React from 'react';
import { useSavedSrc } from '../lib/cache/images';
import { useInView } from '../lib/use-in-view';

/** An `<img>` that shows the device's saved copy, and saves what it loads. */
export function CachedImage({
  src,
  loading,
  style,
  ref,
  ...props
}: React.ComponentProps<'img'>) {
  // A lazy image waits until it nears the screen, as the browser would.
  const [near, setNear] = React.useState(loading !== 'lazy');
  const view = useInView<HTMLImageElement>(() => setNear(true), '300px');
  const shown = useSavedSrc(src, near);
  const refs = React.useCallback(
    (el: HTMLImageElement | null) => {
      view.current = el;
      if (typeof ref === 'function') return ref(el);
      if (ref) ref.current = el;
    },
    [view, ref]
  );
  return (
    <img
      {...props}
      ref={refs}
      src={shown}
      loading={loading}
      // Without a source an image would show its alt text while looking.
      style={shown === undefined ? { ...style, visibility: 'hidden' } : style}
    />
  );
}
