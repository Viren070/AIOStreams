import { t } from '@lingui/core/macro';
import React from 'react';
import {
  keepPreviousData,
  type QueryCache,
  queryOptions,
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { JellyfinClient } from './client';
import { useSession } from './session';
import { useFeature, useServerInfo } from './server-info';
import { settings, useSetting } from '@/lib/settings';
import { episodeMarks, lacksDetails, pickable } from '@/lib/format';
import type {
  BaseItemDto,
  BaseItemDtoQueryResult,
  SearchHintResult,
} from './types';

export const PAGE = 60;
/** Within most catalogs' own page, so the first answer waits on one upstream page. */
const FIRST_PAGE = 20;

/** Jellyfin's sort for what was added last. */
export const NEWEST = 'DateCreated,SortName';

/** Every key starts here, so a user switch or sign-out drops them all. */
export function useKey() {
  const { client, user } = useSession();
  return React.useMemo(
    () => ['jf', client.base, user.Id] as const,
    [client.base, user.Id]
  );
}

/** Libraries of movies and shows; music, books, photos and the like are left out. */
const SHOWN_LIBRARIES = new Set(['movies', 'tvshows', 'boxsets', 'mixed']);

function shownLibraries(
  result: BaseItemDtoQueryResult
): BaseItemDtoQueryResult {
  return {
    ...result,
    Items: result.Items?.filter(
      (v) => !v.CollectionType || SHOWN_LIBRARIES.has(v.CollectionType)
    ),
  };
}

function useViewsOptions() {
  const { client, user } = useSession();
  return queryOptions({
    queryKey: [...useKey(), 'views'],
    meta: { cache: 'home' },
    queryFn: () =>
      client.get<BaseItemDtoQueryResult>('/UserViews', { userId: user.Id }),
    staleTime: 5 * 60_000,
  });
}

export function useViews() {
  return useQuery({ ...useViewsOptions(), select: shownLibraries });
}

const liveTvView = (result: BaseItemDtoQueryResult) =>
  result.Items?.find((v) => v.CollectionType === 'livetv') ?? null;

/** The server's Live TV, which only servers with channels list. */
export function useLiveTvView() {
  return useQuery({ ...useViewsOptions(), select: liveTvView });
}

/** What a library holds by its type; one without a type holds both. */
export function libraryTypes(view: BaseItemDto): string {
  /* eslint-disable lingui/no-unlocalized-strings -- Jellyfin's item types */
  switch (view.CollectionType) {
    case 'movies':
      return 'Movie';
    case 'tvshows':
      return 'Series';
    case 'boxsets':
      return 'BoxSet';
    default:
      return 'Movie,Series';
  }
  /* eslint-enable lingui/no-unlocalized-strings */
}

export function useResume() {
  const { client, user } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'resume'],
    meta: { cache: 'home' },
    queryFn: () =>
      client.get<BaseItemDtoQueryResult>('/UserItems/Resume', {
        userId: user.Id,
        Limit: 24,
        MediaTypes: 'Video',
      }),
  });
}

export function useNextUp() {
  const { client, user } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'next-up'],
    meta: { cache: 'home' },
    queryFn: () =>
      client.get<BaseItemDtoQueryResult>('/Shows/NextUp', {
        userId: user.Id,
        Limit: 24,
        EnableResumable: false,
      }),
  });
}

/** When a title was last watched; for a next episode, when its show was. */
export function watchedAt(item: BaseItemDto): number {
  const show = (item as { aiostreams?: { showWatchedAt?: unknown } }).aiostreams
    ?.showWatchedAt;
  const at = typeof show === 'string' ? show : item.UserData?.LastPlayedDate;
  return (at && Date.parse(at)) || 0;
}

export function upNextAt(item: BaseItemDto): number {
  const watched = watchedAt(item);
  const aired = Date.parse(item.PremiereDate ?? '') || 0;
  return watched && Math.max(watched, Math.min(aired, Date.now()));
}

/** Most recently watched or aired first; next episodes without times stay after resume points. */
export function mergeRows(
  resume: BaseItemDto[] | null | undefined,
  nextUp: BaseItemDto[] | null | undefined
): BaseItemDto[] {
  const seen = new Set<string>();
  return [...(resume ?? []), ...(nextUp ?? [])]
    .filter((item) => {
      const keys = [item.Id, item.SeriesId].filter((k): k is string => !!k);
      if (keys.some((k) => seen.has(k))) return false;
      keys.forEach((k) => seen.add(k));
      return true;
    })
    .sort((a, b) => upNextAt(b) - upNextAt(a));
}

