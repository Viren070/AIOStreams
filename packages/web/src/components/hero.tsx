import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { flushSync } from 'react-dom';
import { BiInfoCircle, BiPlay, BiSolidStar } from 'react-icons/bi';
import { Button } from '@aiostreams/ui/button';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { cn } from '@aiostreams/ui/core/styling';
import { useMediaQuery } from '@aiostreams/ui/hooks/media-query';
import { useSession } from '../lib/session';
import { currentHost } from '../lib/hosts';
import { usePageShown } from '../lib/page-shown';
import { useItem } from '../lib/queries';
import { focusOn, keyboardFocus, useAction } from '../lib/input';
import { ScrollRoot, watch } from '../lib/use-in-view';
import { backdropUrl, landscapeUrl, logoUrl } from '../lib/images';
import { itemSubtitle, itemTitle, ticksToMs } from '../lib/format';
import { itemPath, navigate } from '../lib/paths';
import { useVersionPicker } from './version-picker';
import type { JellyfinClient } from '../lib/client';
import type { BaseItemDto } from '../lib/types';
import { pageRtl } from '../lib/direction';
import { useHold } from '../lib/use-hold';
import { useLatest } from '../lib/use-latest';
import { CachedImage } from './cached-image';
import { GlideLayers } from './glide-layers';

const ROTATE_MS = 9000;
const DRAG_SLOP_PX = 8;
const LAND_SHARE = 0.35;
const FLICK_PX_MS = 0.4;
const SETTLE_MS = 300;
/** How long the pointer or focus rests on a card before the hero follows it. */
const FOLLOW_DELAY_MS = 300;

