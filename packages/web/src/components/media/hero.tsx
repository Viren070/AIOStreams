import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { flushSync } from 'react-dom';
import { BiInfoCircle } from 'react-icons/bi';
import { IoPlay } from 'react-icons/io5';
import { Button, IconButton } from '@aiostreams/ui/button';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { cn } from '@aiostreams/ui/core/styling';
import { useMediaQuery } from '@aiostreams/ui/hooks/media-query';
import { useSession } from '@/lib/jellyfin/session';
import { settings, useSetting } from '@/lib/settings';
import { currentHost } from '@/lib/hosts';
import { usePageShown } from '@/lib/page-shown';
import { useFetchNextUp, useItem, useNextUpFor } from '@/lib/jellyfin/queries';
import { focusOn, keyboardFocus, useAction } from '@/lib/input';
import { ScrollRoot, watch } from '@/hooks/use-in-view';
import { backdropUrl, landscapeUrl, logoUrl } from '@/lib/artwork/urls';
import {
  clock,
  episodeCode,
  itemSubtitle,
  itemTitle,
  progressOf,
  ticksToMs,
} from '@/lib/format';
import { itemPath, navigate } from '@/lib/paths';
import {
  usePreloadVersions,
  useVersionPicker,
} from '@/features/versions/version-picker';
import { TopVersionBadges } from '@/features/versions/top-version-badges';
import { PlayProgress } from './play-progress';
import { ScoreRefresh, Scores, scoresOf } from './scores';
import { SeasonCount } from './season-count';
import type { JellyfinClient } from '@/lib/jellyfin/client';
import type { BaseItemDto } from '@/lib/jellyfin/types';
import { pageRtl } from '@/lib/direction';
import { useHold } from '@/hooks/use-hold';
import { useLatest } from '@/hooks/use-latest';
import { CachedImage, SteadyImage } from '@/components/cached-image';
import { useFetchPageAhead } from './page-ahead';
import {
  releaseArtSelection,
  useArtBackground,
} from '@/lib/artwork/background';
import { GlideLayers } from '@/components/shell/glide-layers';
import {
  TrailerPreview,
  TrailerVeil,
  useTrailersOn,
} from '@/features/trailers/preview';

const DRAG_SLOP_PX = 8;
const LAND_SHARE = 0.35;
const FLICK_PX_MS = 0.4;
const SETTLE_MS = 300;
/** How long the pointer or focus rests on a card before the hero follows it. */
const FOLLOW_DELAY_MS = 300;
/** How long a title rests in the hero before its trailer starts. */
const TRAILER_REST_MS = 2500;
const HERO_BOX =
  'relative -mt-[var(--top-bar,0px)] h-[max(26rem,75svh)] w-full overflow-hidden sm:h-[30rem] lg:-ms-[var(--side-bar,0px)] lg:h-[calc(var(--hero-height)+var(--top-bar,0px))] lg:w-[calc(100%+var(--side-bar,0px))]';
const HERO_CONTENT =
  'absolute inset-x-0 bottom-0 space-y-4 px-4 pb-8 max-sm:pb-12 max-sm:text-center lg:start-[var(--side-bar,0px)] lg:max-w-3xl lg:ps-0 lg:pe-10 lg:pb-14';

function Shade() {
  return (
    <>
      <div
        data-ui="hero-shade"
        data-name="side"
        className="absolute inset-0 bg-[--background] [mask-image:linear-gradient(to_right,black,rgb(0_0_0/0.7)_35%,transparent)] max-sm:hidden rtl:[mask-image:linear-gradient(to_left,black,rgb(0_0_0/0.7)_35%,transparent)]"
      />
      <div
        data-ui="hero-shade"
        data-name="bottom"
        className="absolute inset-x-0 bottom-0 h-2/3 bg-[--background] [mask-image:linear-gradient(to_top,black,rgb(0_0_0/0.6),transparent)] max-sm:h-1/2"
      />
    </>
  );
}

/** Keeps a backdrop within 2.6 times its height, so a wide window does not crop away most of it. */
export function BackdropFrame({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-ui="backdrop-frame"
      className={cn(
        'absolute inset-y-0 end-0 isolate w-full landscape:[mask-image:linear-gradient(to_right,transparent,black_12rem)] lg:[mask-image:linear-gradient(to_right,transparent,black_12rem)]',
        'rtl:landscape:[mask-image:linear-gradient(to_left,transparent,black_12rem)] rtl:lg:[mask-image:linear-gradient(to_left,transparent,black_12rem)]',
        className
      )}
    >
      {children}
    </div>
  );
}

function HeroTextSkeleton({ actions = true }: { actions?: boolean }) {
  // As HeroDetails lays its buttons out: in a column on a TV.
  const tv = currentHost().tv;
  return (
    <>
      <Skeleton className="h-12 w-64 max-sm:mx-auto lg:h-16 lg:w-96" />
      <Skeleton className="h-4 w-48 max-sm:mx-auto" />
      <div className="space-y-2">
        <Skeleton className="h-4 max-w-xl" />
        <Skeleton className="h-4 w-4/5 max-w-lg max-sm:mx-auto" />
      </div>
      {actions &&
        (tv ? (
          <div className="flex w-fit flex-col gap-2">
            <Skeleton className="h-10 w-32 rounded-full" />
            <Skeleton className="h-10 w-32 rounded-full" />
          </div>
        ) : (
          <div className="flex gap-2 max-sm:justify-center">
            <Skeleton className="h-10 w-40 rounded-full sm:w-28" />
            <Skeleton className="size-10 rounded-full sm:h-10 sm:w-32" />
          </div>
        ))}
    </>
  );
}

