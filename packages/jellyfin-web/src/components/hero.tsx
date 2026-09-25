import React from 'react';
import { BiInfoCircle, BiPlay, BiSolidStar } from 'react-icons/bi';
import { Button } from '@aiostreams/ui/button';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '../lib/session';
import { useItem } from '../lib/queries';
import { ScrollRoot } from '../lib/use-in-view';
import { backdropUrl, landscapeUrl, logoUrl } from '../lib/images';
import { itemSubtitle, itemTitle, ticksToMs } from '../lib/format';
import { itemPath, navigate } from '../lib/paths';
import { useVersionPicker } from './version-picker';
import type { JellyfinClient } from '../lib/client';
import type { BaseItemDto } from '../lib/types';

const ROTATE_MS = 9000;
/** How long the pointer rests on a card before the hero follows it. */
const FOLLOW_DELAY_MS = 300;

function Shade() {
  return (
    <>
      <div
        data-ui="hero-shade"
        className="absolute inset-0 bg-gradient-to-r from-[--background] via-[--background]/70 via-35% to-transparent"
      />
      <div
        data-ui="hero-shade"
        className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[--background] via-[--background]/60 to-transparent"
      />
    </>
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
      className="relative h-[26rem] w-full overflow-hidden sm:h-[30rem] lg:h-[36rem]"
    >
      <div className="absolute inset-0 animate-pulse bg-[--subtle]" />
      <Shade />
      <div className="absolute inset-x-0 bottom-0 space-y-4 px-4 pb-8 lg:max-w-3xl lg:pl-0 lg:pr-10 lg:pb-14">
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

/** Cross-fading backdrops that keep the last one shown until the next has loaded. */
function Backdrops({
  sources,
  current,
}: {
  sources: string[];
  current: string | undefined;
}) {
  const [loaded, setLoaded] = React.useState<ReadonlySet<string>>(new Set());
  const [shown, setShown] = React.useState<string>();
  React.useEffect(() => {
    if (!current) setShown(undefined);
    else if (loaded.has(current)) setShown(current);
  }, [current, loaded]);

  return sources.map((src) => (
    <img
      key={src}
      data-ui="hero-backdrop"
      src={src}
      alt=""
      loading={src === current ? 'eager' : 'lazy'}
      onLoad={() => setLoaded((set) => new Set(set).add(src))}
      className={cn(
        'absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-700',
        src === shown ? 'opacity-100' : 'opacity-0'
      )}
    />
  ));
}

/** An item's logo or title, facts, overview and buttons. */
function HeroDetails({
  item,
  overviewClass,
}: {
  item: BaseItemDto;
  overviewClass: string;
}) {
  const { client } = useSession();
  const picker = useVersionPicker();
  const logo = item.Type !== 'Episode' ? logoUrl(client, item) : null;
  // Jellyfin cannot play a virtual item, such as an episode not yet aired.
  const playable =
    (item.Type === 'Movie' || item.Type === 'Episode') &&
    item.LocationType !== 'Virtual';
  const meta = [
    item.Type === 'Episode' ? itemSubtitle(item) : item.ProductionYear,
    item.CommunityRating ? (
      <span className="inline-flex items-center gap-1">
        <BiSolidStar className="text-yellow-400" />
        {item.CommunityRating.toFixed(1)}
      </span>
    ) : null,
    item.Genres?.slice(0, 3).join(', '),
  ].filter(Boolean);

  return (
    <>
      {logo ? (
        <img
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
          {meta.map((m, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-gray-500">•</span>}
              <span>{m}</span>
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
      <div data-ui="hero-actions" className="flex flex-wrap gap-2">
        {playable && (
          <Button
            intent="white"
            className="rounded-full"
            leftIcon={<BiPlay className="text-xl" />}
            onClick={() =>
              picker.open(item, {
                startMs: ticksToMs(item.UserData?.PlaybackPositionTicks),
              })
            }
          >
            Play
          </Button>
        )}
        <Button
          intent={playable ? 'gray-outline' : 'white'}
          className="rounded-full"
          leftIcon={<BiInfoCircle className="text-xl" />}
          onClick={() => navigate(itemPath(item))}
        >
          {playable ? 'More info' : 'Open'}
        </Button>
      </div>
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

  React.useEffect(() => setIndex(0), [featured.length]);
  React.useEffect(() => {
    if (paused || featured.length < 2) return;
    const timer = setTimeout(
      () => setIndex((i) => (i + 1) % featured.length),
      ROTATE_MS
    );
    return () => clearTimeout(timer);
  }, [index, paused, featured.length]);

  if (loading) return <HeroSkeleton />;
  const item = featured[index];
  if (!item) return null;

  return (
    <section
      data-ui="hero"
      className="relative h-[26rem] w-full overflow-hidden sm:h-[30rem] lg:h-[36rem]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <Backdrops
        sources={[
          ...new Set(featured.flatMap((f) => backdropSrc(client, f) ?? [])),
        ]}
        current={backdropSrc(client, item)}
      />
      <Shade />

      <div
        data-ui="hero-content"
        className="absolute inset-x-0 bottom-0 space-y-4 px-4 pb-8 lg:max-w-3xl lg:pl-0 lg:pr-10 lg:pb-14"
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
  /** The pointer came to rest on a card. */
  rest(item: BaseItemDto): void;
  leave(): void;
  /** Keyboard focus, which the hero follows at once. */
  pick(item: BaseItemDto): void;
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
    onFocus: () => follow.pick(item),
  };
}

/** The whole window's backdrop, over the last few selected so going back is instant. */
function FollowBackdrop({ item }: { item: BaseItemDto | undefined }) {
  const { client } = useSession();
  const src = item && backdropSrc(client, item);
  const [recent, setRecent] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (src) setRecent((r) => [src, ...r.filter((s) => s !== src)].slice(0, 6));
  }, [src]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      <Backdrops sources={recent} current={src} />
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
    />
  );
}

/** Each user's last pick, so coming back to home keeps it until the app closes. */
const lastPicks = new Map<string, BaseItemDto>();

/**
 * The hero pinned above the rows, showing the card the pointer rests on or the
 * keyboard is on. The rows scroll beneath it, over the whole window's backdrop.
 */
export function FollowHero({
  items,
  loading,
  children,
}: {
  /** Candidates until a card is picked; the first with a backdrop is shown. */
  items: BaseItemDto[];
  loading: boolean;
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
      pick: (item) => {
        clearTimeout(timer.current);
        setPicked(item);
      },
    }),
    []
  );
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const item = picked ?? items.find((i) => backdropSrc(client, i)) ?? items[0];

  return (
    <FollowContext.Provider value={follow}>
      <FollowBackdrop item={item} />
      <div className="relative z-[1] flex h-dvh flex-col">
        <section
          data-ui="hero"
          className="flex h-[55%] flex-none flex-col justify-end"
        >
          <div
            data-ui="hero-content"
            className="max-w-3xl space-y-4 pb-4 pr-10"
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
          data-scroll-restoration-id="home-rows"
          className="min-h-0 flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_2rem)]"
        >
          <ScrollRoot.Provider value={scroller}>{children}</ScrollRoot.Provider>
        </div>
      </div>
    </FollowContext.Provider>
  );
}
