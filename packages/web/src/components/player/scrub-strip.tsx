import React from 'react';
import { cn } from '@aiostreams/ui/core/styling';
import { clock } from '../../lib/format';
import type { ThumbnailFeed } from '../../lib/playback/thumbnails';

/**
 * Odd, so the picked picture sits in the middle. More than fit, so a slide
 * carries the outer ones off the edges and brings the next ones on.
 */
const TILES = 9;
const SLIDE_MS = 150;

/** A remote's scrub: pictures a step apart, the one Select plays from in the middle. */
export function ScrubStrip({
  feed,
  atMs,
  stepMs,
  durationMs,
}: {
  feed: ThumbnailFeed;
  atMs: number;
  stepMs: number;
  durationMs: number;
}) {
  const half = (TILES - 1) / 2;
  const positions = Array.from(
    { length: TILES },
    (_, i) => atMs + (i - half) * stepMs
  );
  const inside = (ms: number) => ms >= 0 && (!durationMs || ms <= durationMs);
  const wanted = positions.filter(inside).join(',');
  React.useEffect(
    () => feed.wantRow(wanted.split(',').map(Number), atMs),
    [feed, wanted, atMs]
  );
  React.useEffect(() => () => feed.wantRow(null), [feed]);
  const pictures = React.useSyncExternalStore(feed.subscribe, feed.row);

  // Each step slides the row over by a picture.
  const row = React.useRef<HTMLDivElement>(null);
  const last = React.useRef(atMs);
  React.useLayoutEffect(() => {
    const moved = atMs - last.current;
    last.current = atMs;
    const [a, b] = row.current?.children ?? [];
    if (!moved || !(a instanceof HTMLElement) || !(b instanceof HTMLElement))
      return;
    const pitch = b.offsetLeft - a.offsetLeft;
    row.current?.animate(
      [
        { transform: `translateX(${Math.sign(moved) * pitch}px)` },
        { transform: 'none' },
      ],
      { duration: SLIDE_MS, easing: 'ease-out' }
    );
  }, [atMs]);

  if (!pictures) return null;
  return (
    <div
      aria-hidden
      data-ui="scrub-strip"
      // Clipped for the slide, with room for the picked ring.
      className="pointer-events-none mb-2 overflow-hidden py-2"
    >
      <div
        ref={row}
        // Kept as a layer, since one made as a slide starts draws nothing for a frame.
        className="flex justify-center gap-3 will-change-transform"
      >
        {positions.map((ms, i) => {
          const picked = i === half;
          const picture = pictures.get(ms);
          return (
            <div
              key={i}
              data-picked={picked || undefined}
              className={cn(
                'flex w-56 flex-none flex-col items-center gap-1.5',
                !inside(ms) && 'invisible'
              )}
            >
              <div
                className={cn(
                  'aspect-video w-full overflow-hidden rounded-md bg-white/10',
                  // As a focused card's.
                  picked &&
                    'outline outline-[3px] outline-offset-2 [outline-color:var(--ring)]'
                )}
              >
                {picture && (
                  <img
                    data-ui="scrub-strip-picture"
                    src={picture.src}
                    alt=""
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <span
                className={cn(
                  'text-xs tabular-nums',
                  picked ? 'text-white' : 'text-gray-400'
                )}
              >
                {clock(Math.max(0, ms))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
