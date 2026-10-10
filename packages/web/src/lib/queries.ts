import React from 'react';
import {
  keepPreviousData,
  type QueryCache,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { JellyfinClient } from './client';
import { useSession } from './session';
import { useFeature } from './server-info';
import { settings, useSetting } from './settings';
import { episodeMarks, ticksToMs, unavailableLabel } from './format';
import type {
  BaseItemDto,
  BaseItemDtoQueryResult,
  HistoryEntry,
  HistoryPage,
  MediaSegmentDtoQueryResult,
  PickableUser,
  PlaybackInfoResponse,
  SessionInfoDto,
  SourceInfo,
  WebActivity,
} from './types';

const PAGE = 60;

/** Every key starts here, so a user switch or sign-out drops them all. */
function useKey() {
  const { client, user } = useSession();
  return ['jf', client.base, user.Id] as const;
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

export function useViews() {
  const { client, user } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'views'],
    meta: { cache: 'home' },
    queryFn: () =>
      client.get<BaseItemDtoQueryResult>('/UserViews', { userId: user.Id }),
    select: shownLibraries,
    staleTime: 5 * 60_000,
  });
}

/** What a library holds by its type; one without a type holds both. */
export function libraryTypes(view: BaseItemDto): string {
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

export type ItemFilter = 'unplayed' | 'played' | 'favorite';

const FILTERS: Record<ItemFilter, string> = {
  unplayed: 'IsUnplayed',
  played: 'IsPlayed',
  favorite: 'IsFavorite',
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
    ],
    meta: { cache: 'home' },
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      client.get<BaseItemDtoQueryResult>('/Items', {
        userId: user.Id,
        ParentId: parentId,
        StartIndex: pageParam,
        Limit: pageSize,
        IncludeItemTypes: opts.types,
        GenreIds: opts.genreId,
        Recursive: opts.recursive,
        Filters: opts.filter ? FILTERS[opts.filter] : undefined,
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
  return useQuery(useGenresOptions()(viewId));
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

/** What the item pages show beyond a row's fields. Jellyfin builds `ExternalUrls` from `ProviderIds`. */
const DETAIL_FIELDS = [
  'AirTime',
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
].join(',');

/**
 * Looked up by id, not at `/Items/{id}`, which always carries the versions and
 * so makes a server run its addons for every page.
 */
export async function requestItem(
  client: JellyfinClient,
  userId: string,
  itemId: string
): Promise<BaseItemDto> {
  const { Items } = await client.get<BaseItemDtoQueryResult>('/Items', {
    userId,
    Ids: itemId,
    Fields: DETAIL_FIELDS,
  });
  const item = Items?.[0];
  if (!item) throw new Error('This item was not found');
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
  const options = queryOptions({
    queryKey: [...useKey(), 'item', itemId],
    meta: { cache: 'titles' },
    queryFn: () => requestItem(client, user.Id!, itemId),
  });
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

/**
 * Any file plays as it is. A server gives a text subtitle an address only for
 * a client that says it takes one; the player asks for WebVTT whatever it is.
 */
const DEVICE_PROFILE = {
  DirectPlayProfiles: [{ Type: 'Video' }],
  SubtitleProfiles: [{ Format: 'vtt', Method: 'External' }],
};

/** The first version carries the item's id; the web app keys every version by its own. */
function withOwnId(source: SourceInfo): SourceInfo {
  const id = source.aiostreams?.id;
  return id ? { ...source, Id: id } : source;
}

/** Naming a version also gets its subtitles from subtitle addons. */
export async function requestPlaybackInfo(
  client: JellyfinClient,
  userId: string,
  itemId: string,
  opts: { refresh?: boolean; sourceId?: string; profile?: object } = {}
): Promise<PlaybackInfoResponse> {
  const info = await client.post<PlaybackInfoResponse>(
    `/Items/${itemId}/PlaybackInfo`,
    {
      UserId: userId,
      DeviceProfile: opts.profile ?? DEVICE_PROFILE,
      ...(opts.sourceId ? { MediaSourceId: opts.sourceId } : { Fresh: true }),
      ...(opts.refresh && { Refresh: true }),
    },
    { userId }
  );
  return { ...info, MediaSources: info.MediaSources?.map(withOwnId) };
}

function usePlaybackInfoRequest() {
  const { client, user } = useSession();
  return (itemId: string, refresh = false, sourceId?: string) =>
    requestPlaybackInfo(client, user.Id!, itemId, { refresh, sourceId });
}

export function usePlaybackInfoOptions() {
  const request = usePlaybackInfoRequest();
  const key = useKey();
  return (itemId: string, sourceId?: string) =>
    queryOptions({
      queryKey: [...key, 'playback-info', itemId, sourceId ?? null],
      queryFn: () => request(itemId, false, sourceId),
      staleTime: 10 * 60_000,
    });
}

/**
 * The version list asks on every open, as the server decides when a result is
 * too old; the player reuses whatever the list showed.
 */
export function usePlaybackInfo(
  itemId: string,
  opts: { listing?: boolean; sourceId?: string; enabled?: boolean } = {}
) {
  const options = usePlaybackInfoOptions();
  return useQuery({
    ...options(itemId, opts.sourceId),
    refetchOnMount: opts.listing ? 'always' : true,
    enabled: opts.enabled ?? true,
  });
}

export function useRefreshPlaybackInfo(itemId: string) {
  const queryClient = useQueryClient();
  const request = usePlaybackInfoRequest();
  const options = usePlaybackInfoOptions();
  return useMutation({
    mutationFn: () => request(itemId, true),
    onSuccess: (data) =>
      queryClient.setQueryData(options(itemId).queryKey, data),
  });
}

/** Intro, recap and credits times, looked up once the server has a runtime. */
export function useSegments(itemId: string) {
  const { client } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'segments', itemId],
    meta: { cache: 'titles' },
    queryFn: () =>
      client.get<MediaSegmentDtoQueryResult>(`/MediaSegments/${itemId}`),
    staleTime: 60 * 60_000,
  });
}

/** The users this session can switch to, whatever history it may read. */
export function usePickableUsers() {
  const { client } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'pickable-users'],
    meta: { cache: 'account' },
    queryFn: () => client.get<PickableUser[]>('/AIOStreams/Users'),
    enabled: useFeature('users'),
    staleTime: 5 * 60_000,
  });
}

