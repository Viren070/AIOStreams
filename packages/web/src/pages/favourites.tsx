import React from 'react';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { LuffyError } from '@aiostreams/ui/shared/luffy-error';
import { useSession } from '../lib/session';
import { useItemPages } from '../lib/queries';
import { useInView } from '../lib/use-in-view';
import { navigate, to } from '../lib/paths';
import { PageBody } from '../components/layout';
import { PillTabs } from '../components/pill-tabs';
import { MixedGrid } from '../components/mixed-grid';

const KINDS = [
  { value: 'Movie,Series', label: 'All' },
  { value: 'Movie', label: 'Movies' },
  { value: 'Series', label: 'Shows' },
];

export function FavouritesPage({ kind }: { kind?: string }) {
  const { client } = useSession();
  const types = KINDS.find((k) => k.value === kind)?.value ?? KINDS[0].value;
  const pages = useItemPages('', {
    filter: 'favorite',
    types,
    recursive: true,
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
          Favourites
        </h1>
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
        {pages.isError ? (
          <LuffyError title="Could not load your favourites" />
        ) : (
          <>
            <MixedGrid
              items={items}
              client={client}
              loading={pages.isLoading}
            />
            {!pages.isLoading && !items.length && (
              <p className="text-[--muted]">
                Nothing marked as a favourite yet.
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
