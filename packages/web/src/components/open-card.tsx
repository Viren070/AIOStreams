import React from 'react';
import { t } from '@lingui/core/macro';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '../lib/session';
import { useItem } from '../lib/queries';
import { landscapeUrls, logoUrl, posterUrl } from '../lib/images';
import { duration, itemTitle, progressOf, ticksToMs } from '../lib/format';
import type { BaseItemDto } from '../lib/types';
import { Anchor } from './anchor';
import { easeLayers } from '../lib/input/glide';
import { capHeight, isDash, playDash } from '../lib/playback/dash';
import { trailersOf, useTrailerPlayback } from '../lib/playback/trailers';
import { Artwork, ProgressBar, WatchedMark } from './cards';

/**
 * The home's "opens" hero mode on a TV: a row of posters whose focused one,
 * once focus rests on it, opens out to its landscape picture, a little taller,
 * with its details under it. The slide changes shape at once, in CSS on its
 * `data-open`, so the row lays out once; what moves is then eased on the
 * compositor from where it was drawn: the cards after it slide over,
 * uncovering its width, and it grows from the poster's height.
 */

/*
 * Sizes follow `--card-h`, a poster's height, which the home sets: a 2:3
 * poster, opened 16:9 and 15% taller. Each slide's width counts its padding.
 */
export const OPEN_ROW_ITEM =
  'basis-[calc(var(--card-h)*2/3+1rem)] data-[open]:basis-[calc(var(--card-h)*1.15*16/9+1rem)]';

/** How long focus rests on a card before it opens. */
export const OPEN_DELAY_MS = 700;
/**
 * When what opening shows is made ready, under the poster: the picture
 * fetched, decoded and drawn, the details asked for, the cards that will
 * slide given layers. Opening then only changes an attribute and eases.
 */
export const READY_MS = 400;
/** How long an opened card shows its picture before its trailer plays. */
export const TRAILER_DELAY_MS = 2500;
/** A card draws its trailer about 590px wide: no larger size is worth fetching. */
const TRAILER_HEIGHT = 720;
/** The cards after an opening one that slide in view, at most. */
const SLIDING = 8;
const OPEN_MS = 300;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
/** Room kept after an opened card at the row's end, as `media-row.tsx` keeps for focus. */
const ROOM = 16;

const still = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Scrolls the row so the opened card shows whole, eased as focus moves are. */
function reveal(slide: HTMLElement, row: HTMLElement, scroller: HTMLElement) {
  const left = row.offsetLeft + slide.offsetLeft;
  const right = left + slide.offsetWidth;
  const from = scroller.scrollLeft;
  if (right + ROOM <= from + scroller.clientWidth) return;
  scroller.scrollLeft = Math.min(right + ROOM - scroller.clientWidth, left);
  const layer = scroller.firstElementChild;
  if (layer instanceof HTMLElement && layer.hasAttribute('data-glide-layer'))
    easeLayers(layer, 'X', scroller.scrollLeft - from);
}

function following(slide: HTMLElement): HTMLElement[] {
  const slides = [...(slide.parentElement?.children ?? [])];
  return slides
    .slice(slides.indexOf(slide) + 1, slides.indexOf(slide) + 1 + SLIDING)
    .filter((el): el is HTMLElement => el instanceof HTMLElement);
}

/**
 * Layers for the card that will grow and those that will slide, made before
 * rather than as they start.
 */
function layered(slide: HTMLElement, on: boolean): void {
  const frame = slide.querySelector<HTMLElement>('[data-ui=open-card-image]');
  for (const el of [...(frame ? [frame] : []), ...following(slide)])
    el.style.willChange = on ? 'transform' : '';
}