export type ItemFilter = 'unplayed' | 'played' | 'favorite' | 'resumable';

const FILTERS: Record<ItemFilter, string> = {
  unplayed: 'IsUnplayed',
  played: 'IsPlayed',
  favorite: 'IsFavorite',
  resumable: 'IsResumable',
};

/**
 * The items of a library or collection, in the catalog's order. A library is
 * asked for recursively by its types, as a server may keep its movies in folders.
 */
export function useItemPages(
  parentId: string,
  opts: {
    pageSize?: number;
    filter?: ItemFilter;
    types?: string;
    genreId?: string;
    recursive?: boolean;
    enabled?: boolean;
    /** Jellyfin's sort names, without which a catalog keeps its own order. */
    sortBy?: string;
    descending?: boolean;
  } = {}
) {
  const { client, user } = useSession();
  const pageSize = opts.pageSize ?? PAGE;
  return useInfiniteQuery({
    queryKey: [
      ...useKey(),
      'items',
      parentId,
      opts.filter,
      opts.types,
      opts.genreId,
      opts.recursive,
      pageSize,
      opts.sortBy,
      opts.descending,
    ],
    meta: { cache: 'home' },
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      client.get<BaseItemDtoQueryResult>('/Items', {
        userId: user.Id,
        ParentId: parentId,
        StartIndex: pageParam,
        Limit: pageParam ? pageSize : Math.min(pageSize, FIRST_PAGE),
        IncludeItemTypes: opts.types,
        GenreIds: opts.genreId,
        Recursive: opts.recursive,
        Filters: opts.filter ? FILTERS[opts.filter] : undefined,
        SortBy: opts.sortBy,
        SortOrder: opts.sortBy
          ? opts.descending
            ? 'Descending'
            : 'Ascending'
          : undefined,
        EnableTotalRecordCount: true,
      }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + (p.Items?.length ?? 0), 0);
      return last.Items?.length && loaded < (last.TotalRecordCount ?? 0)
        ? loaded
        : undefined;
    },
    enabled: opts.enabled ?? true,
    staleTime: 5 * 60_000,
  });
}

export function useLibraryHeads(views: BaseItemDto[], limit: number) {
  const { client, user } = useSession();
  const key = useKey();
  const queryClient = useQueryClient();
  const genres = useGenresOptions();
  const genreRequired = useFeature('genreRequired');
  const { stock } = useServerInfo();
  return useQueries({
    queries: views.map((view) => ({
      queryKey: [...key, 'head', view.Id, limit],
      meta: { cache: 'home' },
      queryFn: async () => {
        const required = genreRequired && needsGenre(view);
        // A server with the feature flags every library that needs a genre.
        const offered =
          genreRequired && !required
            ? undefined
            : await queryClient.fetchQuery(genres(view.Id!));
        return client.get<BaseItemDtoQueryResult>('/Items', {
          userId: user.Id,
          ParentId: view.Id,
          IncludeItemTypes: libraryTypes(view),
          GenreIds: defaultGenre(offered?.Items, required)?.Id,
          Recursive: true,
          Limit: limit,
          ...(stock && { SortBy: NEWEST, SortOrder: 'Descending' }),
        });
      },
      staleTime: 5 * 60_000,
    })),
  });
}

/**
 * A person's work, newest first. Pages advance by the server's offset, since
 * a title no addon here can open is left out of its page.
 */
export function usePersonItems(personId: string, types: string) {
  const { client, user } = useSession();
  return useInfiniteQuery({
    queryKey: [...useKey(), 'person-items', personId, types],
    meta: { cache: 'titles' },
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      client.get<BaseItemDtoQueryResult>('/Items', {
        userId: user.Id,
        PersonIds: personId,
        IncludeItemTypes: types,
        Recursive: true,
        SortBy: 'PremiereDate,ProductionYear,SortName',
        SortOrder: 'Descending',
        StartIndex: pageParam,
        Limit: PAGE,
      }),
    getNextPageParam: (last, pages) => {
      const offset = pages.length * PAGE;
      return offset < (last.TotalRecordCount ?? 0) ? offset : undefined;
    },
    staleTime: 60 * 60_000,
  });
}

