import React from 'react';
import { BiInfoCircle, BiPlay, BiSolidStar } from 'react-icons/bi';
import { Button } from '@aiostreams/ui/button';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '../lib/session';
import { backdropUrl, landscapeUrl, logoUrl } from '../lib/images';
import { itemSubtitle, itemTitle, ticksToMs } from '../lib/format';
import { itemPath, navigate } from '../lib/paths';
import { useVersionPicker } from './version-picker';
import type { BaseItemDto } from '../lib/types';

const ROTATE_MS = 9000;

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
      </div>
    </section>
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
  const picker = useVersionPicker();
  const featured = items.filter(
    (i) => backdropUrl(client, i) || landscapeUrl(client, i)
  );
  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const [loaded, setLoaded] = React.useState<ReadonlySet<string>>(new Set());

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

  const logo = item.Type !== 'Episode' ? logoUrl(client, item) : null;
  const playable = item.Type === 'Movie' || item.Type === 'Episode';
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
    <section
      data-ui="hero"
      className="relative h-[26rem] w-full overflow-hidden sm:h-[30rem] lg:h-[36rem]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {featured.map((f, i) => (
        <img
          key={f.Id}
          data-ui="hero-backdrop"
          src={
            backdropUrl(client, f, { maxWidth: 1920 }) ??
            landscapeUrl(client, f, { maxWidth: 1920 }) ??
            undefined
          }
          alt=""
          onLoad={() => setLoaded((set) => new Set(set).add(f.Id!))}
          className={cn(
            'absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-1000',
            i === index && loaded.has(f.Id!) ? 'opacity-100' : 'opacity-0'
          )}
          loading={i === index ? 'eager' : 'lazy'}
        />
      ))}
      <Shade />

      <div
        data-ui="hero-content"
        className="absolute inset-x-0 bottom-0 space-y-4 px-4 pb-8 lg:max-w-3xl lg:pl-0 lg:pr-10 lg:pb-14"
      >
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
            className="line-clamp-2 max-w-2xl text-sm text-gray-300 sm:line-clamp-3 sm:text-base"
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
