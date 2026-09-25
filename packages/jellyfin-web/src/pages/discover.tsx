import React from 'react';
import { Button } from '@aiostreams/ui/button';
import { Combobox } from '@aiostreams/ui/combobox';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { LuffyError } from '@aiostreams/ui/shared/luffy-error';
import { useSession } from '../lib/session';
import {
  useGenres,
  useItemPages,
  libraryTypes,
  useViews,
  type ItemFilter,
} from '../lib/queries';
import { useInView } from '../lib/use-in-view';
import { libraryLabel } from '../lib/format';
import { navigate, to } from '../lib/paths';
import { lastCatalog, rememberCatalog } from '../lib/settings';
import { PillTabs } from '../components/pill-tabs';
import { MixedGrid } from '../components/mixed-grid';
import type { BaseItemDto } from '../lib/types';

const FILTERS: { value: ItemFilter | undefined; label: string }[] = [
  { value: undefined, label: 'All' },
  { value: 'unplayed', label: 'Unwatched' },
  { value: 'played', label: 'Watched' },
  { value: 'favorite', label: 'Favourites' },
];

export type Kind = 'Movie' | 'Series' | 'BoxSet';

const KINDS: { kind: Kind; label: string; collectionType: string }[] = [
  { kind: 'Movie', label: 'Movies', collectionType: 'movies' },
  { kind: 'Series', label: 'Shows', collectionType: 'tvshows' },
  { kind: 'BoxSet', label: 'Collections', collectionType: 'boxsets' },
];

const PILL_LIMIT = 12;
const PILL_CHARACTERS = 120;
/** Stands for "no filter" in the picker, which has no empty option. */
const ALL = '\u0000all';

function kindOf(view: BaseItemDto | undefined): Kind | undefined {
  return KINDS.find((k) => k.collectionType === view?.CollectionType)?.kind;
}

/**
 * A catalog's genre extra is whatever filter it offers under that name: genres,
 * but also years, services or languages. A few short options read as pills;
 * a long list gets a searchable picker.
 */
function GenreFilter({
  genres,
  value,
  onChange,
}: {
  genres: BaseItemDto[];
  value: string | null;
  onChange(name: string | null): void;
}) {
  const characters = genres.reduce((n, g) => n + (g.Name?.length ?? 0), 0);
  if (genres.length > PILL_LIMIT || characters > PILL_CHARACTERS) {
    return (
      <Combobox
        aria-label="Filter"
        placeholder="Search"
        emptyMessage="Nothing matches."
        keepOpenOnSelect={false}
        className="w-full rounded-full sm:w-56"
        options={[
          { value: ALL, label: 'All', textValue: 'All' },
          ...genres.map((g) => ({
            value: g.Name ?? '',
            label: g.Name ?? '',
            textValue: g.Name ?? '',
          })),
        ]}
        value={[value ?? ALL]}
        onValueChange={(next) =>
          onChange(!next[0] || next[0] === ALL ? null : next[0])
        }
      />
    );
  }
  return (
    <div
      data-ui="genre-pills"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide lg:mx-0 lg:flex-wrap lg:px-0"
    >
      {[{ Id: 'all', Name: null }, ...genres].map((genre) => (
        <Button
          key={genre.Id ?? 'all'}
          data-ui="genre-pill"
          data-selected={value === genre.Name || undefined}
          size="sm"
          intent={value === genre.Name ? 'white' : 'gray-subtle'}
          className="flex-none rounded-full"
          onClick={() => onChange(genre.Name ?? null)}
        >
          {genre.Name ?? 'All'}
        </Button>
      ))}
    </div>
  );
}

/** Every catalog, whatever its type. */
function CatalogPicker({
  views,
  viewId,
  onChange,
}: {
  views: BaseItemDto[];
  viewId: string;
  onChange(id: string): void;
}) {
  if (views.length < 2) return null;
  return (
    <Combobox
      aria-label="Catalog"
      placeholder="Search"
      emptyMessage="Nothing matches."
      keepOpenOnSelect={false}
      className="w-full rounded-full sm:w-64"
      options={views.map((v) => ({
        value: v.Id!,
        label: v.Name ?? '',
        // Unique, or two catalogs of one name are numbered and neither picks.
        textValue: `${v.Name ?? ''} ${v.Id}`,
      }))}
      value={[viewId]}
      onValueChange={(next) => next[0] && onChange(next[0])}
    />
  );
}