/** Opens or closes `slide` at once, then eases what that moved. */
function reshape(slide: HTMLElement, open: boolean): void {
  const row = slide.parentElement;
  const frame = slide.querySelector<HTMLElement>('[data-ui=open-card-image]');
  const scroller = row?.closest<HTMLElement>('[data-nav-self-scroll]');
  if (!row || !frame || !scroller || still()) {
    slide.toggleAttribute('data-open', open);
    return;
  }
  const after = following(slide);
  const lefts = after.map((el) => el.offsetLeft);
  const was = frame.getBoundingClientRect();
  slide.toggleAttribute('data-open', open);
  const now = frame.getBoundingClientRect();
  const timing = { duration: OPEN_MS, easing: EASE };
  // Past the view's right edge nothing is seen moving.
  const end = scroller.scrollLeft + scroller.clientWidth - row.offsetLeft;
  after.forEach((el, i) => {
    const dx = lefts[i] - el.offsetLeft;
    if (!dx || Math.min(lefts[i], el.offsetLeft) > end) return;
    el.animate(
      [{ transform: `translateX(${dx}px)` }, { transform: 'none' }],
      timing
    );
  });
  if (!open) return;
  // On the compositor too, with the same timing: the card is drawn opened at
  // once, the card after it sliding off uncovers its width, and it grows to
  // its height from the poster's, keeping its left edge and its middle.
  // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS
  frame.style.transformOrigin = 'left center';
  frame.animate(
    [{ transform: `scale(${was.height / now.height})` }, { transform: 'none' }],
    timing
  );
  reveal(slide, row, scroller);
}

function typeLabel(type: string | null | undefined): string | null {
  switch (type) {
    case 'Movie':
      return t`Movie`;
    case 'Series':
      return t`Series`;
    case 'Episode':
      return t`Episode`;
    case 'BoxSet':
      return t`Collection`;
    default:
      return null;
  }
}

/** Type, genres, year, length and rating, as far as the item has them. */
function metaLine(item: BaseItemDto): string {
  const length = item.Type !== 'Series' && ticksToMs(item.RunTimeTicks);
  return [
    typeLabel(item.Type),
    ...(item.Genres ?? []).slice(0, 2),
    item.ProductionYear,
    length ? duration(length) : null,
    item.OfficialRating,
  ]
    .filter(Boolean)
    .join(' • ');
}

export function OpenDetails({ item }: { item: BaseItemDto }) {
  // The rows leave out the overview and genres.
  const details = useItem(item.Id ?? '');
  const full = details.data ?? item;
  return (
    <div
      data-ui="open-card-details"
      className="opacity-0 transition-opacity duration-300 [[data-open]_&]:opacity-100"
    >
      <p className="truncate text-sm font-semibold text-white">
        {metaLine(full)}
      </p>
      <p className="mt-1 line-clamp-3 text-base leading-snug text-white/80">
        {full.Overview}
      </p>
    </div>
  );
}

/** A thumb carries the title in the picture; over a plain backdrop it is laid on. */
export function OpenTitle({ item }: { item: BaseItemDto }) {
  const { client } = useSession();
  if (item.ImageTags?.Thumb) return null;
  const logo = logoUrl(client, item, { maxWidth: 320 });
  return (
    <div
      data-ui="open-card-title"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] flex h-1/2 items-end bg-gradient-to-t from-black/80 to-transparent p-3"
    >
      {logo ? (
        <img
          src={logo}
          alt=""
          draggable={false}
          className="max-h-16 max-w-[60%] object-contain object-left-bottom"
        />
      ) : (
        <span className="line-clamp-2 text-lg font-bold leading-tight text-white drop-shadow">
          {itemTitle(item)}
        </span>
      )}
    </div>
  );
}

/**
 * The title's trailer over the opened card's picture, with sound, shown once
 * it plays and gone as it ends, back to the picture. Shaka plays a DASH one
 * (a Samsung TV's), held to 720p; others play as they are. One that won't
 * play, as a YouTube video taken down or out of reach, gives way to the
 * title's next, before it starts; one failing after leaves the picture.
 */
export function OpenTrailer({ item }: { item: BaseItemDto }) {
  const details = useItem(item.Id ?? '');
  const trailers = details.data ? trailersOf(details.data) : [];
  const [at, setAt] = React.useState(0);
  const trailer = trailers[at];
  const playback = useTrailerPlayback(trailer?.url);
  const url = playback.data?.kind === 'video' ? playback.data.url : null;
  const unplayable =
    playback.isError || (!!playback.data && playback.data.kind !== 'video');
  React.useEffect(() => {
    if (unplayable) setAt((i) => i + 1);
  }, [unplayable, trailer?.url]);
  const video = React.useRef<HTMLVideoElement>(null);
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    const el = video.current;
    if (!el || !url) return;
    let gone = false;
    let played = false;
    let stop = () => {};
    const fail = () => {
      if (gone) return;
      setShown(false);
      if (!played) setAt((i) => i + 1);
    };
    const onPlaying = () => {
      played = true;
      setShown(true);
    };
    const onEnded = () => setShown(false);
    // A TV refusing to start it with sound starts it muted instead.
    const onCanPlay = () => {
      if (el.paused)
        el.play().catch(() => {
          el.muted = true;
          void el.play().catch(() => {});
        });
    };
    el.addEventListener('playing', onPlaying);
    el.addEventListener('ended', onEnded);
    el.addEventListener('canplay', onCanPlay);
    el.addEventListener('error', fail);
    if (isDash(url))
      void playDash(el, capHeight(url, TRAILER_HEIGHT), fail).then(
        (teardown) => {
          if (gone) teardown();
          else stop = teardown;
        }
      );
    else el.src = url;
    return () => {
      gone = true;
      stop();
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('canplay', onCanPlay);
      el.removeEventListener('error', fail);
      el.pause();
      el.removeAttribute('src');
      el.load();
    };
  }, [url]);
  return (
    <video
      ref={video}
      data-ui="open-card-trailer"
      autoPlay
      playsInline
      className={cn(
        'pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-500',
        shown ? 'opacity-100' : 'opacity-0'
      )}
    />
  );
}