/** The hero's own box and shading, with its text and buttons blocked out. */
function HeroSkeleton() {
  return (
    <section aria-hidden data-ui="hero" data-loading className={HERO_BOX}>
      <div className="absolute inset-0 animate-pulse bg-[--subtle]" />
      <Shade />
      <div className={HERO_CONTENT}>
        <HeroTextSkeleton />
      </div>
    </section>
  );
}

function backdropSrc(client: JellyfinClient, item: BaseItemDto) {
  return (
    backdropUrl(client, item, { maxWidth: 1920 }) ??
    landscapeUrl(client, item, { maxWidth: 1920 }) ??
    undefined
  );
}

interface Layer {
  src: string;
  id: number;
  /** Faded in from nothing, which is quicker than over another. */
  quick: boolean;
  /** Shown at once, off screen. */
  still?: boolean;
  gone?: boolean;
  /** The side it slides in from: 1 the right, -1 the left. */
  from?: number;
}

/*
 * A turn's slide, slowing as it lands. Written as properties, since
 * `duration-[…]` and the like name a transition's as well and Tailwind makes
 * neither.
 */
const GLIDE =
  '[animation-duration:700ms] [animation-timing-function:cubic-bezier(0.22,1,0.36,1)]';
const TEXT_GLIDE =
  '[animation-duration:500ms] [animation-timing-function:cubic-bezier(0.22,1,0.36,1)]';
/** The logo, then the facts, then the overview, a beat apart. */
const TEXT_DELAYS = [
  '',
  'motion-safe:[animation-delay:70ms]',
  'motion-safe:[animation-delay:140ms]',
] as const;

let nextLayer = 0;
/** Fading layers kept at once, as each holds a whole decoded backdrop. */
const MAX_LAYERS = 4;
/** How long the last backdrop waits on the next before fading, so it doesn't sit behind another item. */
const WAIT_MS = 500;

const fadeAll = (all: Layer[]) =>
  all.every((l) => l.gone) ? all : all.map((l) => ({ ...l, gone: true }));

/**
 * Backdrops stacked as they are shown, each fading in over the ones before,
 * which stay as they are until it is whole, so nothing behind shows through.
 */
function Backdrops({
  current,
  fade = true,
  from = 0,
}: {
  current: string | undefined;
  fade?: boolean;
  /** The side a new backdrop glides in from, or 0 to only fade. */
  from?: number;
}) {
  const [loaded, setLoaded] = React.useState<ReadonlySet<string>>(new Set());
  const [layers, setLayers] = React.useState<Layer[]>([]);
  const side = useLatest(from);
  React.useEffect(() => {
    if (!current) return setLayers(fadeAll);
    if (!loaded.has(current)) {
      const timer = setTimeout(() => setLayers(fadeAll), WAIT_MS);
      return () => clearTimeout(timer);
    }
    setLayers((all) => {
      const top = all.at(-1);
      if (top?.src === current && !top.gone) return all;
      if (!fade)
        return [{ src: current, id: nextLayer++, quick: false, still: true }];
      return [
        ...all.slice(1 - MAX_LAYERS),
        {
          src: current,
          id: nextLayer++,
          quick: all.every((l) => l.gone),
          from: side.current || undefined,
        },
      ];
    });
  }, [current, loaded, fade]);

  const loading = current && !loaded.has(current) ? current : undefined;
  return (
    <>
      {loading && (
        <CachedImage
          key={`loading ${loading}`}
          src={loading}
          alt=""
          // Decoded before its layer fades in, which would otherwise start with nothing drawn.
          onLoad={(e) =>
            void e.currentTarget
              .decode()
              .catch(() => undefined)
              .then(() => setLoaded((set) => new Set(set).add(loading)))
          }
          className="absolute inset-0 h-full w-full opacity-0"
        />
      )}
      {layers.map((layer) => (
        <CachedImage
          key={layer.id}
          data-ui="hero-backdrop"
          src={layer.src}
          alt=""
          onAnimationEnd={(e) => {
            if (e.target !== e.currentTarget) return;
            setLayers((all) =>
              all.slice(
                Math.max(
                  0,
                  all.findIndex((l) => l.id === layer.id)
                )
              )
            );
          }}
          onTransitionEnd={(e) => {
            if (e.target !== e.currentTarget || !layer.gone) return;
            setLayers((all) => all.filter((l) => l.id !== layer.id));
          }}
          className={cn(
            // A layer made as a fade starts or ends draws nothing for a frame.
            'absolute inset-0 h-full w-full object-cover object-top will-change-[opacity]',
            layer.from && 'motion-safe:will-change-[opacity,transform]',
            layer.gone
              ? 'opacity-0 transition-opacity duration-700'
              : !layer.still &&
                  cn(
                    'animate-in fade-in-0',
                    layer.from
                      ? // Slides in from the side the title comes from, over the last.
                        cn(
                          layer.from > 0
                            ? 'motion-safe:slide-in-from-right-[3%]'
                            : 'motion-safe:slide-in-from-left-[3%]',
                          GLIDE
                        )
                      : layer.quick
                        ? '[animation-duration:400ms]'
                        : 'duration-700'
                  )
          )}
        />
      ))}
    </>
  );
}