export function DiscoverPage({
  viewId,
  genre,
  kind,
}: {
  viewId: string;
  genre?: string;
  kind?: string;
}) {
  const { client } = useSession();
  const views = useViews();
  const genres = useGenres(viewId);
  const all = views.data?.Items ?? [];
  const view = all.find((v) => v.Id === viewId);
  const [filter, setFilter] = React.useState<ItemFilter | undefined>();

  const current: Kind = (KINDS.find((k) => k.kind === kind)?.kind ??
    kindOf(view) ??
    'Movie') as Kind;
  // A catalog with no kind of its own holds any kind, so every tab offers it
  // and filters it.
  const untyped = all.some((v) => !kindOf(v));
  const siblings = all.filter(
    (v) => kindOf(v) === current || !kindOf(v) || v.Id === viewId
  );
  const offered = KINDS.filter(
    (k) =>
      k.kind === current ||
      all.some((v) => kindOf(v) === k.kind) ||
      (untyped && k.kind !== 'BoxSet')
  );

  // The genre travels by name, as its id belongs to the catalog it came from.
  const genreItem = genres.data?.Items?.find(
    (g) => g.Name?.toLowerCase() === genre?.toLowerCase()
  );
  const pages = useItemPages(viewId, {
    filter,
    types: view && kindOf(view) === current ? libraryTypes(view) : current,
    genreId: genreItem?.Id,
    recursive: true,
    enabled: !!view,
  });
  const items = pages.data?.pages.flatMap((p) => p.Items ?? []) ?? [];
  const total = pages.data?.pages[0]?.TotalRecordCount;
  const label = view ? libraryLabel(view) : undefined;

  React.useEffect(() => {
    if (view) rememberCatalog(viewId, current);
  }, [view, viewId, current]);

  // A genre carried from another catalog is dropped when this one lacks it.
  React.useEffect(() => {
    if (genre && genres.isSuccess && !genreItem)
      navigate(to.discover(viewId, { kind }), { replace: true });
  }, [genre, genres.isSuccess, genreItem, viewId, kind]);

  // Collections excepted, which a catalog with no kind rarely holds.
  const kindFor = (target: BaseItemDto | undefined): Kind =>
    kindOf(target) ?? (current === 'BoxSet' ? 'Movie' : current);

  const open = (id: string, next: Kind) =>
    navigate(
      to.discover(id, {
        genre: genre ?? undefined,
        kind: kindOf(all.find((v) => v.Id === id)) === next ? undefined : next,
      })
    );

  /*
   * The type switch: the catalog of the same name in the other type when
   * there is one, else this catalog filtered when it holds both, else the one
   * of that type last browsed.
   */
  const switchKind = (next: Kind) => {
    if (next === current) return;
    const sibling = all.find(
      (v) => v.Name === view?.Name && kindOf(v) === next && v.Id !== viewId
    );
    if (sibling) return open(sibling.Id!, next);
    if (view && !kindOf(view)) return open(viewId, next);
    if (items.some((i) => i.Type === next)) return open(viewId, next);
    const previous = lastCatalog(next);
    const target =
      all.find((v) => v.Id === previous && kindOf(v) === next) ??
      all.find((v) => kindOf(v) === next);
    if (target) return open(target.Id!, next);
  };

  const sentinel = useInView<HTMLDivElement>(
    () => {
      if (pages.hasNextPage && !pages.isFetchingNextPage)
        void pages.fetchNextPage();
    },
    '800px',
    [items.length, viewId, genre, current, filter]
  );

  return (
    <div className="space-y-6 px-4 pb-16 pt-6 lg:px-10 lg:pt-10">
      <div
        data-ui="page-header"
        className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
      >
        <h1 data-ui="page-title" className="text-3xl font-bold">
          {view?.Name ?? 'Discover'}
        </h1>
        {label && <span className="text-[--muted]">{label}</span>}
        {total != null && !filter && (
          <span className="text-sm text-[--muted]">{total} titles</span>
        )}
      </div>

      <div
        data-ui="discover-filters"
        className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
      >
        {offered.length > 1 && (
          <PillTabs
            name="kind"
            options={offered.map((k) => ({ value: k.kind, label: k.label }))}
            value={current}
            onChange={switchKind}
          />
        )}
        <CatalogPicker
          views={siblings}
          viewId={viewId}
          onChange={(id) => open(id, kindFor(all.find((v) => v.Id === id)))}
        />
        {!!genres.data?.Items?.length && (
          <GenreFilter
            genres={genres.data.Items}
            value={genre ?? null}
            onChange={(name) =>
              navigate(
                to.discover(viewId, {
                  genre: name ?? undefined,
                  kind: kindOf(view) === current ? undefined : current,
                })
              )
            }
          />
        )}
        <PillTabs
          name="filter"
          options={FILTERS}
          value={filter}
          onChange={setFilter}
        />
      </div>

      {pages.isError ? (
        <LuffyError title="Could not load this catalog" />
      ) : (
        <>
          <MixedGrid items={items} client={client} loading={pages.isLoading} />
          {!pages.isLoading && !items.length && (
            <p className="text-[--muted]">Nothing here.</p>
          )}
        </>
      )}
      {pages.isFetchingNextPage && (
        <Skeleton className="h-40 w-full rounded-xl" />
      )}
      <div ref={sentinel} />
    </div>
  );
}

/** Opens the catalog last browsed on this device, or the first one. */
export function DiscoverIndex({ lastViewId }: { lastViewId: string | null }) {
  const views = useViews();
  const all = views.data?.Items ?? [];
  const target = all.find((v) => v.Id === lastViewId) ?? all[0];

  React.useEffect(() => {
    if (target?.Id) navigate(to.discover(target.Id), { replace: true });
  }, [target?.Id]);

  if (views.isError) return <LuffyError title="Could not load your catalogs" />;
  if (views.isSuccess && !all.length) {
    return (
      <div className="px-4 pt-6 text-[--muted] lg:px-10 lg:pt-10">
        No catalogs are configured.
      </div>
    );
  }
  return (
    <div className="space-y-4 px-4 pb-16 pt-6 lg:px-10 lg:pt-10">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
