import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { useSession } from '@/lib/jellyfin/session';
import { useItemPages } from '@/lib/jellyfin/queries';
import { cardImages, cardShape, animatedPosterOf } from '@/lib/artwork/urls';
import { itemSubtitle, libraryLabel } from '@/lib/format';
import { href, itemPath } from '@/lib/paths';
import { useInView } from '@/hooks/use-in-view';
import { useSearchParam } from '@/hooks/use-search-param';
import { MediaRow } from '@/components/media/media-row';
import { MixedGrid } from '@/components/media/mixed-grid';
import { PosterCard } from '@/components/media/cards';
import { ItemMenu } from '@/components/media/item-menu';
import { ItemsRow } from '@/components/media/items-row';
import { CardPreviewHost } from '@/components/media/card-preview';
import { KindTabs, KINDS, useKindParam } from '@/components/media/kind-tabs';
import { PillTabs, fitsAsPills } from '@/components/pill-tabs';
import type {
  BaseItemDto,
  CollectionExtension,
  CollectionPart,
} from '@/lib/jellyfin/types';
import { Section } from './section';

export function Collection({ parent }: { parent: BaseItemDto }) {
  const extension = (parent as { aiostreams?: CollectionExtension }).aiostreams;
  const parts = extension?.sources ?? [];
  const [picked, setPicked] = useSearchParam('part');
  if (parts.length < 2)
    return (
      <>
        <SubCollections parent={parent} />
        <AllMembers parent={parent} />
      </>
    );

  const all = extension?.showAll !== false;
  const options: { value: string; label: string; note?: string }[] = [
    ...(all ? [{ value: '', label: KINDS[0].label }] : []),
    ...parts.map((part) => ({
      value: part.id,
      label: part.name,
      note: kindLabel(part),
    })),
  ];
  const rows =
    extension?.layout === 'rows' ||
    !fitsAsPills(
      options.map((option) => [option.label, option.note].join(' ').trim())
    );
  if (rows) {
    const shown = parts.find((part) => part.id === picked);
    if (shown)
      return (
        <Section name="collection" title={<PartName part={shown} />}>
          <MemberGrid parentId={shown.id} genre={shown.genre} />
        </Section>
      );
    return (
      <>
        <SubCollections parent={parent} />
        <div data-ui="collection-rows" className="space-y-10">
          <CardPreviewHost>
            {parts.map((part, i) => (
              <ItemsRow
                key={part.id}
                id={`part:${part.id}`}
                parentId={part.id}
                query={{ genre: part.genre }}
                title={part.name}
                label={kindLabel(part)}
                link={`${itemPath(parent)}?part=${part.id}`}
                first={i === 0}
              />
            ))}
          </CardPreviewHost>
        </div>
      </>
    );
  }

  const value =
    options.find((option) => option.value === picked)?.value ??
    options[0].value;
  const part = parts.find((p) => p.id === value);
  return (
    <>
      <SubCollections parent={parent} />
      <Section
        name="collection"
        title={t`In this collection`}
        action={
          <PillTabs
            name="collection-part"
            options={options}
            value={value}
            onChange={(next) =>
              setPicked(next === options[0].value ? undefined : next)
            }
          />
        }
      >
        {part ? (
          <MemberGrid parentId={part.id} genre={part.genre} />
        ) : (
          <MemberGrid parentId={parent.Id!} types={KINDS[0].types} />
        )}
      </Section>
    </>
  );
}

const kindLabel = (part: CollectionPart) =>
  libraryLabel({ CollectionType: part.collectionType });

function PartName({ part }: { part: CollectionPart }) {
  const kind = kindLabel(part);
  return (
    <span className="inline-flex items-baseline gap-2">
      {part.name}
      {kind && (
        <span className="text-sm font-normal text-[--muted]">{kind}</span>
      )}
    </span>
  );
}

/** Collections inside this one, which the members' kind filter leaves out. */
function SubCollections({ parent }: { parent: BaseItemDto }) {
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

function AllMembers({ parent }: { parent: BaseItemDto }) {
  const [types, setTypes] = useKindParam();
  return (
    <Section
      name="collection"
      title={t`In this collection`}
      action={<KindTabs types={types} onChange={setTypes} />}
    >
      <MemberGrid parentId={parent.Id!} types={types} />
    </Section>
  );
}

/** Members, paged like a library. */
function MemberGrid({
  parentId,
  types,
  genre,
}: {
  parentId: string;
  types?: string;
  genre?: string;
}) {
  const { client } = useSession();
  const pages = useItemPages(parentId, { types, genre });
  const items = pages.data?.pages.flatMap((p) => p.Items ?? []) ?? [];
  // Keyed on pages: a page can be all of one kind and none of it kept here.
  const sentinel = useInView<HTMLDivElement>(
    () => {
      if (pages.hasNextPage && !pages.isFetchingNextPage)
        void pages.fetchNextPage();
    },
    '800px',
    [pages.data?.pages.length, parentId, types]
  );
  return (
    <>
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
    </>
  );
}
