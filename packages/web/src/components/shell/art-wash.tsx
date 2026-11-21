import React from 'react';
import { cn } from '@aiostreams/ui/core/styling';
import {
  currentWash,
  subscribeWash,
  takeCut,
  washDropped,
} from '@/lib/artwork/background';
import { WASH_H, WASH_W } from '@/lib/artwork/wash';

const FADE_MS = 600;

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The artwork wash, each new one fading in over the last, and the last
 * fading out when there's none. The covered layer is hidden after, so the
 * screen composites one.
 */
export function ArtWash({ className }: { className?: string }) {
  const frame = React.useSyncExternalStore(subscribeWash, currentWash);
  const first = React.useRef<HTMLCanvasElement>(null);
  const second = React.useRef<HTMLCanvasElement>(null);
  const front = React.useRef<HTMLCanvasElement | null>(null);
  React.useLayoutEffect(() => {
    const layers = [first.current!, second.current!];
    if (!frame) {
      // It fades out as it faded in, rather than going at once.
      const shown = front.current;
      front.current = null;
      const hideAll = () => {
        if (front.current) return;
        for (const layer of layers) layer.style.visibility = 'hidden';
      };
      if (!shown || still() || washDropped()) return hideAll();
      // Only the one in front fades; one it was still fading in over goes now.
      for (const layer of layers)
        if (layer !== shown) layer.style.visibility = 'hidden';
      const from = getComputedStyle(shown).opacity;
      for (const animation of shown.getAnimations()) animation.cancel();
      shown
        .animate([{ opacity: from }, { opacity: 0 }], {
          duration: FADE_MS,
          easing: 'ease-in',
          fill: 'forwards',
        })
        .finished.then(hideAll, hideAll);
      return;
    }
    const old = front.current;
    const next = old === layers[0] ? layers[1] : layers[0];
    // A fade out it was in the middle of, or ended with, goes; and with
    // nothing in front, so does the other's, which may still be fading out.
    for (const animation of next.getAnimations()) animation.cancel();
    if (!old)
      for (const layer of layers)
        if (layer !== next) {
          for (const animation of layer.getAnimations()) animation.cancel();
          layer.style.visibility = 'hidden';
        }
    // Opaque, so whatever lies beneath isn't drawn.
    next
      .getContext('2d', { alpha: false })
      ?.drawImage(frame.image, 0, 0, WASH_W, WASH_H);
    next.style.zIndex = '1';
    next.style.visibility = 'visible';
    front.current = next;
    // From nothing, as after another title's went at once, it fades in too,
    // but for what a back swipe shows at once.
    if (!old) {
      if (!still() && !takeCut(frame.src))
        next.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: FADE_MS,
          easing: 'ease-out',
        });
      return;
    }
    old.style.zIndex = '0';
    const hide = () => {
      if (front.current === next) old.style.visibility = 'hidden';
    };
    if (still() || takeCut(frame.src)) return hide();
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
