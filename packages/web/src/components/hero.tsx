import React from 'react';
import { BiInfoCircle, BiPlay, BiSolidStar } from 'react-icons/bi';
import { Button } from '@aiostreams/ui/button';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '../lib/session';
import { currentHost } from '../lib/hosts';
import { usePageShown } from '../lib/page-shown';
import { useItem } from '../lib/queries';
import { ScrollRoot, watch } from '../lib/use-in-view';
import { backdropUrl, landscapeUrl, logoUrl } from '../lib/images';
import { itemSubtitle, itemTitle, ticksToMs } from '../lib/format';
import { itemPath, navigate } from '../lib/paths';
import { useVersionPicker } from './version-picker';
import type { JellyfinClient } from '../lib/client';
import type { BaseItemDto } from '../lib/types';
import { useHold } from '../lib/use-hold';
import { CachedImage } from './cached-image';
import { GlideLayers } from './glide-layers';

const ROTATE_MS = 9000;
/** How long the pointer or focus rests on a card before the hero follows it. */
const FOLLOW_DELAY_MS = 300;

function Shade() {
  return (
    <>
      <div
        data-ui="hero-shade"
        data-name="side"
        className="absolute inset-0 bg-gradient-to-r from-[--background] via-[--background]/70 via-35% to-transparent"
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
        'absolute inset-y-0 right-0 isolate w-full landscape:[mask-image:linear-gradient(to_right,transparent,black_12rem)] lg:[mask-image:linear-gradient(to_right,transparent,black_12rem)]',
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
      className="relative -mt-[var(--top-bar,0px)] h-[26rem] w-full overflow-hidden sm:h-[30rem] lg:-ml-[var(--side-bar,0px)] lg:h-[calc(max(36rem,53vh)+var(--top-bar,0px))] lg:w-[calc(100%+var(--side-bar,0px))]"
    >
      <div className="absolute inset-0 animate-pulse bg-[--subtle]" />
      <Shade />
      <div className="absolute inset-x-0 bottom-0 space-y-4 px-4 pb-8 lg:left-[var(--side-bar,0px)] lg:max-w-3xl lg:pl-0 lg:pr-10 lg:pb-14">
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
function Backdrops({ current }: { current: string | undefined }) {
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
      return [
        ...all.slice(1 - MAX_LAYERS),
        { src: current, id: nextLayer++, quick: all.every((l) => l.gone) },
      ];
    });
  }, [current, loaded]);

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
              : cn(
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
      {logo ? (
        <CachedImage
          data-ui="hero-logo"
          src={logo}
          alt={item.Name ?? ''}
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
              Play
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
            {playable ? 'More info' : 'Open'}
          </Button>
        </div>
      )}
    </>
  );
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
  const shown = usePageShown();
  const section = React.useRef<HTMLElement>(null);
  const [inSight, setInSight] = React.useState(true);
  React.useEffect(() => {
    const el = section.current;
    if (!el) return;
    return watch(el, null, '0px', (entry) => setInSight(entry.isIntersecting));
  }, [loading, featured.length]);

  React.useEffect(() => setIndex(0), [featured.length]);
  React.useEffect(() => {
    if (paused || !shown || !inSight || featured.length < 2) return;
    const timer = setTimeout(
      () => setIndex((i) => (i + 1) % featured.length),
      ROTATE_MS
    );
    return () => clearTimeout(timer);
  }, [index, paused, shown, inSight, featured.length]);

  if (loading) return <HeroSkeleton />;
  const item = featured[index];
  if (!item) return null;

  return (
    <section
      ref={section}
      data-ui="hero"
      data-nav-top
      className="relative -mt-[var(--top-bar,0px)] h-[26rem] w-full overflow-hidden sm:h-[30rem] lg:-ml-[var(--side-bar,0px)] lg:h-[calc(max(36rem,53vh)+var(--top-bar,0px))] lg:w-[calc(100%+var(--side-bar,0px))]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <BackdropFrame className="max-w-[calc(26rem*2.6)] sm:max-w-[calc(30rem*2.6)] lg:max-w-[calc(max(36rem,53vh)*2.6)]">
        <Backdrops current={backdropSrc(client, item)} />
      </BackdropFrame>
      <Shade />

      <div
        data-ui="hero-content"
        className="absolute inset-x-0 bottom-0 space-y-4 px-4 pb-8 lg:left-[var(--side-bar,0px)] lg:max-w-3xl lg:pl-0 lg:pr-10 lg:pb-14"
      >
        <HeroDetails
          item={item}
          overviewClass="line-clamp-2 sm:line-clamp-3 sm:text-base"
        />
      </div>

      {featured.length > 1 && (
        <div
          data-ui="hero-dots"
          className="absolute bottom-6 right-4 flex gap-1.5 lg:bottom-14"
        >
          {featured.map((f, i) => (
            <button
              key={f.Id}
              type="button"
              data-ui="hero-dot"
              data-current={i === index || undefined}
              data-nav-tv="skip"
              aria-label={`Show ${f.Name}`}
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
  /** The pointer or focus came to rest on a card. */
  rest(item: BaseItemDto): void;
  leave(): void;
}

const FollowContext = React.createContext<Follow | null>(null);

/** A card's handlers under a hero that follows the selected card, where there is one. */
export function useHeroTarget(item: BaseItemDto) {
  const follow = React.useContext(FollowContext);
  if (!follow) return undefined;
  return {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') follow.rest(item);
    },
    onPointerLeave: follow.leave,
    onFocus: () => follow.rest(item),
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
        className="pointer-events-none fixed right-0 top-0 -z-10 aspect-video max-h-[calc(var(--hero-h)*1.4)] w-[70vw] overflow-hidden [mask-image:linear-gradient(to_right,transparent,rgb(0_0_0/0.4)_20%,black_45%)]"
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
  const follow = React.useMemo<Follow>(
    () => ({
      rest: (item) => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setPicked(item), FOLLOW_DELAY_MS);
      },
      leave: () => clearTimeout(timer.current),
    }),
    []
  );
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
              'max-w-3xl space-y-4 pb-4 pr-10',
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
          // revealed row and its header.
          className="min-h-0 flex-1 overflow-y-auto [--row-card-h:calc(100dvh-var(--hero-h)-4.25rem)] [mask-image:linear-gradient(to_bottom,transparent,black_2rem)]"
        >
          <ScrollRoot.Provider value={scroller}>
            <GlideLayers>{children}</GlideLayers>
          </ScrollRoot.Provider>
        </div>
      </div>
    </FollowContext.Provider>
  );
}
