import React from 'react';
import { BiCalendar, BiChevronRight, BiHistory } from 'react-icons/bi';
import { Button } from '@aiostreams/ui/button';
import { Badge } from '@aiostreams/ui/badge';
import { useMediaQuery } from '@aiostreams/ui/hooks/media-query';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '../lib/session';
import {
  useItemPages,
  libraryTypes,
  needsGenre,
  useLibraryHeads,
  useNextUp,
  useResume,
  useUpcoming,
  useViews,
} from '../lib/queries';
import { cardShape, landscapeUrls, posterUrl } from '../lib/images';
import {
  clock,
  dayLabel,
  libraryLabel,
  duration,
  itemSubtitle,
  itemTitle,
  progressOf,
  remainingMs,
  ticksToMs,
  untilLabel,
} from '../lib/format';
import { href, itemPath, navigate, to, versionsPath } from '../lib/paths';
import { settings, useSetting, type FeaturedSource } from '../lib/settings';
import { useFeature } from '../lib/server-info';
import { useNear } from '../lib/use-in-view';
import { FollowHero, Hero } from '../components/hero';
import { MediaRow } from '../components/media-row';
import { PosterCard, WideCard } from '../components/cards';
import { ItemMenu } from '../components/item-menu';
import {
  useStraightPlay,
  useVersionPicker,
} from '../components/version-picker';
import { NoCatalogs } from '../components/no-catalogs';
import { FILL_WINDOW } from '../components/layout';
import type { BaseItemDto } from '../lib/types';
import { currentHost } from '../lib/hosts';
import { Anchor } from '../components/anchor';

const HERO_ITEMS = 8;
const HERO_MAX = 10;

/** The first movie and series catalogs, or the first library without them. */
function autoSources(views: BaseItemDto[]): FeaturedSource[] {
  const ids = ['movies', 'tvshows']
    .map((kind) => views.find((v) => v.CollectionType === kind)?.Id)
    .filter((id): id is string => !!id);
  const fallback = views[0]?.Id;
  return (ids.length ? ids : fallback ? [fallback] : []).map(
    (id) => `view:${id}`
  );
}

function interleave(lists: BaseItemDto[][], max: number): BaseItemDto[] {
  const seen = new Set<string>();
  const out: BaseItemDto[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest && out.length < max; i++) {
    for (const list of lists) {
      const item = list[i];
      if (!item?.Id || seen.has(item.Id) || out.length >= max) continue;
      seen.add(item.Id);
      out.push(item);
    }
  }
  return out;
}

function mergeRows(
  resume: BaseItemDto[] | null | undefined,
  nextUp: BaseItemDto[] | null | undefined
): BaseItemDto[] {
  const seen = new Set<string>();
  return [...(resume ?? []), ...(nextUp ?? [])].filter((item) => {
    const keys = [item.Id, item.SeriesId].filter((k): k is string => !!k);
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  });
}

