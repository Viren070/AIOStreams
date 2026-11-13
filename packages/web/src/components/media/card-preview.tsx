import { t } from '@lingui/core/macro';
import React from 'react';
import { createPortal, flushSync } from 'react-dom';
import { cn } from '@aiostreams/ui/core/styling';
import { useMediaQuery } from '@aiostreams/ui/hooks/media-query';
import { useSession } from '@/lib/jellyfin/session';
import { useItem } from '@/lib/jellyfin/queries';
import { currentHost } from '@/lib/hosts';
import { appBridge } from '@/lib/hosts/shell/bridge';
import { settings, useSetting } from '@/lib/settings';
import { pageRtl } from '@/lib/direction';
import { easeLayers, GLIDE_MS } from '@/lib/input/glide';
import {
  backdropUrls,
  cardImages,
  landscapeUrls,
  logoUrl,
} from '@/lib/artwork/urls';
import {
  airedLabel,
  duration,
  itemSubtitle,
  itemTitle,
  progressOf,
  remainingMs,
  ticksToMs,
} from '@/lib/format';
import { Artwork, ProgressBar } from './cards';
import { CachedImage } from '@/components/cached-image';
import { Scores, scoresOf } from './scores';
import { TrailerPreview, useTrailersOn } from '@/features/trailers/preview';
import { useLatest } from '@/hooks/use-latest';
import type { BaseItemDto } from '@/lib/jellyfin/types';

const POINTER_REST_MS = 800;
const FOCUS_REST_MS = 1200;
/** How long focus rests before the opened card's art is fetched and drawn, unseen. */
const READY_MS = 800;
/** How long a preview shows its art before its trailer starts. */
const TRAILER_MS = 1500;
/** How long a trailer plays before the details over it fade. */
const DETAILS_MS = 3000;
/** The cards after an opening one that slide, at most: the rest are out of sight. */
const SLIDING = 8;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
// A collection's card already shows all it has.
const previewed = ({ Type }: BaseItemDto) =>
  Type === 'Movie' || Type === 'Series' || Type === 'Episode';

interface Target {
  item: BaseItemDto;
  card: HTMLElement;
  byFocus: boolean;
}

interface Shown extends Target {
  inPlace: boolean;
}

interface Previews {
  rest(target: Target): void;
  /** Cancels only a waiting preview: an open one covers its card, so leaving the card enters it. */
  leave(): void;
  blur(): void;
}

const PreviewContext = React.createContext<Previews | null>(null);

export function useCardPreview(item: BaseItemDto) {
  const previews = React.useContext(PreviewContext);
  if (!previews || !previewed(item)) return undefined;
  return {
    // Not on enter, which rows scrolling under a still pointer also send.
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse')
        previews.rest({ item, card: e.currentTarget, byFocus: false });
    },
    onPointerLeave: previews.leave,
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      if ((e.target as Element).matches(':focus-visible'))
        previews.rest({ item, card: e.currentTarget, byFocus: true });
    },
    onBlur: previews.blur,
  };
}

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const slideOf = (card: HTMLElement) =>
  card.closest<HTMLElement>('[data-ui=media-row-item]');

const frameOf = (card: HTMLElement) =>
  card.querySelector<HTMLElement>('[data-focus-frame]');

function following(slide: HTMLElement): HTMLElement[] {
  const all = [...(slide.parentElement?.children ?? [])];
  const at = all.indexOf(slide);
  return all
    .slice(at + 1, at + 1 + SLIDING)
    .filter((el): el is HTMLElement => el instanceof HTMLElement);
}

function growthOf(frame: HTMLElement): number {
  return Math.max(
    0,
    Math.round((frame.offsetHeight * 16) / 9) - frame.offsetWidth
  );
}

function slideFrom(cards: HTMLElement[], lefts: number[]) {
  cards.forEach((el, i) => {
    const dx = lefts[i] - el.offsetLeft;
    if (dx)
      el.animate(
        [{ transform: `translateX(${dx}px)` }, { transform: 'none' }],
        { duration: GLIDE_MS, easing: EASE }
      );
  });
}