/** An item's logo or title, facts, overview and buttons. */
function HeroDetails({
  item,
  overviewClass,
  actions = true,
  enter = 0,
  live = true,
  pending = false,
}: {
  item: BaseItemDto;
  overviewClass: string;
  actions?: boolean;
  /** The side a new title's text slides in from, or 0 to swap it at once. */
  enter?: number;
  /** On show, not a swipe's next or previous title waiting unseen. */
  live?: boolean;
  /** Off show, its own details are still to come. */
  pending?: boolean;
}) {
  const { client } = useSession();
  const picker = useVersionPicker();
  const fetchNextUp = useFetchNextUp();
  // What Play plays, as on the title's page: a show's next episode, else itself.
  const nextUp = useNextUpFor(item.Id!, live && item.Type === 'Series');
  // The title's own details, fetched afresh and kept, for scores that match
  // its page's; a list's rough score waits behind a spinner until they come.
  const fresh = useItem(live ? (item.Id ?? '') : '');
  // Its own details where they've come, as a list's watch state can be older.
  const target =
    item.Type === 'Series'
      ? nextUp.data?.Items?.[0]
      : item.Type === 'Movie' || item.Type === 'Episode'
        ? (fresh.data ?? item)
        : undefined;
  usePreloadVersions(live ? target : undefined);
  // Off show, the item as given: a follower hero passes its own details.
  const rated = live ? fresh.data : item;
  const scored = !!rated && scoresOf(rated).length > 0;
  const refreshing = live && fresh.isFetching;
  const resumeMs = ticksToMs(target?.UserData?.PlaybackPositionTicks);
  const code =
    target?.Type === 'Episode'
      ? episodeCode(target.ParentIndexNumber, target.IndexNumber)
      : '';
  const resumeAt = clock(resumeMs);
  const playLabel = resumeMs
    ? code
      ? t`Resume ${code}`
      : t`Resume from ${resumeAt}`
    : code
      ? t`Play ${code}`
      : t`Play`;
  // The size the title's page asks for, so it's in memory when that opens.
  // A list often knows no logo; the title's own details do, so the name waits.
  const pictured = live ? (fresh.data ?? item) : item;
  // Only while they're on their way: if they fail, the list's name shows.
  const waiting = live ? fresh.isPending : pending;
  const logo = logoUrl(client, pictured, { maxWidth: 416 });
  // By address, since the hero swaps items under the same details.
  const [failedLogo, setFailedLogo] = React.useState<string>();
  // Jellyfin cannot play a virtual item, such as an episode not yet aired.
  const playable =
    item.Type === 'Series' ||
    ((item.Type === 'Movie' || item.Type === 'Episode') &&
      item.LocationType !== 'Virtual');
  // While a show's next episode is asked for again, as after watching one,
  // Play waits for the answer rather than starting the episode just seen.
  const play = (held?: boolean) =>
    target && !(item.Type === 'Series' && nextUp.isFetching)
      ? picker.play(target, { startMs: resumeMs, held })
      : item.Type === 'Series'
        ? void fetchNextUp(item.Id!).then((episode) =>
            episode
              ? picker.play(episode, {
                  startMs: ticksToMs(episode.UserData?.PlaybackPositionTicks),
                  held,
                })
              : navigate(itemPath(item))
          )
        : picker.play(item, {
            startMs: ticksToMs(item.UserData?.PlaybackPositionTicks),
            held,
          });
  const holdPlay = useHold(() => play(true));
  const phone = useMediaQuery('(max-width: 639px)');
  // Seen from across a room, the button with focus lights up instead of taking a ring.
  const tv = currentHost().tv;
  // In a column, each button's icon and label line up at its start edge; it
  // shows no fill or edge until focus lights it white with black text.
  const lit =
    tv &&
    'justify-start border-transparent bg-opacity-0 focus-visible:bg-opacity-100 focus-visible:text-[#000]';
  const open = () => navigate(itemPath(item), { fromHero: phone });
  const parts: [string, React.ReactNode][] = [
    item.Type === 'Episode'
      ? ['episode', itemSubtitle(item)]
      : item.Type === 'Series'
        ? ['seasons', <SeasonCount series={item} enabled={live} />]
        : ['year', item.ProductionYear],
    [
      'score',
      scored ? (
        <ScoreRefresh active={refreshing}>
          <Scores item={rated} max={3} />
        </ScoreRefresh>
      ) : live && fresh.isPending ? (
        // Its place held, so the line doesn't shift when they come.
        <Skeleton className="inline-block h-4 w-20 align-middle" />
      ) : null,
    ],
    ['genres', item.Genres?.slice(0, 3).join(', ')],
  ];
  const meta = parts.filter(([, part]) => part);
  // Keyed by title, so each part slides in anew; the buttons stay, keeping focus.
  const glide = (step: 0 | 1 | 2) =>
    enter
      ? cn(
          'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:fill-mode-both',
          enter > 0
            ? 'motion-safe:slide-in-from-right-6'
            : 'motion-safe:slide-in-from-left-6',
          TEXT_GLIDE,
          TEXT_DELAYS[step]
        )
      : undefined;

  return (
    <>
      {logo && failedLogo !== logo ? (
        <SteadyImage
          key={`logo ${item.Id}`}
          data-ui="hero-logo"
          src={logo}
          alt={item.Name ?? ''}
          onError={() => setFailedLogo(logo)}
          className={cn(
            'max-h-20 max-w-[min(24rem,75%)] object-contain object-left max-sm:mx-auto max-sm:object-center lg:max-h-28',
            glide(0)
          )}
        />
      ) : waiting ? (
        <Skeleton
          key={`logo-wait ${item.Id}`}
          data-ui="hero-logo-placeholder"
          className="h-20 w-72 max-w-full max-sm:mx-auto lg:h-28"
        />
      ) : (
        <h1
          key={`title ${item.Id}`}
          data-ui="hero-title"
          className={cn(
            'line-clamp-2 text-3xl font-bold leading-tight lg:text-5xl',
            glide(0)
          )}
        >
          {itemTitle(item)}
        </h1>
      )}
      {meta.length > 0 && (
        <div
          key={`meta ${item.Id}`}
          data-ui="hero-meta"
          className={cn(
            // One height whether or not its badges have come.
            'flex min-h-6 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-gray-200 max-sm:justify-center',
            glide(1)
          )}
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
          {live && target && (
            <TopVersionBadges
              item={target}
              separator={
                <span data-ui="meta-separator" className="text-gray-500">
                  •
                </span>
              }
            />
          )}
        </div>
      )}
      {item.Overview && (
        <p
          key={`overview ${item.Id}`}
          data-ui="hero-overview"
          className={cn(
            'max-w-xl text-sm text-gray-300',
            overviewClass,
            glide(2)
          )}
        >
          {item.Overview}
        </p>
      )}
      {actions && (
        <div
          data-ui="hero-actions"
          className={cn(
            'flex flex-wrap gap-2 max-sm:justify-center',
            // One above the other, so Left and Right only turn the title;
            // Play at the bottom, nearest the rows.
            tv && 'w-fit flex-col-reverse flex-nowrap'
          )}
        >
          {playable && (
            <Button
              data-ui="hero-action"
              data-name="play"
              data-focus={tv ? 'own' : undefined}
              intent={tv ? 'white-subtle' : 'white'}
              className={cn('rounded-full max-sm:min-w-40', lit)}
              leftIcon={<IoPlay className="text-xl" />}
              onClick={() => play()}
              {...holdPlay}
            >
              <PlayProgress
                percent={resumeMs && target ? progressOf(target) : null}
              >
                {playLabel}
              </PlayProgress>
            </Button>
          )}
          {playable && phone ? (
            <IconButton
              data-ui="hero-action"
              data-name="info"
              intent="gray-outline"
              className="rounded-full"
              icon={<BiInfoCircle />}
              aria-label={t`More info`}
              onClick={open}
            />
          ) : (
            <Button
              data-ui="hero-action"
              data-name="info"
              data-focus={tv ? 'own' : undefined}
              intent={tv ? 'white-subtle' : playable ? 'gray-outline' : 'white'}
              className={cn('rounded-full', lit)}
              leftIcon={<BiInfoCircle className="text-xl" />}
              onClick={open}
            >
              <Trans>More info</Trans>
            </Button>
          )}
        </div>
      )}
    </>
  );
}