function Shade() {
  return (
    <>
      <div
        data-ui="hero-shade"
        data-name="side"
        className="absolute inset-0 bg-gradient-to-r from-[--background] via-[--background]/70 via-35% to-transparent rtl:bg-gradient-to-l"
      />
      <div
        data-ui="hero-shade"
        data-name="bottom"
        className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[--background] via-[--background]/60 to-transparent"
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

function HeroTextSkeleton() {
  return (
    <>
      <Skeleton className="h-12 w-64 lg:h-16 lg:w-96" />
      <Skeleton className="h-4 w-48" />
      <div className="space-y-2">
        <Skeleton className="h-4 max-w-xl" />
        <Skeleton className="h-4 w-4/5 max-w-lg" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-10 w-28 rounded-full" />
        <Skeleton className="h-10 w-32 rounded-full" />
      </div>
    </>
  );
}

/** The hero's own box and shading, with its text and buttons blocked out. */
function HeroSkeleton() {
  return (
    <section
      aria-hidden
      data-ui="hero"
      data-loading
      className="relative -mt-[var(--top-bar,0px)] h-[26rem] w-full overflow-hidden sm:h-[30rem] lg:-ms-[var(--side-bar,0px)] lg:h-[calc(max(36rem,53vh)+var(--top-bar,0px))] lg:w-[calc(100%+var(--side-bar,0px))]"
    >
      <div className="absolute inset-0 animate-pulse bg-[--subtle]" />
      <Shade />
      <div className="absolute inset-x-0 bottom-0 space-y-4 px-4 pb-8 lg:start-[var(--side-bar,0px)] lg:max-w-3xl lg:ps-0 lg:pe-10 lg:pb-14">
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
}

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
}: {
  current: string | undefined;
  fade?: boolean;
}) {
  const [loaded, setLoaded] = React.useState<ReadonlySet<string>>(new Set());
  const [layers, setLayers] = React.useState<Layer[]>([]);
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
        { src: current, id: nextLayer++, quick: all.every((l) => l.gone) },
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
            layer.gone
              ? 'opacity-0 transition-opacity duration-700'
              : !layer.still &&
                  cn(
                    'animate-in fade-in-0',
                    layer.quick ? '[animation-duration:400ms]' : 'duration-700'
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
}: {
  item: BaseItemDto;
  overviewClass: string;
  actions?: boolean;
}) {
  const { client } = useSession();
  const picker = useVersionPicker();
  const logo = logoUrl(client, item, { maxWidth: 384 });
  // By address, since the hero swaps items under the same details.
  const [failedLogo, setFailedLogo] = React.useState<string>();
  // Jellyfin cannot play a virtual item, such as an episode not yet aired.
  const playable =
    (item.Type === 'Movie' || item.Type === 'Episode') &&
    item.LocationType !== 'Virtual';
  const holdPlay = useHold(() =>
    picker.play(item, {
      startMs: ticksToMs(item.UserData?.PlaybackPositionTicks),
      held: true,
    })
  );
  const parts: [string, React.ReactNode][] = [
    item.Type === 'Episode'
      ? ['episode', itemSubtitle(item)]
      : ['year', item.ProductionYear],
    [
      'score',
      item.CommunityRating ? (
        <span className="inline-flex items-center gap-1">
          <BiSolidStar className="text-yellow-400" />
          {item.CommunityRating.toFixed(1)}
        </span>
      ) : null,
    ],
    ['genres', item.Genres?.slice(0, 3).join(', ')],
  ];
  const meta = parts.filter(([, part]) => part);

  return (
    <>
      {logo && failedLogo !== logo ? (
        <CachedImage
          data-ui="hero-logo"
          src={logo}
          alt={item.Name ?? ''}
          onError={() => setFailedLogo(logo)}
          className="max-h-20 max-w-[min(24rem,75%)] object-contain object-left lg:max-h-28"
        />
      ) : (
        <h1
          data-ui="hero-title"
          className="line-clamp-2 text-3xl font-bold leading-tight lg:text-5xl"
        >
          {itemTitle(item)}
        </h1>
      )}
      {meta.length > 0 && (
        <div
          data-ui="hero-meta"
          className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-gray-200"
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
      {item.Overview && (
        <p
          data-ui="hero-overview"
          className={cn('max-w-2xl text-sm text-gray-300', overviewClass)}
        >
          {item.Overview}
        </p>
      )}
      {actions && (
        <div data-ui="hero-actions" className="flex flex-wrap gap-2">
          {playable && (
            <Button
              data-ui="hero-action"
              data-name="play"
              intent="white"
              className="rounded-full"
              leftIcon={<BiPlay className="text-xl" />}
              onClick={() =>
                picker.play(item, {
                  startMs: ticksToMs(item.UserData?.PlaybackPositionTicks),
                })
              }
              {...holdPlay}
            >
              <Trans>Play</Trans>
            </Button>
          )}
          <Button
            data-ui="hero-action"
            data-name="info"
            intent={playable ? 'gray-outline' : 'white'}
            className="rounded-full"
            leftIcon={<BiInfoCircle className="text-xl" />}
            onClick={() => navigate(itemPath(item))}
          >
            {playable ? t`More info` : t`Open`}
          </Button>
        </div>
      )}
    </>
  );
}

/** Fades the next or previous title in as far as a finger drags sideways over the hero. */
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
      // Between a dot's w-1.5 bg-white/40 and the current one's w-6 bg-white.
      const lit = i === from ? 1 - shown : i === to ? shown : null;
      dot.style.transition = animate
        ? `width ${SETTLE_MS}ms ease-out, background-color ${SETTLE_MS}ms ease-out`
        : 'none';
      dot.style.width = lit === null ? '' : `${0.375 + 1.125 * lit}rem`;
      dot.style.backgroundColor =
        lit === null ? '' : `rgb(255 255 255 / ${0.4 + 0.6 * lit})`;
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
      if (e.pointerType !== 'touch' || !e.isPrimary) return;
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
  };
}

function dotLabel(item: BaseItemDto): string {
  const name = item.Name ?? '';
  return t({
    comment: 'A dot under the banner that brings this title up',
    message: `Show ${name}`,
  });
}

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
  const [paused, setPaused] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  // Keys of the previous, current and next slides, passed round as a swipe
  // lands so the slide faded in stays mounted.
  const [slots, setSlots] = React.useState<[number, number, number]>([0, 1, 2]);
  const swipe = useSwipeFade((step) => {
    setIndex((i) => (i + step + featured.length) % featured.length);
    setSlots(([prev, main, next]) =>
      step > 0 ? [main, next, prev] : [next, prev, main]
    );
  }, setDragging);
  const swipeable =
    useMediaQuery('(pointer: coarse)') &&
    !currentHost().tv &&
    featured.length > 1;
  const shown = usePageShown();
  const section = React.useRef<HTMLElement>(null);
  const [focused, setFocused] = React.useState(false);
  const [inSight, setInSight] = React.useState(true);
  React.useEffect(() => {
    const el = section.current;
    if (!el) return;
    return watch(el, null, '0px', (entry) => setInSight(entry.isIntersecting));
  }, [loading, featured.length]);

  React.useEffect(() => setIndex(0), [featured.length]);
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
    const timer = setTimeout(
      () => setIndex((i) => (i + 1) % featured.length),
      ROTATE_MS
    );
    return () => clearTimeout(timer);
  }, [index, paused, focused, dragging, shown, inSight, featured.length]);

  const landing = React.useRef<'first' | 'last' | null>(null);
  const turn = (step: 1 | -1) => {
    const actions = [
      ...(section.current?.querySelectorAll<HTMLElement>(
        '[data-ui=hero-action]'
      ) ?? []),
    ];
    const at = actions.indexOf(keyboardFocus()!);
    // From the first title, Left leaves for the navigation.
    if (at < 0 || actions[at + step] || (step < 0 && !index)) return false;
    landing.current = step > 0 ? 'first' : 'last';
    setIndex((i) => (i + step + featured.length) % featured.length);
  };
  const turning = !!currentHost().tv && focused && featured.length > 1;
  // Right to left, the next title lies to the left.
  const [right, left]: (1 | -1)[] = pageRtl() ? [-1, 1] : [1, -1];
  useAction('nav.right', () => turn(right), turning);
  useAction('nav.left', () => turn(left), turning);
  React.useLayoutEffect(() => {
    const to = landing.current;
    landing.current = null;
    const actions = section.current?.querySelectorAll<HTMLElement>(
      '[data-ui=hero-action]'
    );
    const el = to === 'first' ? actions?.[0] : actions?.[actions.length - 1];
    if (to && el) focusOn(el);
  }, [index]);

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
      className="relative -mt-[var(--top-bar,0px)] h-[26rem] w-full touch-pan-y touch-pinch-zoom overflow-hidden sm:h-[30rem] lg:-ms-[var(--side-bar,0px)] lg:h-[calc(max(36rem,53vh)+var(--top-bar,0px))] lg:w-[calc(100%+var(--side-bar,0px))]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) =>
        !e.currentTarget.contains(e.relatedTarget) && setFocused(false)
      }
      {...(swipeable ? swipe : {})}
    >
      <div className="absolute inset-0 isolate">
        {slides.map(({ key, role, item }) => (
          <div
            key={key}
            data-slide={role}
            className={cn(slideClass(role), role && 'z-[1]')}
          >
            <BackdropFrame className="max-w-[calc(26rem*2.6)] sm:max-w-[calc(30rem*2.6)] lg:max-w-[calc(max(36rem,53vh)*2.6)]">
              <Backdrops current={backdropSrc(client, item)} fade={!role} />
            </BackdropFrame>
          </div>
        ))}
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
          <div
            data-ui="hero-content"
            className="absolute inset-x-0 bottom-0 space-y-4 px-4 pb-8 lg:start-[var(--side-bar,0px)] lg:max-w-3xl lg:ps-0 lg:pe-10 lg:pb-14"
          >
            <HeroDetails
              item={item}
              overviewClass="line-clamp-2 sm:line-clamp-3 sm:text-base"
            />
          </div>
        </div>
      ))}

      {featured.length > 1 && (
        <div
          data-ui="hero-dots"
          className="absolute bottom-6 end-4 flex gap-1.5 lg:bottom-14"
        >
          {featured.map((f, i) => (
            <button
              key={f.Id}
              type="button"
              data-ui="hero-dot"
              data-current={i === index || undefined}
              data-nav-tv="skip"
              aria-label={dotLabel(f)}
              onClick={() => setIndex(i)}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/40'
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
}: {
  item: BaseItemDto | undefined;
  corner: boolean;
}) {
  const { client } = useSession();
  const src = item && backdropSrc(client, item);

  if (corner)
    return (
      <div
        aria-hidden
        data-ui="hero-corner"
        // Masks rather than shades, which leave a seam beside the fading layers.
        className="pointer-events-none fixed end-0 top-0 -z-10 aspect-video max-h-[calc(var(--hero-h)*1.4)] w-[70vw] overflow-hidden [mask-image:linear-gradient(to_right,transparent,rgb(0_0_0/0.4)_20%,black_45%)] rtl:[mask-image:linear-gradient(to_left,transparent,rgb(0_0_0/0.4)_20%,black_45%)]"
      >
        <div className="absolute inset-0 [mask-image:linear-gradient(to_bottom,black_45%,rgb(0_0_0/0.4)_75%,transparent)]">
          <Backdrops current={src} />
        </div>
      </div>
    );
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <BackdropFrame className="max-w-[calc(100vh*2.6)]">
        <Backdrops current={src} />
      </BackdropFrame>
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
      timer.current = setTimeout(() => setPicked(item), FOLLOW_DELAY_MS);
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
        if (pointerPick) clearTimeout(timer.current);
      },
    };
  }, []);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  // A TV's top bar steps aside while focus is in the rows, showing more of the
  // hero; Back still reaches it.
  React.useEffect(() => {
    if (!scroller) return;
    const root = document.documentElement;
    const mark = () =>
      root.toggleAttribute(
        'data-in-rows',
        scroller.contains(document.activeElement)
      );
    mark();
    document.addEventListener('focusin', mark);
    return () => {
      document.removeEventListener('focusin', mark);
      root.removeAttribute('data-in-rows');
    };
  }, [scroller]);
  const item = picked ?? items.find((i) => backdropSrc(client, i)) ?? items[0];

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
        <FollowBackdrop item={item} corner={corner} />
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
              <HeroTextSkeleton />
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