export function useActivity(enabled = true) {
  const { client } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'activity'],
    queryFn: () => client.get<WebActivity>('/AIOStreams/Activity'),
    refetchInterval: 15_000,
    enabled,
  });
}

export function useHistory(
  userId: string | null,
  localOnly: boolean,
  enabled = true
) {
  const { client } = useSession();
  return useInfiniteQuery({
    queryKey: [...useKey(), 'history', userId, localOnly],
    meta: { cache: 'history' },
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      client.get<HistoryPage>('/AIOStreams/History', {
        userId,
        source: localOnly ? 'local' : undefined,
        cursor: pageParam,
      }),
    getNextPageParam: (last) => last.cursor ?? undefined,
    enabled,
  });
}

export function useOwnSessions(enabled: boolean) {
  const { client } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'own-sessions'],
    queryFn: () =>
      client.get<SessionInfoDto[]>('/Sessions', { ActiveWithinSeconds: 960 }),
    refetchInterval: 15_000,
    enabled,
  });
}

function playedEntry(userId: string, item: BaseItemDto): HistoryEntry {
  const at = Date.parse(item.UserData?.LastPlayedDate ?? '') || 0;
  return {
    userId,
    itemKey: item.Id!,
    kind: item.Type === 'Episode' ? 'episode' : 'movie',
    played: !!item.UserData?.Played,
    playCount: Math.max(1, item.UserData?.PlayCount ?? 0),
    positionMs: 0,
    durationMs: ticksToMs(item.RunTimeTicks),
    favorite: !!item.UserData?.IsFavorite,
    lastPlayedAt: at || null,
    sortAt: at,
    origin: null,
    tracker: null,
    item,
  };
}

