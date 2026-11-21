import React from 'react';
import { BiChevronRight } from 'react-icons/bi';
import { useSession } from '@/lib/jellyfin/session';
import { useItemPages, type ItemPagesOptions } from '@/lib/jellyfin/queries';
import { cardImages, cardShape, animatedPosterOf } from '@/lib/artwork/urls';
import { itemSubtitle, progressOf } from '@/lib/format';
import { href, itemPath } from '@/lib/paths';
import { useNear } from '@/hooks/use-in-view';
import { Anchor } from '@/components/anchor';
import { MediaRow } from './media-row';
import { PosterCard } from './cards';
import { ItemMenu } from './item-menu';

export const ROW_PAGE = 20;

/**
 * A row of a parent's items, fetched and drawn once near the screen and paged
 * as it scrolls. Its cards wait too when already fetched, as most rows are out
 * of sight: only the first starts drawn, as a page opens at its top.
 */
export function ItemsRow({
  id,
  parentId,
  query,
  title,
  label,
  link,
  first,
}: {
  id: string;
  parentId: string;
  query?: Omit<ItemPagesOptions, 'pageSize' | 'enabled'>;
  title: string;
  label?: string | null;
  link: string;
  first: boolean;
}) {
  const { client } = useSession();
  const [ref, near] = useNear<HTMLElement>('400px', first);
  const pages = useItemPages(parentId, {
    ...query,
    pageSize: ROW_PAGE,
    enabled: near,
  });
  const items = React.useMemo(
    () => pages.data?.pages.flatMap((p) => p.Items ?? []) ?? [],
    [pages.data]
  );
  const landscape =
    items.length > 0 &&
    items.filter((i) => cardShape(i) === 'landscape').length > items.length / 2;
  // Made again only with the items, as the row renders for its paging too.
  const cards = React.useMemo(
    () =>
      near &&
      items.map((item) => (
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
            unwatched={item.UserData?.UnplayedItemCount ?? undefined}
            progress={progressOf(item)}
          />
        </ItemMenu>
      )),
    [near, items, landscape, client]
  );
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages;
  const more = React.useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Shown loading until fetched: the row itself must mount to come into view.
  return (
    <MediaRow
      rowRef={ref}
      id={id}
      title={
        <Anchor
          href={href(link)}
          className="group/title inline-flex items-baseline gap-2"
        >
          {title}
          {label && (
            <span className="text-sm font-normal text-[--muted]">{label}</span>
          )}
          <BiChevronRight className="self-center text-xl text-[--muted] transition-transform group-hover/title:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover/title:-translate-x-0.5" />
        </Anchor>
      }
      shape={landscape ? 'wide' : 'poster'}
      loading={!near || (!pages.data && !pages.isError)}
      waiting={!near}
      loadingMore={isFetchingNextPage}
      onEndReached={more}
    >
      {cards}
    </MediaRow>
  );
}