/** The next episode of each show the user is caught up on. */
export function useUpcoming() {
  const { client, user } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'upcoming'],
    meta: { cache: 'home' },
    queryFn: () =>
      client.get<BaseItemDtoQueryResult>('/Shows/Upcoming', {
        userId: user.Id,
        Limit: 24,
      }),
    staleTime: 30 * 60_000,
  });
}

/** The library's episodes airing between two dates, aired ones included. */
export function useCalendar(from: Date, to: Date) {
  const { client, user } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'calendar', from.getTime(), to.getTime()],
    meta: { cache: 'home' },
    queryFn: () =>
      client.get<BaseItemDtoQueryResult>('/Items', {
        userId: user.Id,
        IncludeItemTypes: 'Episode,Movie',
        Recursive: true,
        MinPremiereDate: from.toISOString(),
        MaxPremiereDate: to.toISOString(),
        SortBy: 'PremiereDate',
        Limit: 500,
      }),
    staleTime: 30 * 60_000,
  });
}

function useGenresOptions() {
  const { client, user } = useSession();
  const key = useKey();
  return (viewId: string) =>
    queryOptions({
      queryKey: [...key, 'genres', viewId],
      meta: { cache: 'home' },
      queryFn: () =>
        client.get<BaseItemDtoQueryResult>('/Genres', {
          userId: user.Id,
          ParentId: viewId,
        }),
      staleTime: 30 * 60_000,
    });
}

export function useGenres(viewId: string) {
  return useQuery({ ...useGenresOptions()(viewId), enabled: !!viewId });
}

export function needsGenre(view: BaseItemDto | undefined): boolean {
  const extension = view as { aiostreams?: { genreRequired?: boolean } };
  return extension?.aiostreams?.genreRequired === true;
}

/**
 * The genre a library opens with: None where offered, which a catalog that
 * needs a genre reads as all of it, else the first when it needs one.
 */
export function defaultGenre(
  genres: BaseItemDto[] | null | undefined,
  required: boolean
): BaseItemDto | undefined {
  return (
    genres?.find((g) => g.Name === 'None') ??
    (required ? genres?.[0] : undefined)
  );
}

export function useSearch(
  term: string,
  types = 'Movie,Series',
  enabled = true
) {
  const { client, user } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'search', types, term],
    meta: { cache: 'search' },
    queryFn: () =>
      client.get<BaseItemDtoQueryResult>('/Items', {
        userId: user.Id,
        SearchTerm: term,
        Recursive: true,
        IncludeItemTypes: types,
        Limit: 48,
      }),
    enabled: enabled && term.length >= 2,
    placeholderData: keepPreviousData,
  });
}

export function useSearchSuggestions(
  term: string,
  limit: number,
  enabled = true
) {
  const { client, user } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'search-suggestions', term, limit],
    queryFn: () =>
      client.get<SearchHintResult>('/Search/Hints', {
        userId: user.Id,
        SearchTerm: term,
        IncludeItemTypes: 'Movie,Series',
        Limit: limit,
      }),
    enabled: enabled && term.length >= 2,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

/** What the item pages show beyond a row's fields. Jellyfin builds `ExternalUrls` from `ProviderIds`. */
/* eslint-disable lingui/no-unlocalized-strings -- Jellyfin's field names */
const DETAIL_FIELDS = [
  'AirTime',
  'Chapters',
  'ExternalUrls',
  'Genres',
  'Overview',
  'People',
  'PrimaryImageAspectRatio',
  'ProductionLocations',
  'ProviderIds',
  'RemoteTrailers',
  'Studios',
  'Taglines',
  'Trickplay',
].join(',');
/* eslint-enable lingui/no-unlocalized-strings */

/**
 * Looked up by id, not at `/Items/{id}`, which always carries the versions and
 * so makes a server run its addons for every page.
 */
export async function requestItem(
  client: JellyfinClient,
  userId: string,
  itemId: string,
  signal?: AbortSignal
): Promise<BaseItemDto> {
  const { Items } = await client.get<BaseItemDtoQueryResult>(
    '/Items',
    { userId, Ids: itemId, Fields: DETAIL_FIELDS },
    signal
  );
  const item = Items?.[0];
  if (!item) throw new Error(t`This item was not found`);
  return item;
}

/** The lists a query's answer holds: a page of items, pages of them, or items. */
function listsIn(data: unknown): unknown[][] {
  if (Array.isArray(data)) return [data];
  const { Items, pages } = (data ?? {}) as { Items?: unknown; pages?: unknown };
  if (Array.isArray(Items)) return [Items];
  if (Array.isArray(pages)) return pages.flatMap(listsIn);
  return [];
}