/** Scrolls a TV row so an opened card at its end shows whole. */
function reveal(slide: HTMLElement) {
  const scroller = slide.closest<HTMLElement>('[data-nav-self-scroll]');
  if (!scroller || pageRtl()) return;
  const view = scroller.getBoundingClientRect();
  const over = slide.getBoundingClientRect().right + 16 - view.right;
  if (over <= 0) return;
  const from = scroller.scrollLeft;
  scroller.scrollLeft = from + over;
  const layer = scroller.firstElementChild;
  if (layer instanceof HTMLElement && layer.hasAttribute('data-glide-layer'))
    easeLayers(layer, 'X', scroller.scrollLeft - from);
}

/**
 * Lays the card out opened at once, then eases what moved: the cards after
 * it slide over, and the card is uncovered from its old edge, its frame and
 * opened layer moving opposite ways.
 */
function openSlide(card: HTMLElement) {
  const slide = slideOf(card);
  const frame = frameOf(card);
  if (!slide || !frame) return;
  const grow = growthOf(frame);
  const height = frame.offsetHeight;
  const after = following(slide);
  const lefts = after.map((el) => el.offsetLeft);
  slide.style.flexBasis = `${slide.offsetWidth + grow}px`;
  slide.style.maxWidth = 'none';
  frame.style.height = `${height}px`;
  frame.style.aspectRatio = 'auto';
  slide.setAttribute('data-open', '');
  if (still()) return;
  const layer = frame.querySelector<HTMLElement>('[data-ui=open-card]');
  const poster = frame.querySelector<HTMLElement>('[data-ui=open-card-poster]');
  const shift = pageRtl() ? grow : -grow;
  const timing = { duration: GLIDE_MS, easing: EASE };
  // Already its opened shape, it only shows its details.
  if (!grow) {
    layer?.animate([{ opacity: 0 }, { opacity: 1 }], timing);
    return;
  }
  slide.setAttribute('data-opening', '');
  slideFrom(after, lefts);
  frame
    .animate(
      [{ transform: `translateX(${shift}px)` }, { transform: 'none' }],
      timing
    )
    .finished.then(
      () => slide.removeAttribute('data-opening'),
      () => {}
    );
  layer?.animate(
    [{ transform: `translateX(${-shift}px)` }, { transform: 'none' }],
    timing
  );
  poster?.animate([{ opacity: 1 }, { opacity: 0 }], {
    ...timing,
    fill: 'forwards',
  });
  reveal(slide);
}

/** At once, before focus moves on and its row measures where to scroll. */
function closeSlide(card: HTMLElement) {
  const slide = slideOf(card);
  const frame = frameOf(card);
  if (!slide?.hasAttribute('data-open') || !frame) return;
  const layer = frame.querySelector<HTMLElement>('[data-ui=open-card]');
  if (layer) layer.style.visibility = 'hidden';
  for (const el of [frame, layer])
    el?.getAnimations().forEach((a) => a.cancel());
  const after = following(slide);
  const lefts = after.map((el) => el.offsetLeft);
  slide.style.flexBasis = '';
  slide.style.maxWidth = '';
  frame.style.height = '';
  frame.style.aspectRatio = '';
  slide.removeAttribute('data-open');
  slide.removeAttribute('data-opening');
  slide.removeAttribute('data-trailer');
  if (!still()) slideFrom(after, lefts);
}