export function useOwnHistory(enabled: boolean) {
  const { client, user } = useSession();
  return useInfiniteQuery({
    queryKey: [...useKey(), 'own-history'],
    meta: { cache: 'history' },
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<HistoryPage> => {
      const res = await client.get<BaseItemDtoQueryResult>('/Items', {
        userId: user.Id,
        Filters: 'IsPlayed',
        SortBy: 'DatePlayed',
        SortOrder: 'Descending',
        Recursive: true,
        IncludeItemTypes: 'Movie,Episode',
        StartIndex: pageParam,
        Limit: PAGE,
        EnableTotalRecordCount: true,
      });
      const items = res.Items ?? [];
      const end = pageParam + items.length;
      return {
        items: items.map((item) => playedEntry(user.Id!, item)),
        cursor:
          items.length && end < (res.TotalRecordCount ?? 0)
            ? String(end)
            : null,
      };
    },
    getNextPageParam: (last) => (last.cursor ? Number(last.cursor) : undefined),
    enabled,
  });
}

const OWN_TOTALS = [
  [
    '/Items',
    { Filters: 'IsPlayed', IncludeItemTypes: 'Movie', Recursive: true },
  ],
  [
    '/Items',
    { Filters: 'IsPlayed', IncludeItemTypes: 'Episode', Recursive: true },
  ],
  ['/UserItems/Resume', { MediaTypes: 'Video' }],
  [
    '/Items',
    {
      Filters: 'IsFavorite',
      IncludeItemTypes: 'Movie,Series',
      Recursive: true,
    },
  ],
] as const;

export function useOwnTotals(enabled: boolean) {
  const { client, user } = useSession();
  const key = useKey();
  const results = useQueries({
    queries: OWN_TOTALS.map(([path, filter], i) => ({
      queryKey: [...key, 'own-total', i],
      meta: { cache: 'history' },
      queryFn: async () =>
        (
          await client.get<BaseItemDtoQueryResult>(path, {
            userId: user.Id,
            Limit: 0,
            EnableTotalRecordCount: true,
            ...filter,
          })
        ).TotalRecordCount ?? 0,
      enabled,
    })),
  });
  const [movies, episodes, inProgress, favorites] = results.map((r) => r.data);
  return { movies, episodes, inProgress, favorites };
}

/** Watch-state edits change every list, so each one refreshes them all. */
export function useRefreshAll() {
  const queryClient = useQueryClient();
  const key = useKey();
  return () => queryClient.invalidateQueries({ queryKey: key });
}

const NOT_WATCH_STATE = new Set(['playback-info', 'segments']);

/** {@link useRefreshAll} for the server's pushes, which come during playback, so versions stay. */
export function useRefreshWatchState() {
  const queryClient = useQueryClient();
  const key = useKey();
  return () =>
    queryClient.invalidateQueries({
      queryKey: key,
      predicate: (query) => !NOT_WATCH_STATE.has(String(query.queryKey[3])),
    });
}

/** Marks as another user when the item is in that user's history. */
export function useSetPlayed() {
  const { clientFor, user } = useSession();
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async (v: {
      itemId: string;
      played: boolean;
      userId?: string;
    }) => {
      const userId = v.userId ?? user.Id!;
      const client = await clientFor(userId);
      const path = `/UserPlayedItems/${v.itemId}`;
      return v.played
        ? client.post(path, undefined, { userId })
        : client.delete(path, { userId });
    },
    onSettled: refresh,
  });
}

export function useClearResume() {
  const { client, user } = useSession();
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (itemId: string) =>
      client.post(
        `/UserItems/${itemId}/UserData`,
        { PlaybackPositionTicks: 0 },
        { userId: user.Id }
      ),
    onSettled: refresh,
  });
}

/**
 * Marks an episode and the aired ones before it. Without the server's endpoint,
 * an earlier season with nothing watched goes as one mark, which trackers take
 * as one batch; the rest go an episode at a time.
 */