/** Fades the next or previous title in as far as a finger or the mouse drags sideways over the hero. */
function useSwipeFade(
  onLand: (step: 1 | -1) => void,
  onDragging: (dragging: boolean) => void
) {
  const latest = useLatest({ onLand, onDragging });
  const drag = React.useRef<{
    id: number;
    hero: HTMLElement;
    startX: number;
    startY: number;
    dx: number;
    at: number;
    velocity: number;
    /** The way the swipe set off, or 0 before it moves. */
    side: number;
  } | null>(null);
  const landing = React.useRef<{
    hero: HTMLElement;
    step: -1 | 0 | 1;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  React.useEffect(() => () => clearTimeout(landing.current?.timer), []);

  const show = (hero: HTMLElement, dx: number, animate: boolean) => {
    const shown = Math.min(1, Math.abs(dx) / hero.clientWidth);
    const coming = Math.sign(-dx);
    for (const el of hero.querySelectorAll<HTMLElement>('[data-slide]')) {
      const role = Number(el.dataset.slide);
      el.style.transition = animate ? `opacity ${SETTLE_MS}ms ease-out` : '';
      el.style.opacity = String(
        role
          ? role === coming
            ? shown
            : 0
          : el.hasAttribute('data-details')
            ? 1 - shown
            : 1
      );
    }
    const dots = [...hero.querySelectorAll<HTMLElement>('[data-ui=hero-dot]')];
    const from = dots.findIndex((d) => d.hasAttribute('data-current'));
    const to = coming ? (from + coming + dots.length) % dots.length : -1;
    dots.forEach((dot, i) => {
      // Between a dot's w-1.5 bg-white/25 and the current one's w-6 bg-white/70.
      const lit = i === from ? 1 - shown : i === to ? shown : null;
      dot.style.transition = animate
        ? `width ${SETTLE_MS}ms ease-out, background-color ${SETTLE_MS}ms ease-out`
        : 'none';
      dot.style.width = lit === null ? '' : `${0.375 + 1.125 * lit}rem`;
      dot.style.backgroundColor =
        lit === null ? '' : `rgb(255 255 255 / ${0.25 + 0.45 * lit})`;
    });
  };

  const settle = () => {
    const l = landing.current;
    if (!l) return;
    landing.current = null;
    clearTimeout(l.timer);
    // In the same frame as the styles go, so what faded in stays.
    flushSync(() => {
      if (l.step) latest.current.onLand(l.step);
    });
    for (const el of l.hero.querySelectorAll<HTMLElement>(
      '[data-slide], [data-ui=hero-dot]'
    )) {
      el.style.transition = '';
      el.style.opacity = '';
      el.style.width = '';
      el.style.backgroundColor = '';
    }
    latest.current.onDragging(false);
  };

  const release = (e: React.PointerEvent, cancel: boolean) => {
    const d = drag.current;
    if (d?.id !== e.pointerId) return;
    drag.current = null;
    if (!d.side) return;
    if (e.pointerType === 'mouse') {
      d.hero.style.userSelect = '';
      // The click that ends a drag mustn't press what it ends over.
      const swallow = (click: Event) => {
        click.preventDefault();
        click.stopPropagation();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() =>
        window.removeEventListener('click', swallow, { capture: true })
      );
    }
    const width = d.hero.clientWidth;
    const velocity = e.timeStamp - d.at > 100 ? 0 : d.velocity;
    const heading =
      Math.abs(velocity) > FLICK_PX_MS
        ? Math.sign(velocity)
        : Math.abs(d.dx) > width * LAND_SHARE
          ? Math.sign(d.dx)
          : 0;
    const step =
      cancel || !heading || heading !== Math.sign(d.dx)
        ? 0
        : heading < 0
          ? 1
          : -1;
    landing.current = {
      hero: d.hero,
      step,
      timer: setTimeout(settle, SETTLE_MS + 50),
    };
    show(d.hero, -step * width, true);
  };

  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      const mouse = e.pointerType === 'mouse';
      if (!e.isPrimary || (mouse ? e.button !== 0 : e.pointerType !== 'touch'))
        return;
      settle();
      drag.current = {
        id: e.pointerId,
        hero: e.currentTarget,
        startX: e.clientX,
        startY: e.clientY,
        dx: 0,
        at: e.timeStamp,
        velocity: 0,
        side: 0,
      };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current;
      if (d?.id !== e.pointerId) return;
      // Toward the row's end, which is leftward right to left.
      const moved = (e.clientX - d.startX) * (pageRtl() ? -1 : 1);
      if (!d.side) {
        if (
          Math.abs(moved) < DRAG_SLOP_PX ||
          Math.abs(moved) < Math.abs(e.clientY - d.startY)
        )
          return;
        d.side = Math.sign(moved);
        latest.current.onDragging(true);
        // A finger's pointer is held by the hero already; a mouse's leaves it.
        if (e.pointerType === 'mouse') {
          d.hero.setPointerCapture(e.pointerId);
          d.hero.style.userSelect = 'none';
          getSelection()?.removeAllRanges();
        }
      }
      // Back past the start only undoes the fade.
      const dx = d.side < 0 ? Math.min(0, moved) : Math.max(0, moved);
      if (e.timeStamp > d.at) d.velocity = (dx - d.dx) / (e.timeStamp - d.at);
      d.dx = dx;
      d.at = e.timeStamp;
      show(d.hero, dx, false);
    },
    onPointerUp: (e: React.PointerEvent) => release(e, false),
    // A system gesture takes the pointer, so the fade is undone.
    onPointerCancel: (e: React.PointerEvent) => release(e, true),
    // The mouse would carry off the artwork or a link instead.
    onDragStart: (e: React.DragEvent) => e.preventDefault(),
  };
}

