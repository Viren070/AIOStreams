import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { useSession } from '@/lib/jellyfin/session';
import { useItemPages } from '@/lib/jellyfin/queries';
import { cardImages, cardShape, animatedPosterOf } from '@/lib/artwork/urls';
import { itemSubtitle } from '@/lib/format';
import { href, itemPath } from '@/lib/paths';
import { useInView } from '@/hooks/use-in-view';
import { MediaRow } from '@/components/media/media-row';
import { MixedGrid } from '@/components/media/mixed-grid';
import { PosterCard } from '@/components/media/cards';
import { ItemMenu } from '@/components/media/item-menu';
import { KindTabs, useKindParam } from '@/components/media/kind-tabs';
import type { BaseItemDto } from '@/lib/jellyfin/types';
import { Section } from './section';

/** Collections inside this one, which the members' kind filter leaves out. */
export function SubCollections({ parent }: { parent: BaseItemDto }) {
  const { client } = useSession();
  const pages = useItemPages(parent.Id!, { types: 'BoxSet' });
  const all = pages.data?.pages.flatMap((p) => p.Items ?? []) ?? [];
  // Some servers ignore the filter here, listing sub-collections first.
  const items = all.filter((i) => i.Type === 'BoxSet');
  const filtered = items.length === all.length;
  const landscape =
    items.length > 0 &&
    items.filter((i) => cardShape(i) === 'landscape').length > items.length / 2;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages;
  const more = React.useCallback(() => {
    if (filtered && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [filtered, hasNextPage, isFetchingNextPage, fetchNextPage]);
  if (!items.length) return null;
  return (
    <MediaRow
      id="sub-collections"
      title={t`Collections`}
      shape={landscape ? 'wide' : 'poster'}
      loadingMore={isFetchingNextPage}
      onEndReached={more}
    >
      {items.map((item) => (
        <ItemMenu key={item.Id} item={item}>
          <PosterCard
            href={href(itemPath(item))}
            shape={landscape ? 'landscape' : cardShape(item)}
            image={(width) =>
              cardImages(
                client,
                item,
                landscape ? 'landscape' : cardShape(item),
                { maxWidth: width }
              )
            }
            animated={animatedPosterOf(item)}
            title={item.Name ?? ''}
            subtitle={itemSubtitle(item)}
            itemType={item.Type}
            watched={item.UserData?.Played}
            favourite={item.UserData?.IsFavorite}
          />
        </ItemMenu>
      ))}
    </MediaRow>
  );
}

/** A collection's members, paged like a library. */
export function Members({ parent }: { parent: BaseItemDto }) {
  const { client } = useSession();
  const [types, setTypes] = useKindParam();
  const pages = useItemPages(parent.Id!, { types });
  const items = pages.data?.pages.flatMap((p) => p.Items ?? []) ?? [];
  // Keyed on pages: a page can be all of one kind and none of it kept here.
  const sentinel = useInView<HTMLDivElement>(
    () => {
      if (pages.hasNextPage && !pages.isFetchingNextPage)
        void pages.fetchNextPage();
    },
    '800px',
    [pages.data?.pages.length, types]
  );
  return (
    <Section
      name="collection"
      title={t`In this collection`}
      action={<KindTabs types={types} onChange={setTypes} />}
    >
      <div data-nav-start>
        <MixedGrid items={items} client={client} loading={pages.isLoading} />
      </div>
      {!pages.isLoading && !items.length && (
        <p className="text-[--muted]">
          <Trans>Nothing here.</Trans>
        </p>
      )}
      {pages.isFetchingNextPage && (
        <Skeleton className="h-40 w-full rounded-xl" />
      )}
      <div ref={sentinel} />
    </Section>
  );
}
