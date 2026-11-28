import React from 'react';
import { useSavedSrc } from '@/lib/cache/images';
import { useNear } from '@/hooks/use-in-view';

/** An `<img>` that shows the device's saved copy, and saves what it loads. */
export function CachedImage({
  src,
  loading,
  style,
  ref,
  ...props
}: React.ComponentProps<'img'>) {
  // A lazy image waits until it nears the screen, as the browser would.
  const [view, near] = useNear<HTMLImageElement>('300px', loading !== 'lazy');
  const saved = useSavedSrc(src, near);
  const shown = near ? saved : undefined;
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
      // Without a source an image would show its alt text while looking.
      style={shown === undefined ? { ...style, visibility: 'hidden' } : style}
    />
  );
}

/**
 * A CachedImage that keeps drawing its last picture while a changed `src`
 * loads out of sight, then swaps at once, so an address that changes as a
 * title's own details arrive never blanks it. Key it by the title it shows.
 */
export function SteadyImage({
  src,
  onError,
  ...props
}: React.ComponentProps<'img'>) {
  const [shown, setShown] = React.useState(src);
  const next = src !== shown ? src : undefined;
  return (
    <>
      <CachedImage {...props} src={shown} onError={onError} />
      {next && (
        <CachedImage
          key={next}
          src={next}
          alt=""
          aria-hidden
          className="hidden"
          onLoad={() => setShown(next)}
          onError={() => setShown(next)}
        />
      )}
    </>
  );
}
