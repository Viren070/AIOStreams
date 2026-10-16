import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
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
          <Trans>Favourites</Trans>
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