export function useSetPlayedUpTo() {
  const { client, user } = useSession();
  const refresh = useRefreshAll();
  const native = useFeature('playedUpTo');
  return useMutation({
    mutationFn: async (episode: BaseItemDto) => {
      if (native) return client.post(`/AIOStreams/PlayedUpTo/${episode.Id}`);
      const res = await client.get<BaseItemDtoQueryResult>(
        `/Shows/${episode.SeriesId}/Episodes`,
        { userId: user.Id }
      );
      const all = res.Items ?? [];
      const ts = episode.ParentIndexNumber ?? 0;
      const te = episode.IndexNumber ?? 0;
      const upTo = (e: BaseItemDto) => {
        const s = e.ParentIndexNumber;
        if (s == null || e.IndexNumber == null) return false;
        return s === ts ? e.IndexNumber <= te : ts > 0 && s > 0 && s < ts;
      };
      const aired = (e: BaseItemDto) =>
        !e.PremiereDate || Date.parse(e.PremiereDate) <= Date.now();
      const bySeason = new Map<string, BaseItemDto[]>();
      for (const e of all) {
        const key = e.SeasonId ?? '';
        bySeason.set(key, [...(bySeason.get(key) ?? []), e]);
      }
      const ids: string[] = [];
      for (const [seasonId, episodes] of bySeason) {
        const wanted = episodes.filter(
          (e) => upTo(e) && aired(e) && !e.UserData?.Played
        );
        if (!wanted.length) continue;
        const whole =
          seasonId &&
          episodes[0].ParentIndexNumber !== ts &&
          wanted.length === episodes.length;
        if (whole) ids.push(seasonId);
        else ids.push(...wanted.map((e) => e.Id!));
      }
      const queue = [...ids];
      const worker = async () => {
        for (let id = queue.shift(); id; id = queue.shift())
          await client.post(`/UserPlayedItems/${id}`, undefined, {
            userId: user.Id,
          });
      };
      await Promise.all(Array.from({ length: 4 }, worker));
    },
    onSettled: refresh,
  });
}

export function useSetFavorite() {
  const { client, user } = useSession();
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (v: { itemId: string; favorite: boolean }) => {
      const path = `/UserFavoriteItems/${v.itemId}`;
      return v.favorite
        ? client.post(path, undefined, { userId: user.Id })
        : client.delete(path, { userId: user.Id });
    },
    onSettled: refresh,
  });
}

export function useSetDropped() {
  const { client, user } = useSession();
  const refresh = useRefreshAll();
  return useMutation({
    // A like undrops, where clearing the rating would clear a numeric one too.
    mutationFn: (v: { itemId: string; dropped: boolean }) =>
      client.post(`/UserItems/${v.itemId}/Rating`, undefined, {
        userId: user.Id,
        Likes: !v.dropped,
      }),
    onSettled: refresh,
  });
}

/** From 0 to 10; `null` clears it. */
export function useSetRating() {
  const { client, user } = useSession();
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (v: { itemId: string; rating: number | null }) =>
      v.rating == null
        ? client.delete(`/UserItems/${v.itemId}/Rating`, { userId: user.Id })
        : client.post(
            `/UserItems/${v.itemId}/UserData`,
            { Rating: v.rating },
            { userId: user.Id }
          ),
    onSettled: refresh,
  });
}

export function useClearHistory() {
  const { client } = useSession();
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (v: { userId: string; itemKeys?: string[] }) =>
      client.post<{ cleared: number }>('/AIOStreams/History/Clear', v),
    onSettled: refresh,
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
    m === 'Filler' ? skip.fillers : skip.recaps
  );
}

/**
 * The episodes either side of this one, past the fillers and recaps the user
 * skips. A server that ignores `AdjacentTo` sends the whole show, so the
 * neighbours are found by position.
 */
export function useAdjacentEpisodes(item: BaseItemDto) {
  const { client, user } = useSession();
  const seriesId = item.Type === 'Episode' ? item.SeriesId : undefined;
  const skip = useSkippedMarks();
  const { fillers, recaps } = skip;
  return useQuery({
    queryKey: [...useKey(), 'adjacent-episodes', item.Id, fillers, recaps],
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
          if (unavailableLabel(items[i])) return null;
          if (!skipped(items[i])) return items[i];
        }
        return null;
      };
      return { previous: along(-1), next: along(1) };
    },
    enabled: !!seriesId,
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
      if (unavailableLabel(episode)) break;
      if (!isSkipped(episode, skip)) after.push(episode);
    }
    return after;
  };
}