function listedItem(
  cache: QueryCache,
  base: string,
  userId: string | undefined,
  itemId: string
): BaseItemDto | undefined {
  for (const query of cache.getAll()) {
    const [jf, server, user] = query.queryKey;
    if (jf !== 'jf' || server !== base || user !== userId) continue;
    for (const list of listsIn(query.state.data)) {
      const found = list.find((entry) => (entry as BaseItemDto)?.Id === itemId);
      if (found) return found as BaseItemDto;
    }
  }
  return undefined;
}

/**
 * With `page`, for the title's page: a list already loaded that shows the item
 * stands in until it arrives, and it is asked for as the page starts to draw.
 */
function useItemOptions() {
  const { client, user } = useSession();
  const key = useKey();
  return (itemId: string) =>
    queryOptions({
      queryKey: [...key, 'item', itemId],
      meta: {
        cache: 'titles',
        keep: (item) => !lacksDetails(item as BaseItemDto),
      },
      // Dropped once nothing shows it, as the hero asks for each card it passes.
      queryFn: ({ signal }) => requestItem(client, user.Id!, itemId, signal),
    });
}

export function useFetchItem() {
  const queryClient = useQueryClient();
  const options = useItemOptions();
  return (itemId: string) => queryClient.fetchQuery(options(itemId));
}

export function useItem(itemId: string, opts: { page?: boolean } = {}) {
  const { client, user } = useSession();
  const queryClient = useQueryClient();
  const listed = React.useMemo(
    () =>
      opts.page
        ? listedItem(queryClient.getQueryCache(), client.base, user.Id, itemId)
        : undefined,
    [opts.page, queryClient, client.base, user.Id, itemId]
  );
  const options = useItemOptions()(itemId);
  if (opts.page && itemId && !queryClient.getQueryState(options.queryKey))
    void queryClient.prefetchQuery(options);
  return useQuery({ ...options, placeholderData: listed, enabled: !!itemId });
}

function useShowOptions() {
  const { client, user } = useSession();
  const key = useKey();
  return {
    seasons: (seriesId: string) =>
      queryOptions({
        queryKey: [...key, 'seasons', seriesId],
        meta: { cache: 'titles' },
        queryFn: () =>
          client.get<BaseItemDtoQueryResult>(`/Shows/${seriesId}/Seasons`, {
            userId: user.Id,
          }),
      }),
    episodes: (seriesId: string, seasonId: string | undefined) =>
      queryOptions({
        queryKey: [...key, 'episodes', seriesId, seasonId],
        meta: { cache: 'titles' },
        queryFn: () =>
          client.get<BaseItemDtoQueryResult>(`/Shows/${seriesId}/Episodes`, {
            userId: user.Id,
            SeasonId: seasonId,
          }),
      }),
    nextUp: (seriesId: string) =>
      queryOptions({
        queryKey: [...key, 'next-up', seriesId],
        meta: { cache: 'titles' },
        queryFn: () =>
          client.get<BaseItemDtoQueryResult>('/Shows/NextUp', {
            userId: user.Id,
            SeriesId: seriesId,
            Limit: 1,
          }),
      }),
  };
}

export function useSeasons(seriesId: string, enabled: boolean) {
  return useQuery({ ...useShowOptions().seasons(seriesId), enabled });
}

export function useEpisodes(seriesId: string, seasonId: string | undefined) {
  return useQuery({
    ...useShowOptions().episodes(seriesId, seasonId),
    enabled: !!seasonId,
  });
}

/** The episode a show continues with. */
export function useNextUpFor(seriesId: string, enabled: boolean) {
  return useQuery({ ...useShowOptions().nextUp(seriesId), enabled });
}

/** Waits for the episode a show continues with, sharing a request already on its way. */
export function useFetchNextUp() {
  const queryClient = useQueryClient();
  const show = useShowOptions();
  return (seriesId: string) =>
    queryClient.fetchQuery(show.nextUp(seriesId)).then((res) => res.Items?.[0]);
}

/** The season a show's page opens on: the first with something left, skipping specials. */
export function openingSeason(seasons: BaseItemDto[]): BaseItemDto | undefined {
  const regular = seasons.filter((s) => (s.IndexNumber ?? 1) > 0);
  return regular.find((s) => !s.UserData?.Played) ?? regular[0] ?? seasons[0];
}

/**
 * Asks for a show's next episode, seasons and opening episodes as its page
 * starts to draw, rather than each once the page has drawn the one before.
 */
