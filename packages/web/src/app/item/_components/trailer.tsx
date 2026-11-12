import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { createPortal } from 'react-dom';
import { LuChevronUp } from 'react-icons/lu';
import { cn } from '@aiostreams/ui/core/styling';
import { currentHost } from '@/lib/hosts';
import { focusOn, keyboardFocus, useAction, usingKeys } from '@/lib/input';
import { trailersOf } from '@/lib/playback/trailers';
import type { BaseItemDto } from '@/lib/jellyfin/types';
import {
  TrailerPreview,
  TrailerVeil,
  useTrailersOn,
  type TrailerEnd,
} from '@/features/trailers/preview';

/** How long the page sits untouched, at its top, before the trailer plays behind it. */
const IDLE_MS = 4000;
/** A pause in the wheel that ends one gesture, so a later one is new. */
const WHEEL_GAP_MS = 300;
/** How far up a new gesture turns the wheel to show the trailer whole: more than a notch. */
const WHEEL_PX = 150;

interface ItemTrailer {
  shown: boolean;
  /** Shows it over the whole window, from where it is. */
  openFull(): void;
}

export const ItemTrailerContext = React.createContext<ItemTrailer | null>(null);

const INPUT = ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const;

const atTop = () => (document.scrollingElement?.scrollTop ?? 0) < 2;

/**
 * The title's trailer behind its whole page once the page sits still, in
 * place of its backdrop; Up from the actions fades the page away from it.
 */
export function useItemTrailer(item: BaseItemDto | undefined) {
  const on = useTrailersOn('item');
  const has = !!item && trailersOf(item).length > 0;
  const [playing, setPlaying] = React.useState(false);
  const [shown, setShown] = React.useState(false);
  const [name, setName] = React.useState('');
  const [full, setFull] = React.useState(false);
  const [spot, setSpot] = React.useState<HTMLDivElement | null>(null);
  // Once over, it waits for the next visit.
  const [over, setOver] = React.useState(false);
  // The page goes inert under it, which drops focus.
  const left = React.useRef<HTMLElement | null>(null);
  const openFull = React.useCallback(() => {
    left.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setFull(true);
  }, []);
  React.useEffect(() => {
    if (full) return;
    const el = left.current;
    left.current = null;
    if (!el) return;
    // Once the pages are no longer inert, which takes their next render.
    const frame = requestAnimationFrame(() => el.isConnected && focusOn(el));
    return () => cancelAnimationFrame(frame);
  }, [full]);

  React.useEffect(() => {
    if (!on || !has || playing || over) return;
    let timer: ReturnType<typeof setTimeout>;
    const wait = () => {
      clearTimeout(timer);
      timer = setTimeout(() => (atTop() ? setPlaying(true) : wait()), IDLE_MS);
    };
    wait();
    const options = { capture: true, passive: true };
    for (const name of INPUT) addEventListener(name, wait, options);
    document.addEventListener('scroll', wait, options);
    return () => {
      clearTimeout(timer);
      for (const name of INPUT) removeEventListener(name, wait, options);
      document.removeEventListener('scroll', wait, options);
    };
  }, [on, has, playing, over]);
  React.useEffect(() => {
    if (!on) setPlaying(false);
  }, [on]);
  React.useEffect(() => {
    if (!playing) {
      setShown(false);
      setFull(false);
    }
  }, [playing]);

  useAction(
    'nav.up',
    () => {
      if (
        !keyboardFocus()?.closest(
          '[data-ui=item-actions], [data-ui=item-quick-actions]'
        )
      )
        return false;
      openFull();
    },
    shown && !full
  );

  // A wheel turned up from the top, as Up; not one still gliding there.
  React.useEffect(() => {
    if (!shown || full) return;
    let last = -Infinity;
    let fresh = false;
    let pushed = 0;
    const wheel = (e: WheelEvent) => {
      if (e.timeStamp - last > WHEEL_GAP_MS) {
        fresh = atTop();
        pushed = 0;
      }
      last = e.timeStamp;
      if (!fresh || e.deltaY >= 0) return;
      const unit =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 40
          : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? innerHeight
            : 1;
      pushed -= e.deltaY * unit;
      if (pushed < WHEEL_PX) return;
      fresh = false;
      openFull();
    };
    // The page's own empty space, around and above its details.
    const click = (e: MouseEvent) => {
      if (
        e.button === 0 &&
        e.target instanceof Element &&
        e.target.matches(
          '[data-ui=item-page], [data-ui=item-body], [data-ui=item-header]'
        ) &&
        !getSelection()?.toString()
      )
        openFull();
    };
    addEventListener('wheel', wheel, { passive: true });
    document.addEventListener('click', click);
    return () => {
      removeEventListener('wheel', wheel);
      document.removeEventListener('click', click);
    };
  }, [shown, full, openFull]);

  const context = React.useMemo<ItemTrailer>(
    () => ({ shown, openFull }),
    [shown, openFull]
  );
  const preview = playing && item && (
    <>
      {createPortal(
        <div
          ref={setSpot}
          data-ui="item-trailer"
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-[4]"
        >
          <div
            className={cn(
              'absolute inset-0 transition-opacity duration-500',
              full && 'opacity-0'
            )}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-[--background] via-[--background]/60 via-40% to-transparent rtl:bg-gradient-to-l" />
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[--background] via-[--background]/50 to-transparent" />
          </div>
          <TrailerVeil shown={shown} />
        </div>,
        document.body
      )}
      {spot && (
        <TrailerPreview
          item={item}
          spot={spot}
          full={full}
          onShown={(on, trailer) => {
            setShown(on);
            setName(trailer.name);
          }}
          onEnded={(end: TrailerEnd) => {
            setPlaying(false);
            if (end === 'over') setOver(true);
          }}
          onExitFull={() => setFull(false)}
        />
      )}
    </>
  );
  const keys = !!currentHost().tv || usingKeys();
  const hint = (
    <div
      data-ui="item-trailer-hint"
      aria-hidden={!shown || full}
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 z-[2] flex items-start gap-4 px-4 pt-4 transition-opacity duration-500 lg:ps-0 lg:pe-10',
        (!shown || full) && 'opacity-0'
      )}
    >
      <div data-name="playing" className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          <Trans>Playing</Trans>
        </p>
        <p className="truncate text-sm text-gray-300">{name}</p>
      </div>
      {keys ? (
        <div
          data-name="controls"
          className="flex flex-col items-center text-sm font-medium"
        >
          <LuChevronUp className="text-xl" />
          <Trans>Press Up for playback controls</Trans>
        </div>
      ) : (
        <button
          type="button"
          data-name="controls"
          tabIndex={-1}
          disabled={!shown || full}
          aria-label={t`Playback controls`}
          onClick={openFull}
          className="pointer-events-auto flex flex-col items-center rounded-xl px-3 py-1 text-sm font-medium transition-colors hover:bg-white/10"
        >
          <LuChevronUp className="text-xl" />
          <Trans>Scroll up for playback controls</Trans>
        </button>
      )}
      <div className="flex-1" />
    </div>
  );
  return { shown, context, preview, hint };
}