export function HomePage() {
  const resume = useResume();
  const nextUp = useNextUp();
  const views = useViews();
  const [featured] = useSetting(settings.featured);
  const [mergeNextUp] = useSetting(settings.mergeNextUp);
  const continueItems = React.useMemo(
    () =>
      mergeRows(resume.data?.Items, mergeNextUp ? nextUp.data?.Items : null),
    [resume.data, nextUp.data, mergeNextUp]
  );
  const continueLoading = resume.isLoading || (mergeNextUp && nextUp.isLoading);

  const all = views.data?.Items ?? [];
  const noCatalogs = views.isSuccess && !all.length;
  const genreRequired = useFeature('genreRequired');
  const onHome = genreRequired ? all.filter((v) => !needsGenre(v)) : all;
  // A removed catalog is skipped, and a list left without any is automatic.
  const live =
    featured === 'auto' || !views.data
      ? featured
      : featured.filter(
          (s) => !s.startsWith('view:') || all.some((v) => `view:${v.Id}` === s)
        );
  const sources =
    live === 'auto' || (!live.length && featured.length)
      ? autoSources(onHome)
      : live;
  const viewIds = sources
    .filter((s) => s.startsWith('view:'))
    .map((s) => s.slice(5));
  const heroViews = viewIds.flatMap((id) => all.find((v) => v.Id === id) ?? []);
  const heads = useLibraryHeads(heroViews, HERO_ITEMS);
  const headOf = new Map(heroViews.map((view, i) => [view.Id, heads[i]]));
  const heroItems = interleave(
    sources.map((s) =>
      s === 'resume'
        ? continueItems.slice(0, HERO_ITEMS)
        : s === 'next-up'
          ? (nextUp.data?.Items ?? []).slice(0, HERO_ITEMS)
          : (headOf.get(s.slice(5))?.data?.Items ?? [])
    ),
    HERO_MAX
  );
  const heroLoading =
    views.isLoading ||
    (sources.includes('resume') && continueLoading) ||
    (sources.includes('next-up') && nextUp.isLoading) ||
    heads.some((h) => h.isLoading);
  // Following needs a pointer or remote to rest on cards and room for rows under the hero.
  const [heroMode] = useSetting(settings.heroMode);
  const pointer = useMediaQuery(
    '(min-width: 1024px) and (hover: hover) and (pointer: fine)'
  );
  const canFollow = pointer || !!currentHost().tv;
  const follow = heroMode !== 'rotate' && canFollow;

  const rows = (
    <>
      <EpisodeRow
        id="resume"
        title="Continue watching"
        items={continueItems}
        loading={continueLoading}
        action={
          <Button
            size="sm"
            intent="gray-subtle"
            className="rounded-full"
            leftIcon={<BiHistory />}
            onClick={() => navigate(to.history)}
          >
            Activity
          </Button>
        }
      />
      {!mergeNextUp && (
        <EpisodeRow
          id="next-up"
          title="Next up"
          items={nextUp.data?.Items}
          loading={nextUp.isLoading}
        />
      )}
      <UpcomingRow />
      {noCatalogs ? (
        <div className="flex flex-1 flex-col justify-center">
          <NoCatalogs />
        </div>
      ) : (
        onHome.map((view, i) => (
          <LibraryRow key={view.Id} view={view} first={i === 0} />
        ))
      )}
    </>
  );

  // Without catalogs the pinned hero would stand empty over the message.
  if (follow && !noCatalogs)
    return (
      <FollowHero
        items={heroItems.length ? heroItems : continueItems}
        loading={heroLoading}
        corner={heroMode === 'corner'}
      >
        <div
          data-ui="home-rows"
          className="space-y-10 px-4 pb-16 pt-8 lg:pl-0 lg:pr-10"
        >
          {rows}
        </div>
      </FollowHero>
    );
  return (
    <div className={cn('pb-16', noCatalogs && ['flex flex-col', FILL_WINDOW])}>
      <Hero items={heroItems} loading={heroLoading} />
      <div
        data-ui="home-rows"
        className={cn(
          heroItems.length || heroLoading
            ? 'relative z-[1] space-y-10 px-4 pt-2 lg:pl-0 lg:pr-10'
            : 'relative z-[1] space-y-10 px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] lg:pl-0 lg:pr-10 lg:pt-[calc(2.5rem+env(safe-area-inset-top))]',
          noCatalogs && 'flex flex-1 flex-col'
        )}
      >
        {rows}
      </div>
    </div>
  );
}

/**
 * Resume points and next episodes play from the row, or list their versions
 * on their own page, which stays behind.
 */
function EpisodeRow({
  id,
  title,
  items,
  loading,
  action,
}: {
  id: string;
  action?: React.ReactNode;
  title: string;
  items: BaseItemDto[] | null | undefined;
  loading: boolean;
}) {
  const { client } = useSession();
  const picker = useVersionPicker();
  const straight = useStraightPlay();
  return (
    <MediaRow
      id={id}
      title={title}
      shape="wide"
      loading={loading}
      action={action}
    >
      {items?.map((item) => {
        const left = remainingMs(item);
        return (
          <ItemMenu key={item.Id} item={item}>
            <WideCard
              onClick={() => {
                const startMs = ticksToMs(item.UserData?.PlaybackPositionTicks);
                if (straight(item, startMs)) picker.play(item, { startMs });
                else navigate(versionsPath(item));
              }}
              image={(width) =>
                landscapeUrls(client, item, { maxWidth: width })
              }
              title={itemTitle(item)}
              subtitle={itemSubtitle(item)}
              meta={
                left && progressOf(item) ? `${duration(left)} left` : undefined
              }
              progress={progressOf(item)}
            />
          </ItemMenu>
        );
      })}
    </MediaRow>
  );
}