export function CardPreviewHost({ children }: { children: React.ReactNode }) {
  const [mode] = useSetting(settings.interface.cardPreview);
  const pointer = useMediaQuery(
    '(min-width: 1024px) and (hover: hover) and (pointer: fine)'
  );
  const on = mode !== 'off' && (pointer || !!currentHost().tv);
  const latestMode = React.useRef(mode);
  latestMode.current = mode;
  const [shown, setShown] = React.useState<Shown | null>(null);
  const shownRef = React.useRef(shown);
  shownRef.current = shown;
  const [ready, setReady] = React.useState<Target | null>(null);
  const pending = React.useRef<Target | null>(null);
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  const previews = React.useMemo<Previews>(() => {
    const cancel = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      pending.current = null;
    };
    const shut = () => {
      cancel();
      const was = shownRef.current;
      if (was?.inPlace) closeSlide(was.card);
      shownRef.current = null;
      setShown(null);
      setReady(null);
    };
    return {
      rest(target) {
        const known = pending.current ?? shownRef.current;
        if (known?.item === target.item && known.card === target.card) return;
        shut();
        pending.current = target;
        const inPlace =
          target.byFocus &&
          latestMode.current === 'open' &&
          !!slideOf(target.card) &&
          !!frameOf(target.card);
        const show = () => {
          pending.current = null;
          if (!target.card.isConnected) return;
          const next = { ...target, inPlace };
          shownRef.current = next;
          if (!inPlace) return setShown(next);
          // Shown before its layout changes, so no frame draws it half done.
          flushSync(() => setShown(next));
          openSlide(target.card);
        };
        if (inPlace)
          timers.current.push(setTimeout(() => setReady(target), READY_MS));
        timers.current.push(
          setTimeout(show, target.byFocus ? FOCUS_REST_MS : POINTER_REST_MS)
        );
      },
      leave: cancel,
      blur: shut,
    };
  }, []);
  React.useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      const was = shownRef.current;
      if (was?.inPlace) closeSlide(was.card);
    },
    []
  );

  const popped = shown && !shown.inPlace ? shown : null;
  React.useEffect(() => {
    if (!popped) return;
    const close = () => setShown(null);
    // A remote's move scrolls after focus begins the next card's wait, which goes on.
    const wheel = () => {
      previews.leave();
      close();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('scroll', close, {
      capture: true,
      passive: true,
    });
    addEventListener('wheel', wheel, { passive: true });
    addEventListener('resize', close);
    addEventListener('keydown', key);
    return () => {
      document.removeEventListener('scroll', close, { capture: true });
      removeEventListener('wheel', wheel);
      removeEventListener('resize', close);
      removeEventListener('keydown', key);
    };
  }, [popped, previews]);

  const frame = on && ready && frameOf(ready.card);
  return (
    <PreviewContext.Provider value={on ? previews : null}>
      {children}
      {on &&
        popped &&
        createPortal(
          <Preview target={popped} onClose={() => setShown(null)} />,
          document.body
        )}
      {ready &&
        frame &&
        createPortal(
          <OpenCard
            target={ready}
            frame={frame}
            open={shown?.card === ready.card}
          />,
          frame
        )}
    </PreviewContext.Provider>
  );
}

/** Centred over the whole card, its title too, inside its row and the window. */
function place(card: HTMLElement) {
  const frame = frameOf(card) ?? card;
  const r = frame.getBoundingClientRect();
  const whole = card.getBoundingClientRect();
  const row = card.closest('[data-ui=media-row]')?.getBoundingClientRect();
  const minX = Math.max(8, row?.left ?? 0);
  const maxX = Math.min(innerWidth - 8, row?.right ?? innerWidth);
  const width = Math.min(
    r.height > r.width
      ? (whole.height * 1.06 * 16) / 9
      : Math.min(Math.max(r.width * 1.35, r.height * 1.5, 320), 480),
    maxX - minX
  );
  const height = (width * 9) / 16;
  const left = Math.min(
    Math.max(r.left + r.width / 2 - width / 2, minX),
    maxX - width
  );
  const top = Math.min(
    Math.max(whole.top + whole.height / 2 - height / 2, 8),
    innerHeight - height - 8
  );
  return { left, top, width };
}

function useCardTrailer(on: boolean) {
  const allowed = useTrailersOn('cards');
  const [started, setStarted] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  React.useEffect(() => {
    if (!on || !allowed) return;
    const timer = setTimeout(() => setStarted(true), TRAILER_MS);
    return () => clearTimeout(timer);
  }, [on, allowed]);
  return {
    started: started && on && allowed,
    playing,
    setPlaying,
    stop: () => setStarted(false),
  };
}

const PREVIEW_RADIUS = 12;