/**
 * Android would fling a fast sideways swipe, though nothing scrolls, and take
 * the next tap anywhere as stopping it. Only a cancelled touch prevents that.
 */
function claimSideSwipes(el: HTMLElement): () => void {
  let from: { x: number; y: number } | null = null;
  let sideways: boolean | null = null;
  const start = (e: TouchEvent) => {
    from = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    sideways = null;
  };
  const move = (e: TouchEvent) => {
    if (!from || e.touches.length > 1) return;
    const { clientX, clientY } = e.touches[0];
    sideways ??= Math.abs(clientX - from.x) > Math.abs(clientY - from.y);
    if (sideways && e.cancelable) e.preventDefault();
  };
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchmove', move, { passive: false });
  return () => {
    el.removeEventListener('touchstart', start);
    el.removeEventListener('touchmove', move);
  };
}

function dotLabel(item: BaseItemDto): string {
  const name = item.Name ?? '';
  return t({
    comment: 'A dot under the banner that brings this title up',
    message: `Show ${name}`,
  });
}

/** Starts `item`'s trailer once it rests; one played out waits for another item. */
function useHeroTrailer(item: BaseItemDto | null, fades: boolean) {
  const on = useTrailersOn('hero');
  const [playing, setPlaying] = React.useState<BaseItemDto | null>(null);
  const [shown, setShown] = React.useState(false);
  // By id: a refetch hands the same title over as a new object.
  const id = item?.Id;
  const latest = useLatest(item);
  React.useEffect(() => {
    setPlaying(null);
    if (!id || !on) return;
    const timer = setTimeout(() => setPlaying(latest.current), TRAILER_REST_MS);
    return () => clearTimeout(timer);
  }, [id, on, latest]);
  React.useEffect(() => {
    if (!playing) setShown(false);
  }, [playing]);
  const box = playing && (
    <HeroTrailer
      key={playing.Id}
      item={playing}
      fades={fades}
      onShown={setShown}
      onEnded={() => setPlaying(null)}
    />
  );
  return { box, shown: !!playing && shown };
}

/**
 * A trailer in a wide box as tall as the hero, at its end, drawn beneath the
 * backdrop, which fades off it once it plays; where it lies inside a larger
 * backdrop, its edges fade into the page.
 */
function HeroTrailer({
  item,
  fades,
  onShown,
  onEnded,
}: {
  item: BaseItemDto;
  fades: boolean;
  onShown(shown: boolean): void;
  onEnded(): void;
}) {
  const [spot, setSpot] = React.useState<HTMLDivElement | null>(null);
  const [shown, setShown] = React.useState(false);
  return (
    <div
      ref={setSpot}
      data-ui="hero-trailer"
      // Wide, so a trailer's own bars are cropped away, even where that runs past the hero's start.
      className="pointer-events-none absolute end-0 top-0 aspect-[2.39/1] h-full"
    >
      <div className="absolute -inset-px">
        {fades && (
          <>
            <div className="absolute inset-y-0 start-0 w-2/5 bg-[--background] [mask-image:linear-gradient(to_right,black,rgb(0_0_0/0.6)_30%,transparent)] rtl:[mask-image:linear-gradient(to_left,black,rgb(0_0_0/0.6)_30%,transparent)]" />
            <div className="absolute inset-x-0 bottom-0 h-2/5 bg-[--background] [mask-image:linear-gradient(to_top,black,rgb(0_0_0/0.6)_30%,transparent)]" />
            <div className="absolute inset-x-0 top-0 h-[12%] bg-[--background] [mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.7),transparent)]" />
          </>
        )}
        <TrailerVeil shown={shown} />
      </div>
      {spot && (
        <TrailerPreview
          item={item}
          spot={spot}
          within={spot.parentElement ?? undefined}
          soft
          onShown={(on) => {
            setShown(on);
            onShown(on);
          }}
          onEnded={onEnded}
        />
      )}
    </div>
  );
}

