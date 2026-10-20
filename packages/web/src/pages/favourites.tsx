import { useEffect, useMemo, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { LuffyError } from '@aiostreams/ui/shared/luffy-error';
import { useSession } from '../lib/session';
import { useItemPages } from '../lib/queries';
import { navigate, to } from '../lib/paths';
import { PageBody } from '../components/layout';
import { PillTabs} from '../components/pill-tabs';
import { MixedGrid } from '../components/mixed-grid';
import { ScrollablePillTabs } from '../components/scrollable-pill-tabs';

const KINDS = [
  {
    value: 'Movie,Series',
    get label() {
      return t`All`;
    },
  },
  {
    value: 'Movie',
    get label() {
      return t`Movies`;
    },
  },
  {
    value: 'Series',
    get label() {
      return t`Shows`;
    },
  },
];

type View =
  | 'last-watched'
  | 'az'
  | 'za'
  | 'most-watched'
  | 'watched'
  | 'not-watched';

// Same set (and order) as the Stremio library: one pill active at a time.
const VIEWS: { value: View; label: string }[] = [
  { value: 'last-watched', label: 'Last Watched' },
  { value: 'watched', label: 'Watched' },
  { value: 'not-watched', label: 'Not Watched' },
  { value: 'az', label: 'A-Z' },
  { value: 'za', label: 'Z-A' },
  { value: 'most-watched', label: 'Most Watched' },
  
];

type Viewable = {
  Name?: string | null;
  SortName?: string | null;
  UserData?: {
    PlayCount?: number | null;
    Played?: boolean | null;
    LastPlayedDate?: string | null;
  } | null;
};

const lastPlayed = (item: Viewable) => {
  const time = Date.parse(item.UserData?.LastPlayedDate ?? '');
  return Number.isNaN(time) ? 0 : time;
};
const playCount = (item: Viewable) => item.UserData?.PlayCount ?? 0;
const isWatched = (item: Viewable) =>
  !!item.UserData?.Played || playCount(item) > 0;
const nameOf = (item: Viewable) => item.SortName || item.Name || '';
const byName = (a: Viewable, b: Viewable) =>
  nameOf(a).localeCompare(nameOf(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });

/** Sorts/filters entirely in the browser; never mutates the input array. */
function applyView<T extends Viewable>(items: T[], view: View): T[] {
  const byLastWatched = (a: T, b: T) => lastPlayed(b) - lastPlayed(a);
  switch (view) {
    case 'az':
      return [...items].sort(byName);
    case 'za':
      return [...items].sort((a, b) => byName(b, a));
    case 'most-watched':
      return [...items].sort(
        (a, b) => playCount(b) - playCount(a) || byLastWatched(a, b)
      );
    case 'watched':
      return items.filter(isWatched).sort(byLastWatched);
    case 'not-watched':
      return items.filter((item) => !isWatched(item));
    default:
      return [...items].sort(byLastWatched);
  }
}

export function FavouritesPage({ kind }: { kind?: string }) {
  const { client } = useSession();
  const types = KINDS.find((k) => k.value === kind)?.value ?? KINDS[0].value;
  const [view, setView] = useState<View>('last-watched');
  const pages = useItemPages('', {
    filter: 'favorite',
    types,
    recursive: true,
  });
  const items = pages.data?.pages.flatMap((p) => p.Items ?? []) ?? [];

  // Sorting/filtering happens here, so every page has to be loaded or the
  // order would shift as more pages arrive. Replaces the scroll sentinel.
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = pages;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage]);

  const visibleItems = useMemo(
    () => applyView(items, view),
    // `items` is rebuilt every render; its source data is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pages.data, view]
  );

  return (
    <PageBody>
      <div className="space-y-6">
        <h1 data-ui="page-title" className="text-3xl font-bold">
          <Trans>Favourites</Trans>
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <PillTabs
            name="kind"
            options={KINDS}
            value={types}
            onChange={(next) =>
              navigate(
                to.favourites(next === KINDS[0].value ? undefined : next),
                {
                  replace: true,
                }
              )
            }
          />
          <ScrollablePillTabs
            name="view"
            options={VIEWS}
            value={view}
            onChange={setView}
          />
        </div>
        {pages.isError ? (
          <LuffyError title={t`Could not load your favourites`} />
        ) : (
          <>
            <div data-nav-start>
              <MixedGrid
                items={visibleItems}
                client={client}
                loading={pages.isLoading}
              />
            </div>
            {!pages.isLoading && !items.length && (
              <p className="text-[--muted]">
                <Trans>Nothing marked as a favourite yet.</Trans>
              </p>
            )}
            {!pages.isLoading && !!items.length && !visibleItems.length && (
              <p className="text-[--muted]">
                No favourites match this filter.
              </p>
            )}
          </>
        )}
        {pages.isFetchingNextPage && (
          <Skeleton className="h-40 w-full rounded-xl" />
        )}
      </div>
    </PageBody>
  );
}