/**
 * Episodes of shows in progress airing soon, grouped by day. They open their
 * show, having nothing to play yet.
 */
function UpcomingRow() {
  const { client } = useSession();
  const upcoming = useUpcoming();
  return (
    <MediaRow
      id="upcoming"
      title="Upcoming"
      shape="wide"
      loading={upcoming.isLoading}
      action={
        <Button
          size="sm"
          intent="gray-subtle"
          className="rounded-full"
          leftIcon={<BiCalendar />}
          onClick={() => navigate(to.calendar())}
        >
          Calendar
        </Button>
      }
    >
      {upcoming.data?.Items?.map((item) => (
        <ItemMenu key={item.Id} item={item}>
          <WideCard
            href={href(itemPath(item))}
            unavailable
            image={(width) => landscapeUrls(client, item, { maxWidth: width })}
            title={itemTitle(item)}
            subtitle={itemSubtitle(item)}
            badge={
              item.PremiereDate ? (
                <Badge size="sm" intent="gray-solid">
                  {dayLabel(item.PremiereDate)}
                </Badge>
              ) : undefined
            }
            meta={item.PremiereDate ? untilLabel(item.PremiereDate) : undefined}
          />
        </ItemMenu>
      ))}
    </MediaRow>
  );
}

const ROW_PAGE = 20;

/**
 * A library's row, fetched and drawn once near the screen and paged as it
 * scrolls. Its cards wait too when already fetched, as most rows are out of
 * sight: only the first starts drawn, as a page opens at its top.
 */
function LibraryRow({ view, first }: { view: BaseItemDto; first: boolean }) {
  const { client } = useSession();
  const [ref, near] = useNear<HTMLElement>('400px', first);
  const pages = useItemPages(view.Id!, {
    types: libraryTypes(view),
    recursive: true,
    pageSize: ROW_PAGE,
    enabled: near,
  });
  const items = pages.data?.pages.flatMap((p) => p.Items ?? []) ?? [];
  const landscape =
    items.length > 0 &&
    items.filter((i) => cardShape(i) === 'landscape').length > items.length / 2;
  const label = libraryLabel(view);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages;
  const more = React.useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Shown loading until fetched: the row itself must mount to come into view.
  return (
    <MediaRow
      rowRef={ref}
      id={`view:${view.Id}`}
      title={
        <Anchor
          href={href(to.discover(view.Id!))}
          className="group/title inline-flex items-baseline gap-2"
        >
          {view.Name}
          {label && (
            <span className="text-sm font-normal text-[--muted]">{label}</span>
          )}
          <BiChevronRight className="self-center text-xl text-[--muted] transition-transform group-hover/title:translate-x-0.5" />
        </Anchor>
      }
      shape={landscape ? 'wide' : 'poster'}
      loading={!near || (!pages.data && !pages.isError)}
      waiting={!near}
      loadingMore={isFetchingNextPage}
      onEndReached={more}
    >
      {near &&
        items.map((item) => (
          <ItemMenu key={item.Id} item={item}>
            <PosterCard
              href={href(itemPath(item))}
              shape={landscape ? 'landscape' : cardShape(item)}
              image={(width) => posterUrl(client, item, { maxWidth: width })}
              title={item.Name ?? ''}
              subtitle={itemSubtitle(item)}
              watched={item.UserData?.Played}
              unwatched={item.UserData?.UnplayedItemCount ?? undefined}
              progress={progressOf(item)}
            />
          </ItemMenu>
        ))}
    </MediaRow>
  );
}