function Preview({ target, onClose }: { target: Target; onClose(): void }) {
  const [at] = React.useState(() => place(target.card));
  const tv = !!currentHost().tv;
  const [spot, setSpot] = React.useState<HTMLDivElement | null>(null);
  const box = React.useRef<HTMLDivElement>(null);
  const trailer = useCardTrailer(true);
  const open = () =>
    target.card.querySelector<HTMLElement>('a[href], button')?.click();
  // The app's video over it takes the pointer, which the page then sees leave.
  const lifted = trailer.playing && !!currentHost().player;
  const latest = useLatest({ onClose, open });
  React.useEffect(() => {
    if (!lifted) return;
    const move = (e: PointerEvent) => {
      const r = box.current?.getBoundingClientRect();
      if (
        !r ||
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        latest.current.onClose();
    };
    document.addEventListener('pointermove', move);
    const stop = appBridge()?.subscribe((m) => {
      if (m.type === 'player-frame' && !('x' in m) && m.event === 'tap')
        latest.current.open();
    });
    return () => {
      document.removeEventListener('pointermove', move);
      stop?.();
    };
  }, [lifted, latest]);
  return (
    <div
      ref={box}
      aria-hidden
      data-ui="card-preview"
      data-type={target.item.Type}
      data-trailer={trailer.playing || undefined}
      style={at}
      className={cn(
        'fixed z-30 cursor-pointer overflow-hidden rounded-xl bg-gray-900 shadow-[0_24px_48px_-12px_rgb(0_0_0/0.85)] ring-1 ring-white/10',
        'duration-200 ease-out animate-in fade-in-0 zoom-in-90 motion-reduce:animate-none',
        target.byFocus &&
          'outline outline-[3px] outline-offset-2 outline-[var(--ring)]',
        tv && 'pointer-events-none'
      )}
      onPointerLeave={(e) => e.pointerType === 'mouse' && !lifted && onClose()}
      onClick={open}
      onContextMenu={(e) => {
        e.preventDefault();
        target.card.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: e.clientX,
            clientY: e.clientY,
          })
        );
        onClose();
      }}
    >
      <div ref={setSpot}>
        <PreviewBody listed={target.item} trailer={trailer.playing} />
      </div>
      {trailer.started && spot && (
        <TrailerPreview
          item={target.item}
          spot={spot}
          radius={PREVIEW_RADIUS}
          over
          onShown={trailer.setPlaying}
          onEnded={trailer.stop}
        />
      )}
    </div>
  );
}

/**
 * The card's opened layer, over its frame's own parts, with the poster fading
 * off its start as it opens. Drawn unseen first, so opening only moves it.
 */
function OpenCard({
  target,
  frame,
  open,
}: {
  target: Target;
  frame: HTMLElement;
  open: boolean;
}) {
  const { client } = useSession();
  const { item } = target;
  const [size] = React.useState(() => ({
    width: frame.offsetWidth,
    opened: frame.offsetWidth + growthOf(frame),
    radius: parseFloat(getComputedStyle(frame).borderTopLeftRadius) || 0,
  }));
  const [spot, setSpot] = React.useState<HTMLDivElement | null>(null);
  const trailer = useCardTrailer(open);
  React.useEffect(() => {
    slideOf(target.card)?.toggleAttribute('data-trailer', trailer.playing);
  }, [target.card, trailer.playing]);
  const grows = size.opened > size.width;
  return (
    <div
      ref={setSpot}
      data-ui="open-card"
      style={{ width: size.opened }}
      className={cn(
        'pointer-events-none absolute inset-y-0 start-0 overflow-hidden rounded-[inherit]',
        !open && 'invisible'
      )}
    >
      <PreviewBody listed={item} trailer={trailer.playing} fill />
      {grows && (
        <div
          data-ui="open-card-poster"
          style={{ width: size.width }}
          className="absolute inset-y-0 start-0"
        >
          <Artwork
            src={(width) =>
              cardImages(client, item, 'poster', { maxWidth: width })
            }
            alt=""
          />
        </div>
      )}
      {trailer.started && spot && (
        <TrailerPreview
          item={item}
          spot={spot}
          radius={size.radius}
          onShown={trailer.setPlaying}
          onEnded={trailer.stop}
        />
      )}
    </div>
  );
}