export function useShowAhead(
  seriesId: string,
  isShow: boolean,
  seasonId: string | undefined
) {
  const queryClient = useQueryClient();
  const show = useShowOptions();
  if (!isShow) return;
  const nextUp = show.nextUp(seriesId);
  if (!queryClient.getQueryState(nextUp.queryKey))
    void queryClient.prefetchQuery(nextUp);
  const seasons = show.seasons(seriesId);
  if (queryClient.getQueryState(seasons.queryKey)) return;
  queryClient
    .fetchQuery(seasons)
    .then((result) => {
      const id = seasonId ?? openingSeason(result.Items ?? [])?.Id;
      if (id) void queryClient.prefetchQuery(show.episodes(seriesId, id));
    })
    .catch(() => {});
}

export function useSimilar(itemId: string, enabled: boolean) {
  const { client, user } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'similar', itemId],
    meta: { cache: 'titles' },
    queryFn: () =>
      client.get<BaseItemDtoQueryResult>(`/Items/${itemId}/Similar`, {
        userId: user.Id,
        Limit: 20,
      }),
    enabled,
    staleTime: 30 * 60_000,
  });
}

function useSkippedMarks() {
  const marked = useFeature('fillers');
  const [skipFillers] = useSetting(settings.next.skipFillers);
  const [skipRecaps] = useSetting(settings.next.skipRecaps);
  return { fillers: marked && skipFillers, recaps: marked && skipRecaps };
}

function isSkipped(
  episode: BaseItemDto,
  skip: { fillers: boolean; recaps: boolean }
): boolean {
  return episodeMarks(episode).some((m) =>
    m === 'filler' ? skip.fillers : skip.recaps
  );
}

/**
 * The episodes either side of this one, past the fillers and recaps the user
 * skips. A server that ignores `AdjacentTo` sends the whole show, so the
 * neighbours are found by position.
 */
export function useAdjacentEpisodes(item: BaseItemDto, enabled = true) {
  const { client, user } = useSession();
  const seriesId = item.Type === 'Episode' ? item.SeriesId : undefined;
  const skip = useSkippedMarks();
  const { fillers, recaps } = skip;
  const [unaired] = useSetting(settings.next.markUnaired);
  return useQuery({
    queryKey: [
      ...useKey(),
      'adjacent-episodes',
      item.Id,
      fillers,
      recaps,
      unaired,
    ],
    meta: { cache: 'titles' },
    queryFn: async () => {
      const skipped = (e: BaseItemDto) =>
        e.Id !== item.Id && isSkipped(e, skip);
      const episodes = (query: Record<string, string>) =>
        client
          .get<BaseItemDtoQueryResult>(`/Shows/${seriesId}/Episodes`, {
            userId: user.Id,
            ...query,
          })
          .then((res) => res.Items ?? []);
      let items = await episodes({ AdjacentTo: item.Id! });
      // A run of skipped episodes needs the rest of the show.
      if (items.some(skipped)) items = await episodes({});
      const at = items.findIndex((e) => e.Id === item.Id);
      const along = (step: 1 | -1) => {
        for (
          let i = at + step;
          at >= 0 && i >= 0 && i < items.length;
          i += step
        ) {
          if (!pickable(items[i])) return null;
          if (!skipped(items[i])) return items[i];
        }
        return null;
      };
      return { previous: along(-1), next: along(1) };
    },
    enabled: enabled && !!seriesId,
    staleTime: 10 * 60_000,
  });
}

const EPISODES_AFTER = 100;

export function useEpisodesAfter() {
  const { client, user } = useSession();
  const skip = useSkippedMarks();
  return async (item: BaseItemDto): Promise<BaseItemDto[]> => {
    if (item.Type !== 'Episode' || !item.SeriesId) return [];
    // A long show's whole list stops short of its later episodes.
    const { Items = [] } = await client.get<BaseItemDtoQueryResult>(
      `/Shows/${item.SeriesId}/Episodes`,
      {
        userId: user.Id,
        StartItemId: item.Id!,
        Limit: String(EPISODES_AFTER + 1),
      }
    );
    const at = Items.findIndex((e) => e.Id === item.Id);
    if (at < 0) return [];
    const after: BaseItemDto[] = [];
    for (const episode of Items.slice(at + 1)) {
      if (!pickable(episode)) break;
      if (!isSkipped(episode, skip)) after.push(episode);
    }
    return after;
  };
}