/** After the first screen's own pictures. */
const WARM_AFTER_MS = 2000;

/**
 * Fetches each featured title's page in the background, one after another, so
 * the hero shows its details at once as it turns to each, and More info opens
 * with its pictures, faces and episodes in.
 */
function useWarmTitles(featured: BaseItemDto[]) {
  const fetchPage = useLatest(useFetchPageAhead());
  const latest = useLatest(featured);
  const ids = featured.map((f) => f.Id ?? '').join(',');
  React.useEffect(() => {
    if (!ids) return;
    let live = true;
    const timer = setTimeout(async () => {
      // The first shown decoded too, the rest only fetched, as decoded
      // pictures take memory.
      for (const [i, item] of latest.current.entries()) {
        if (!live) return;
        if (item.Id) await fetchPage.current(item.Id, undefined, i === 0);
      }
    }, WARM_AFTER_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [ids, fetchPage, latest]);
}

/** The side a step's title comes in from; right to left, the next lies to the left. */
const sideOf = (step: number) => (pageRtl() ? -step : step);

/** A rotating feature of a few titles at the top of the home page. */
export function Hero({
  items,
  loading,
}: {
  items: BaseItemDto[];
  loading: boolean;
}) {
  const { client } = useSession();
  const featured = items.filter((i) => backdropSrc(client, i));
  const [index, setIndex] = React.useState(0);
  useWarmTitles(featured);
  /** The side the title on show came in from: 1 the right, -1 the left, 0 by a swipe or at first. */
  const [from, setFrom] = React.useState(0);
  useArtBackground(featured[index]);
  const [seconds] = useSetting(settings.interface.heroSeconds);
  const [paused, setPaused] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  // Keys of the previous, current and next slides, passed round as a swipe
  // lands so the slide faded in stays mounted.
  const [slots, setSlots] = React.useState<[number, number, number]>([0, 1, 2]);
  // Only a title the user went to plays its trailer, not one the page opened on.
  const [chosen, setChosen] = React.useState(false);
  // A title picked here takes the background back from a card rested on.
  React.useEffect(() => {
    if (chosen) releaseArtSelection();
  }, [chosen, index]);
  const swipe = useSwipeFade((step) => {
    setChosen(true);
    // The swipe has faded it in already.
    setFrom(0);
    setIndex((i) => (i + step + featured.length) % featured.length);
    setSlots(([prev, main, next]) =>
      step > 0 ? [main, next, prev] : [next, prev, main]
    );
  }, setDragging);
  const tv = currentHost().tv;
  const swipeable = !tv && featured.length > 1;
  const shown = usePageShown();
  const section = React.useRef<HTMLElement>(null);
  const [focused, setFocused] = React.useState(false);
  const [inSight, setInSight] = React.useState(true);
  React.useEffect(() => {
    const el = section.current;
    if (!el) return;
    return watch(el, null, '0px', (entry) => setInSight(entry.isIntersecting));
  }, [loading, featured.length]);
  React.useEffect(() => {
    const el = section.current;
    if (el && swipeable) return claimSideSwipes(el);
  }, [loading, swipeable]);

  React.useEffect(() => {
    setIndex(0);
    setFrom(0);
  }, [featured.length]);
  React.useEffect(() => {
    if (
      paused ||
      focused ||
      dragging ||
      !shown ||
      !inSight ||
      featured.length < 2
    )
      return;
    const timer = setTimeout(() => {
      setFrom(sideOf(1));
      setIndex((i) => (i + 1) % featured.length);
    }, seconds * 1000);
    return () => clearTimeout(timer);
  }, [
    index,
    paused,
    focused,
    dragging,
    shown,
    inSight,
    featured.length,
    seconds,
  ]);

  /** The button focus lands on in the next title; -1 is the last. */
  const landing = React.useRef<number | null>(null);
  /** On a TV, the name of the button focus was on, to land on it again. */
  const landingName = React.useRef<string | undefined>(undefined);
  const turn = (step: 1 | -1) => {
    const actions = [
      ...(section.current?.querySelectorAll<HTMLElement>(
        '[data-ui=hero-action]'
      ) ?? []),
    ];
    const at = actions.indexOf(keyboardFocus()!);
    // From the first title, Left leaves for the navigation. Side by side,
    // Left and Right go along the buttons before they turn the title.
    if (at < 0 || (!tv && actions[at + step]) || (step < 0 && !index))
      return false;
    // A TV's buttons stand in a column, and focus stays on the same one.
    landing.current = tv ? at : step > 0 ? 0 : -1;
    landingName.current = tv ? actions[at].dataset.name : undefined;
    setChosen(true);
    setFrom(sideOf(step));
    setIndex((i) => (i + step + featured.length) % featured.length);
  };
  const turning = focused && featured.length > 1;
  // Right to left, the next title lies to the left.
  const [right, left]: (1 | -1)[] = pageRtl() ? [-1, 1] : [1, -1];
  useAction('nav.right', () => turn(right), turning);
  useAction('nav.left', () => turn(left), turning);
  React.useLayoutEffect(() => {
    const to = landing.current;
    const name = landingName.current;
    landing.current = null;
    landingName.current = undefined;
    const actions = section.current?.querySelectorAll<HTMLElement>(
      '[data-ui=hero-action]'
    );
    if (to === null || !actions?.length) return;
    // The same button by name, as a title that can't play has fewer.
    const el =
      [...actions].find((a) => name && a.dataset.name === name) ??
      actions[to < 0 ? actions.length - 1 : Math.min(to, actions.length - 1)];
    focusOn(el);
  }, [index]);

  const trailer = useHeroTrailer(
    chosen && (focused || paused) ? (featured[index] ?? null) : null,
    false
  );

  if (loading) return <HeroSkeleton />;
  if (!featured[index]) return null;
  // In a fixed order, so a landing never moves their nodes.
  const slides = (swipeable ? [0, 1, 2] : [slots[1]]).map((key) => {
    const role = slots.indexOf(key) - 1;
    const at = (index + role + featured.length) % featured.length;
    return { key, role, item: featured[at] };
  });
  // Layers made up front, as in Backdrops.
  const slideClass = (role: number) =>
    cn(
      'absolute inset-0',
      role && 'opacity-0',
      swipeable && 'will-change-[opacity]'
    );

  return (
    <section
      ref={section}
      data-ui="hero"
      data-nav-top
      className={cn(HERO_BOX, 'touch-pan-y touch-pinch-zoom')}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => {
        setPaused(false);
        if (!focused) setChosen(false);
      }}
      onFocus={(e) => {
        setFocused(true);
        if (
          e.relatedTarget instanceof Element &&
          !e.currentTarget.contains(e.relatedTarget)
        )
          setChosen(true);
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setFocused(false);
        setChosen(false);
      }}
      {...(swipeable ? swipe : {})}
    >
      {trailer.box}
      <div
        data-ui="hero-art"
        // Fades out at its edge, where some GPUs draw the art's last row past
        // the shade. Not on the art's own box, which moves as the page scrolls.
        className="absolute inset-0 [mask-image:linear-gradient(to_top,transparent,black_2px)]"
      >
        <div
          data-ui="hero-backdrops"
          className={cn(
            'absolute inset-0 isolate transition-opacity duration-700',
            trailer.shown && 'opacity-0'
          )}
        >
          {slides.map(({ key, role, item }) => (
            <div
              key={key}
              data-slide={role}
              className={cn(slideClass(role), role && 'z-[1]')}
            >
              <BackdropFrame className="max-w-[calc(26rem*2.6)] sm:max-w-[calc(30rem*2.6)] lg:max-w-[calc(var(--hero-height)*2.6)]">
                <Backdrops
                  current={backdropSrc(client, item)}
                  fade={!role}
                  from={role ? 0 : from}
                />
              </BackdropFrame>
            </div>
          ))}
        </div>
      </div>
      <Shade />
      {slides.map(({ key, role, item }) => (
        <div
          key={key}
          data-slide={role}
          data-details
          inert={!!role}
          className={slideClass(role)}
        >
          <div data-ui="hero-content" className={HERO_CONTENT}>
            <HeroDetails
              item={item}
              overviewClass="line-clamp-2 sm:line-clamp-3 sm:text-base"
              enter={role ? 0 : from}
              live={!role}
            />
          </div>
        </div>
      ))}

      {featured.length > 1 && (
        <div
          data-ui="hero-dots"
          // At the bottom, in the middle.
          className="absolute inset-x-0 bottom-3 flex justify-center gap-4 lg:bottom-6"
        >
          {featured.map((f, i) => (
            <button
              key={f.Id}
              type="button"
              data-ui="hero-dot"
              data-current={i === index || undefined}
              data-nav="skip"
              aria-label={dotLabel(f)}
              onClick={() => {
                setChosen(true);
                if (i !== index) setFrom(sideOf(i > index ? 1 : -1));
                setIndex(i);
              }}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === index ? 'w-6 bg-white/70' : 'w-1.5 bg-white/25'
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface Follow {
  focus(item: BaseItemDto): void;
  point(item: BaseItemDto): void;
  leave(): void;
}

const FollowContext = React.createContext<Follow | null>(null);

/** A card's handlers under a hero that follows the selected card, where there is one. */
export function useHeroTarget(item: BaseItemDto) {
  const follow = React.useContext(FollowContext);
  if (!follow) return undefined;
  return {
    // Not on enter, which rows scrolling under a still pointer also send.
    onPointerMove: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') follow.point(item);
    },
    onPointerLeave: follow.leave,
    onFocus: () => follow.focus(item),
  };
}

/** The whole window's backdrop, or the hero's top corner's. */
function FollowBackdrop({
  item,
  corner,
  trailer,
}: {
  item: BaseItemDto | undefined;
  corner: boolean;
  trailer: { box: React.ReactNode; shown: boolean };
}) {
  const { client } = useSession();
  const src = item && backdropSrc(client, item);
  const fade = cn(
    'transition-opacity duration-700',
    trailer.shown && 'opacity-0'
  );
  const box = (
    <div className="absolute inset-x-0 top-0 h-[var(--hero-h)]">
      {trailer.box}
    </div>
  );

  if (corner)
    return (
      <>
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
          {box}
        </div>
        <div
          aria-hidden
          data-ui="hero-corner"
          // Masks rather than shades, which leave a seam beside the fading layers.
          className={cn(
            'pointer-events-none fixed end-0 top-0 -z-10 aspect-video max-h-[calc(var(--hero-h)*1.4)] w-[70vw] overflow-hidden [mask-image:linear-gradient(to_right,transparent,rgb(0_0_0/0.4)_20%,black_45%)] rtl:[mask-image:linear-gradient(to_left,transparent,rgb(0_0_0/0.4)_20%,black_45%)]',
            fade
          )}
        >
          <div className="absolute inset-0 [mask-image:linear-gradient(to_bottom,black_45%,rgb(0_0_0/0.4)_75%,transparent)]">
            <Backdrops current={src} />
          </div>
        </div>
      </>
    );
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {box}
      <div data-ui="hero-art" className="absolute inset-0">
        <BackdropFrame className={cn('max-w-[calc(100vh*2.6)]', fade)}>
          <Backdrops current={src} />
        </BackdropFrame>
      </div>
      <Shade />
    </div>
  );
}

/** Fills in what a row leaves out, such as the overview. */
function FollowDetails({ item }: { item: BaseItemDto }) {
  const details = useItem(item.Id ?? '');
  return (
    <HeroDetails
      item={details.data ?? item}
      // Three lines kept, so the title does not jump as details arrive.
      overviewClass="line-clamp-3 h-[3lh] sm:text-base"
      // On a TV it shows the card with focus, which Select already opens.
      actions={!currentHost().tv}
      // Without its buttons it needn't find what they'd play for each card.
      live={!currentHost().tv}
      pending={details.isPending}
    />
  );
}

/** Each user's last pick, so coming back to home keeps it until the app closes. */
const lastPicks = new Map<string, BaseItemDto>();

/**
 * The hero pinned above the rows, showing the card the pointer rests on or the
 * keyboard is on. The rows scroll beneath it, over the whole window's backdrop
 * unless it keeps to the `corner`.
 */
export function FollowHero({
  items,
  loading,
  corner = false,
  children,
}: {
  /** Candidates until a card is picked; the first with a backdrop is shown. */
  items: BaseItemDto[];
  loading: boolean;
  corner?: boolean;
  children: React.ReactNode;
}) {
  const { client, user } = useSession();
  const userKey = `${client.base}:${user.Id}`;
  const [picked, setPicked] = React.useState(() => lastPicks.get(userKey));
  // The picked card, while focus or the pointer is still on it.
  const [resting, setResting] = React.useState<BaseItemDto | null>(null);
  React.useEffect(() => {
    if (picked) lastPicks.set(userKey, picked);
  }, [picked, userKey]);
  const [scroller, setScroller] = React.useState<HTMLDivElement | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const follow = React.useMemo<Follow>(() => {
    let pointed: BaseItemDto | undefined;
    let pointerPick = false;
    const pick = (item: BaseItemDto, byPointer: boolean) => {
      pointerPick = byPointer;
      clearTimeout(timer.current);
      setResting(null);
      timer.current = setTimeout(() => {
        setPicked(item);
        setResting(item);
      }, FOLLOW_DELAY_MS);
    };
    return {
      focus: (item) => pick(item, false),
      point: (item) => {
        if (item === pointed) return;
        pointed = item;
        pick(item, true);
      },
      // Only the pointer's own pick: rows scrolling away from it leave cards too.
      leave: () => {
        pointed = undefined;
        if (!pointerPick) return;
        clearTimeout(timer.current);
        setResting(null);
      },
    };
  }, []);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  // A TV's top bar steps aside while focus is in the rows, showing more of the
  // hero; Back still reaches it.
  React.useEffect(() => {
    if (!scroller) return;
    const root = document.documentElement;
    const mark = () => {
      const inRows = scroller.contains(document.activeElement);
      root.toggleAttribute('data-in-rows', inRows);
      if (!inRows && keyboardFocus()) setResting(null);
    };
    mark();
    document.addEventListener('focusin', mark);
    return () => {
      document.removeEventListener('focusin', mark);
      root.removeAttribute('data-in-rows');
    };
  }, [scroller]);
  const item = picked ?? items.find((i) => backdropSrc(client, i)) ?? items[0];
  useArtBackground(item);
  const trailer = useHeroTrailer(resting, true);

  return (
    <FollowContext.Provider value={follow}>
      <div
        // The hero's height is fixed, so the rows don't move as details
        // change. A top bar mostly covers artwork, so it takes only part of its
        // height from the rows.
        className={cn(
          'relative z-[1] -mt-[var(--top-bar,0px)] flex h-dvh flex-col',
          corner
            ? '[--hero-h:calc(45dvh+var(--top-bar,0px)*0.3)]'
            : '[--hero-h:calc(55dvh+var(--top-bar,0px)*0.3)]'
        )}
      >
        <FollowBackdrop item={item} corner={corner} trailer={trailer} />
        <section
          data-ui="hero"
          data-follow
          className="flex h-[var(--hero-h)] flex-none flex-col justify-end"
        >
          <div
            data-ui="hero-content"
            className={cn(
              'max-w-3xl space-y-4 pb-4 pe-10',
              corner && 'lg:max-w-[40vw]'
            )}
          >
            {item ? (
              <FollowDetails item={item} />
            ) : loading ? (
              // On a TV it has no buttons, as FollowDetails shows none there.
              <HeroTextSkeleton actions={!currentHost().tv} />
            ) : null}
          </div>
        </section>
        <div
          ref={setScroller}
          data-ui="hero-rows"
          data-nav-snap
          data-scroll-restoration-id="home-rows"
          // What a card may take of the rows' height, past the room above a
          // revealed row and its header. It clips sideways too, so it pads
          // room for a card's focus ring.
          className="-ms-1.5 min-h-0 flex-1 overflow-y-auto ps-1.5 [--row-card-h:calc(100dvh-var(--hero-h)-4.25rem)] [mask-image:linear-gradient(to_bottom,transparent,black_2rem)]"
        >
          <ScrollRoot.Provider value={scroller}>
            <GlideLayers>{children}</GlideLayers>
          </ScrollRoot.Provider>
        </div>
      </div>
    </FollowContext.Provider>
  );
}
