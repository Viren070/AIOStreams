import React from 'react';
import { useSession } from '../lib/session';
import { landscapeUrls } from '../lib/images';
import { itemTitle } from '../lib/format';
import type { BaseItemDto } from '../lib/types';
import { Artwork } from './cards';
import {
  OPEN_DELAY_MS,
  OpenDetails,
  OpenTitle,
  OpenTrailer,
  READY_MS,
  TRAILER_DELAY_MS,
} from './open-card';

/**
 * A grid's poster that, once a TV's focus rests on it, opens out over its
 * neighbours (the home's "opens" hero mode, in a grid): about three columns
 * wide at 16:9, its details on a band under it, its trailer after a while,
 * as on the home's rows. Nothing else in the grid moves; it opens leftward
 * near the grid's right edge, and keeps on screen. What it shows is made
 * ready under the poster first, so opening only places it and eases it in,
 * on the compositor.
 */

const COLUMNS = 3;
const OPEN_MS = 250;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
/** The details band's height, which the opened card keeps on screen with it. */
const DETAILS_PX = 116;
/** Room kept between the opened card and the screen's top and bottom. */
const MARGIN_PX = 16;

/** Where the opened card goes, from the cell, its grid and the screen. */
function place(cell: HTMLElement, overlay: HTMLElement): 'left' | 'right' {
  const grid = cell.closest<HTMLElement>('[data-ui=card-grid]') ?? cell;
  const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
  const poster =
    cell.querySelector<HTMLElement>('[data-ui=poster-card-image]') ?? cell;
  const at = cell.getBoundingClientRect();
  const bounds = grid.getBoundingClientRect();
  const width = Math.min(
    COLUMNS * at.width + (COLUMNS - 1) * gap,
    bounds.width
  );
  const height = (width * 9) / 16;
  // Leftward where rightward would pass the grid's edge, and never past its start.
  const rightward = at.left + width <= bounds.right + 1;
  let left = rightward ? 0 : at.width - width;
  left = Math.max(left, bounds.left - at.left);
  // Grown from the poster's middle, then moved up or down onto the screen.
  let top = poster.offsetTop + (poster.offsetHeight - height) / 2;
  const bottom = at.top + top + height + DETAILS_PX;
  if (bottom > innerHeight - MARGIN_PX)
    top -= bottom - (innerHeight - MARGIN_PX);
  if (at.top + top < MARGIN_PX) top += MARGIN_PX - (at.top + top);
  Object.assign(overlay.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
  });
  const frame = overlay.firstElementChild;
  if (frame instanceof HTMLElement) frame.style.height = `${height}px`;
  return rightward ? 'left' : 'right';
}

export function GridOpenCard({
  item,
  children,
}: {
  item: BaseItemDto;
  /** The grid's own poster card, which keeps focus. */
  children: React.ReactNode;
}) {
  const { client } = useSession();
  const [ready, setReady] = React.useState(false);
  const [trailer, setTrailer] = React.useState(false);
  const cell = React.useRef<HTMLDivElement>(null);
  const overlay = React.useRef<HTMLDivElement>(null);
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  const stop = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const shut = () => {
    const el = overlay.current;
    if (el) {
      el.removeAttribute('data-open');
      el.style.visibility = 'hidden';
    }
    if (cell.current) cell.current.style.zIndex = '';
  };
  const open = () => {
    const box = cell.current;
    const el = overlay.current;
    if (!box || !el) return;
    const from = place(box, el);
    box.style.zIndex = '20';
    el.style.visibility = 'visible';
    el.setAttribute('data-open', '');
    el.style.transformOrigin = `${from} center`;
    el.animate(
      [
        { opacity: 0, transform: 'scale(0.92)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: OPEN_MS, easing: EASE }
    );
  };
  React.useEffect(() => stop, []);
  // Sized as it mounts, so its picture is asked for and drawn before it opens.
  React.useLayoutEffect(() => {
    if (ready && cell.current && overlay.current)
      place(cell.current, overlay.current);
  }, [ready]);
  const onFocus = () => {
    stop();
    timers.current = [
      setTimeout(() => setReady(true), READY_MS),
      setTimeout(open, OPEN_DELAY_MS),
      setTimeout(() => setTrailer(true), OPEN_DELAY_MS + TRAILER_DELAY_MS),
    ];
  };
  const onBlur = () => {
    stop();
    shut();
    setReady(false);
    setTrailer(false);
  };
  const title = itemTitle(item);
  return (
    <div
      ref={cell}
      data-ui="grid-open-cell"
      className="relative"
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {children}
      {ready && (
        <div
          ref={overlay}
          data-ui="grid-open-card"
          aria-hidden
          // Drawn, so ready, but unseen until it opens; a layer of its own ahead.
          className="pointer-events-none invisible absolute left-0 top-0 will-change-transform"
        >
          <div className="relative overflow-hidden rounded-lg bg-gray-900 ring-[3px] ring-white">
            <Artwork
              src={(width) => landscapeUrls(client, item, { maxWidth: width })}
              alt={title}
            />
            {trailer && <OpenTrailer item={item} />}
            <OpenTitle item={item} />
          </div>
          <div className="-mt-2 rounded-b-lg bg-gray-950/95 px-3 pb-3 pt-4 shadow-2xl">
            <OpenDetails item={item} />
          </div>
        </div>
      )}
    </div>
  );
}
