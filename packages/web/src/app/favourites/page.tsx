import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { BiShuffle } from 'react-icons/bi';
import { Button } from '@aiostreams/ui/button';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { LuffyError } from '@aiostreams/ui/shared/luffy-error';
import { useSession } from '@/lib/jellyfin/session';
import { useItemPages, useLiveTvView } from '@/lib/jellyfin/queries';
import {
  FAVOURITES,
  useChannelPages,
  useNow,
  useSchedules,
} from '@/features/live-tv/live-tv';
import { useInView } from '@/hooks/use-in-view';
import { useSearchParam } from '@/hooks/use-search-param';
import { PageBody } from '@/components/shell/page';
import { PillTabs } from '@/components/pill-tabs';
import { MixedGrid } from '@/components/media/mixed-grid';
import { CardGrid } from '@/components/media/media-row';
import { ChannelCard } from '@/features/live-tv/channel-card';
import { BATCH } from '@/features/live-tv/channel-list';
import { openRandom } from '@/components/media/random-pick';
import {
  SORTS,
  SortPicker,
  useSortParam,
  type SortKey,
} from '@/components/media/sort-picker';

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

/* eslint-disable-next-line lingui/no-unlocalized-strings -- Jellyfin's item type */
const CHANNELS = 'TvChannel';

const FAVOURITE_SORTS: SortKey[] = ['added', 'name', 'released', 'rating'];

export function FavouritesPage({ kind }: { kind?: string }) {
  const { client } = useSession();
  const live = !!useLiveTvView().data;
  const kinds = live
    ? [...KINDS, { value: CHANNELS, label: t`Channels` }]
    : KINDS;
  const types = kinds.find((k) => k.value === kind)?.value ?? KINDS[0].value;
  const channels = types === CHANNELS;
  const [, setKind] = useSearchParam('kind');
  const [sort, setSort] = useSortParam(FAVOURITE_SORTS, 'added');
  const pages = useItemPages('', {
    filter: 'favorite',
    types,
    recursive: true,
    enabled: !channels,
    sortBy: SORTS[sort.key],
    descending: sort.descending,
  });
  const items = pages.data?.pages.flatMap((p) => p.Items ?? []) ?? [];
  const sentinel = useInView<HTMLDivElement>(
    () => {
      if (pages.hasNextPage && !pages.isFetchingNextPage)
        void pages.fetchNextPage();
    },
    '800px',
    [items.length, types]
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
            options={kinds}
            value={types}
            onChange={(next) =>
              setKind(next === KINDS[0].value ? undefined : next)
            }
          />
          {!channels && (
            <SortPicker
              keys={FAVOURITE_SORTS}
              value={sort}
              onChange={setSort}
            />
          )}
          {!!items.length && !channels && (
            <Button
              data-ui="random-pick"
              size="sm"
              intent="gray-subtle"
              className="ms-auto rounded-full"
              leftIcon={<BiShuffle />}
              onClick={() => openRandom({ kind: 'favourite', types })}
            >
              <Trans>Random pick</Trans>
            </Button>
          )}
        </div>
        {channels ? (
          <FavouriteChannels />
        ) : pages.isError ? (
          <LuffyError title={t`Could not load your favourites`} />
        ) : (
          <>
            <div data-nav-start>
              <MixedGrid
                items={items}
                client={client}
                loading={pages.isLoading}
              />
            </div>
            {!pages.isLoading && !items.length && (
              <p className="text-[--muted]">
                <Trans>Nothing marked as a favourite yet.</Trans>
              </p>
            )}
          </>
        )}
        {pages.isFetchingNextPage && (
          <Skeleton className="h-40 w-full rounded-xl" />
        )}
        <div ref={sentinel} />
      </div>
    </PageBody>
  );
}

function FavouriteChannels() {
  const pages = useChannelPages(FAVOURITES);
  const channels = React.useMemo(
    () => pages.data?.pages.flatMap((p) => p.Items ?? []) ?? [],
    [pages.data]
  );
  const batches = React.useMemo(() => {
    const ids = channels.map((c) => c.Id!);
    return Array.from({ length: Math.ceil(ids.length / BATCH) }, (_, i) =>
      ids.slice(i * BATCH, (i + 1) * BATCH)
    );
  }, [channels]);
  const schedules = useSchedules(batches);
  const now = useNow();
  const sentinel = useInView<HTMLDivElement>(
    () => {
      if (pages.hasNextPage && !pages.isFetchingNextPage)
        void pages.fetchNextPage();
    },
    '800px',
    [channels.length]
  );
  if (pages.isError)
    return <LuffyError title={t`Could not load your favourites`} />;
  return (
    <>
      <div data-nav-start>
        <CardGrid shape="wide">
          {channels.map((channel) => (
            <ChannelCard
              key={channel.Id}
              channel={channel}
              programmes={schedules.get(channel.Id!)}
              now={now}
            />
          ))}
        </CardGrid>
      </div>
      {!pages.isLoading && !channels.length && (
        <p className="text-[--muted]">
          <Trans>No favourite channels yet.</Trans>
        </p>
      )}
      <div ref={sentinel} />
    </>
  );
}
