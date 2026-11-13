import React from 'react';
import { cn } from '@aiostreams/ui/core/styling';
import { currentWash, subscribeWash } from '@/lib/artwork/background';
import { WASH_H, WASH_W } from '@/lib/artwork/wash';

const FADE_MS = 600;

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The artwork wash, each new one fading in over the last. The covered layer
 * is hidden after, so the screen composites one.
 */
export function ArtWash({ className }: { className?: string }) {
  const frame = React.useSyncExternalStore(subscribeWash, currentWash);
  const first = React.useRef<HTMLCanvasElement>(null);
  const second = React.useRef<HTMLCanvasElement>(null);
  const front = React.useRef<HTMLCanvasElement | null>(null);
  React.useLayoutEffect(() => {
    const layers = [first.current!, second.current!];
    if (!frame) {
      for (const layer of layers) layer.style.visibility = 'hidden';
      front.current = null;
      return;
    }
    const old = front.current;
    const next = old === layers[0] ? layers[1] : layers[0];
    // Opaque, so whatever lies beneath isn't drawn.
    next
      .getContext('2d', { alpha: false })
      ?.drawImage(frame.image, 0, 0, WASH_W, WASH_H);
    next.style.zIndex = '1';
    next.style.visibility = 'visible';
    front.current = next;
    if (!old) return;
    old.style.zIndex = '0';
    const hide = () => {
      if (front.current === next) old.style.visibility = 'hidden';
    };
    if (still()) return hide();
    next
      .animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: FADE_MS,
        easing: 'ease-out',
      })
      .finished.then(hide, hide);
  }, [frame]);
  return (
    <div
      data-ui="art-wash"
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden',
        className
      )}
      style={{ '--art-tint': frame?.tint } as React.CSSProperties}
    >
      {[first, second].map((ref, i) => (
        <canvas
          key={i}
          ref={ref}
          width={WASH_W}
          height={WASH_H}
          className="invisible absolute inset-0 h-full w-full object-cover"
        />
      ))}
    </div>
  );
}