export function OpenCard({ href, item }: { href: string; item: BaseItemDto }) {
  const { client } = useSession();
  const [ready, setReady] = React.useState(false);
  const [trailer, setTrailer] = React.useState(false);
  const ref = React.useRef<HTMLAnchorElement>(null);
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  const slide = () =>
    ref.current?.closest<HTMLElement>('[data-ui=media-row-item]') ?? null;
  const stop = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const close = () => {
    stop();
    const el = slide();
    if (el?.hasAttribute('data-open')) reshape(el, false);
    // Layers kept until the cards have slid back.
    if (el) setTimeout(() => layered(el, false), OPEN_MS + 50);
    setReady(false);
    setTrailer(false);
  };
  // A slide left open by a card no longer drawn would hold its width.
  React.useEffect(
    () => () => {
      stop();
      const el = slide();
      el?.removeAttribute('data-open');
      if (el) layered(el, false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const onFocus = () => {
    stop();
    timers.current = [
      setTimeout(() => {
        const el = slide();
        if (el) layered(el, true);
        setReady(true);
      }, READY_MS),
      setTimeout(() => {
        const el = slide();
        if (el) reshape(el, true);
      }, OPEN_DELAY_MS),
      setTimeout(() => setTrailer(true), OPEN_DELAY_MS + TRAILER_DELAY_MS),
    ];
  };
  const title = itemTitle(item);
  const progress = progressOf(item);
  return (
    <Anchor
      ref={ref}
      data-ui="open-card"
      data-focus="own"
      href={href}
      title={title}
      onFocus={onFocus}
      onBlur={close}
      className="group/open block"
    >
      {/* As tall as an opened card, which a poster sits in the middle of. */}
      <div className="flex h-[calc(var(--card-h)*1.15)] items-center">
        <div
          data-ui="open-card-image"
          data-focus-frame
          className="relative h-[--card-h] w-full overflow-hidden rounded-lg bg-gray-900 ring-1 ring-white/5 [[data-open]_&]:h-[calc(var(--card-h)*1.15)]"
        >
          {/*
            Laid out at its opened size from the start, centred as the frame
            grows, so opening neither measures nor asks for it again; drawn
            under the poster until then.
          */}
          {ready && (
            <div className="absolute left-0 top-[calc(50%-var(--card-h)*0.575)] h-[calc(var(--card-h)*1.15)] w-[calc(var(--card-h)*1.15*16/9)]">
              <Artwork
                src={(width) =>
                  landscapeUrls(client, item, { maxWidth: width })
                }
                alt={title}
              />
              {trailer && <OpenTrailer item={item} />}
              <OpenTitle item={item} />
            </div>
          )}
          {/* A poster's width throughout, so opening asks for no larger copy. */}
          <div className="absolute inset-y-0 left-0 w-[calc(var(--card-h)*2/3)] overflow-hidden rounded-[inherit] bg-gray-900 [[data-open]_&]:invisible">
            <Artwork
              src={(width) => posterUrl(client, item, { maxWidth: width })}
              alt={title}
            />
          </div>
          {item.UserData?.Played && <WatchedMark />}
          {!!progress && progress > 0 && <ProgressBar percent={progress} />}
        </div>
      </div>
      {/* Room for the details under every card, so the rows keep their places. */}
      <div className="h-[6.75rem] pt-3">
        {ready && <OpenDetails item={item} />}
      </div>
    </Anchor>
  );
}