function PreviewBody({
  listed,
  trailer = false,
  fill = false,
}: {
  listed: BaseItemDto;
  /** Its trailer plays beneath: the art gives way, and the details soon after. */
  trailer?: boolean;
  fill?: boolean;
}) {
  const { client } = useSession();
  // A row's items leave out the overview and genres, but hold the latest watch state.
  const item = {
    ...(useItem(listed.Id ?? '').data ?? listed),
    UserData: listed.UserData,
  };
  const [quiet, setQuiet] = React.useState(false);
  React.useEffect(() => {
    if (!trailer) return setQuiet(false);
    const timer = setTimeout(() => setQuiet(true), DETAILS_MS);
    return () => clearTimeout(timer);
  }, [trailer]);
  const logo = logoUrl(client, item, { maxWidth: 480 });
  const [failedLogo, setFailedLogo] = React.useState<string>();
  const episode = item.Type === 'Episode';
  // A show's progress and running time aren't one video's.
  const series = item.Type === 'Series';
  const progress = progressOf(item);
  const leftMs = progress && !series ? remainingMs(item) : 0;
  const left = leftMs ? duration(leftMs) : '';
  const runtime = series ? '' : duration(ticksToMs(item.RunTimeTicks));
  const parts: [string, React.ReactNode][] = [
    ['year', !episode && item.ProductionYear],
    ['aired', episode && airedLabel(item)],
    ['score', scoresOf(item).length ? <Scores item={item} max={3} /> : null],
    ['length', left ? t`${left} left` : runtime],
    ['rating', item.OfficialRating],
  ];
  const meta = parts.filter(([, part]) => part);
  const genres = episode ? '' : (item.Genres ?? []).slice(0, 3).join(' · ');
  const fade = 'transition-opacity duration-500';

  return (
    <div className={cn('relative', fill ? 'h-full' : 'aspect-video')}>
      <div className={cn('absolute inset-0', fade, trailer && 'opacity-0')}>
        <Artwork
          // A thumb usually has the title in it, which the logo would repeat.
          src={(width) =>
            (episode ? landscapeUrls : backdropUrls)(client, item, {
              maxWidth: width,
            })
          }
          alt=""
        />
      </div>
      <div className={cn('absolute -inset-px', fade, quiet && 'opacity-0')}>
        {/* Past the box's clip: at a fractional size the shade can stop a row short. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/55 to-black/0" />
        <div className="absolute inset-x-0 bottom-0 space-y-1.5 px-4 pb-4">
          {logo && failedLogo !== logo ? (
            <CachedImage
              data-ui="card-preview-logo"
              src={logo}
              alt={itemTitle(item)}
              onError={() => setFailedLogo(logo)}
              className="max-h-10 w-auto max-w-[60%] object-contain object-left rtl:object-right"
            />
          ) : (
            <p
              data-ui="card-preview-title"
              className="line-clamp-1 text-lg font-bold"
            >
              {itemTitle(item)}
            </p>
          )}
          {episode && (
            <p
              data-ui="card-preview-episode"
              className="line-clamp-1 text-sm font-semibold"
            >
              {itemSubtitle(item)}
            </p>
          )}
          {meta.length > 0 && (
            <div
              data-ui="card-preview-meta"
              className="flex flex-wrap items-center gap-x-2 text-xs text-gray-300"
            >
              {meta.map(([name, part], i) => (
                <React.Fragment key={name}>
                  {i > 0 && (
                    <span data-ui="meta-separator" className="text-gray-500">
                      •
                    </span>
                  )}
                  <span data-name={name}>{part}</span>
                </React.Fragment>
              ))}
            </div>
          )}
          {genres && (
            <p
              data-ui="card-preview-genres"
              className="line-clamp-1 text-xs text-gray-400"
            >
              {genres}
            </p>
          )}
          {item.Overview && (
            <p
              data-ui="card-preview-overview"
              className="line-clamp-2 text-xs text-gray-300"
            >
              {item.Overview}
            </p>
          )}
        </div>
        {progress != null && progress > 0 && <ProgressBar percent={progress} />}
      </div>
    </div>
  );
}
