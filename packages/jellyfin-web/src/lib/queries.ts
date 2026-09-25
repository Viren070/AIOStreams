import {
  keepPreviousData,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useSession } from './session';
import { useFeature } from './server-info';
import { ticksToMs } from './format';
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
  return useQueries({
    queries: views.map((view) => ({
      queryKey: [...key, 'head', view.Id, limit],
      queryFn: () =>
        client.get<BaseItemDtoQueryResult>('/Items', {
          userId: user.Id,
          ParentId: view.Id,
          IncludeItemTypes: libraryTypes(view),
          Recursive: true,
          Limit: limit,
        }),
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

/** Episodes of shows in progress that air in the next couple of weeks. */
export function useUpcoming() {
  const { client, user } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'upcoming'],
    queryFn: () =>
      client.get<BaseItemDtoQueryResult>('/Shows/Upcoming', {
        userId: user.Id,
        Limit: 24,
      }),
    staleTime: 30 * 60_000,
  });
}

export function useGenres(viewId: string) {
  const { client, user } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'genres', viewId],
    queryFn: () =>
      client.get<BaseItemDtoQueryResult>('/Genres', {
        userId: user.Id,
        ParentId: viewId,
      }),
    staleTime: 30 * 60_000,
  });
}

export function useSearch(term: string) {
  const { client, user } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'search', term],
    queryFn: () =>
      client.get<BaseItemDtoQueryResult>('/Items', {
        userId: user.Id,
        SearchTerm: term,
        Recursive: true,
        IncludeItemTypes: 'Movie,Series',
        Limit: 48,
      }),
    enabled: term.length >= 2,
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
export function useItem(itemId: string) {
  const { client, user } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'item', itemId],
    queryFn: async () => {
      const { Items } = await client.get<BaseItemDtoQueryResult>('/Items', {
        userId: user.Id,
        Ids: itemId,
        Fields: DETAIL_FIELDS,
      });
      const item = Items?.[0];
      if (!item) throw new Error('This item was not found');
      return item;
    },
  });
}

export function useSeasons(seriesId: string, enabled: boolean) {
  const { client, user } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'seasons', seriesId],
    queryFn: () =>
      client.get<BaseItemDtoQueryResult>(`/Shows/${seriesId}/Seasons`, {
        userId: user.Id,
      }),
    enabled,
  });
}

export function useEpisodes(seriesId: string, seasonId: string | undefined) {
  const { client, user } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'episodes', seriesId, seasonId],
    queryFn: () =>
      client.get<BaseItemDtoQueryResult>(`/Shows/${seriesId}/Episodes`, {
        userId: user.Id,
        SeasonId: seasonId,
      }),
    enabled: !!seasonId,
  });
}

/** The episode a show continues with. */
export function useNextUpFor(seriesId: string, enabled: boolean) {
  const { client, user } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'next-up', seriesId],
    queryFn: () =>
      client.get<BaseItemDtoQueryResult>('/Shows/NextUp', {
        userId: user.Id,
        SeriesId: seriesId,
        Limit: 1,
      }),
    enabled,
  });
}

export function useSimilar(itemId: string, enabled: boolean) {
  const { client, user } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'similar', itemId],
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
function usePlaybackInfoRequest() {
  const { client, user } = useSession();
  return async (itemId: string, refresh = false, sourceId?: string) => {
    const info = await client.post<PlaybackInfoResponse>(
      `/Items/${itemId}/PlaybackInfo`,
      {
        UserId: user.Id,
        DeviceProfile: DEVICE_PROFILE,
        ...(sourceId ? { MediaSourceId: sourceId } : { Fresh: true }),
        ...(refresh && { Refresh: true }),
      },
      { userId: user.Id }
    );
    return { ...info, MediaSources: info.MediaSources?.map(withOwnId) };
  };
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
  opts: { listing?: boolean; sourceId?: string } = {}
) {
  const options = usePlaybackInfoOptions();
  return useQuery({
    ...options(itemId, opts.sourceId),
    refetchOnMount: opts.listing ? 'always' : true,
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
    played: true,
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

export function useSetPlayedUpTo() {
  const { client } = useSession();
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (episodeId: string) =>
      client.post(`/AIOStreams/PlayedUpTo/${episodeId}`),
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
    mutationFn: (v: { itemId: string; dropped: boolean }) => {
      const path = `/UserItems/${v.itemId}/Rating`;
      return v.dropped
        ? client.post(path, undefined, { userId: user.Id, Likes: false })
        : client.delete(path, { userId: user.Id });
    },
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

/** The episode after this one in its series, across seasons. */
export function useNextEpisode(item: BaseItemDto) {
  const { client, user } = useSession();
  const seriesId = item.Type === 'Episode' ? item.SeriesId : undefined;
  return useQuery({
    queryKey: [...useKey(), 'next-episode', item.Id],
    queryFn: async () => {
      const res = await client.get<BaseItemDtoQueryResult>(
        `/Shows/${seriesId}/Episodes`,
        { userId: user.Id, StartItemId: item.Id, Limit: 2 }
      );
      const [current, next] = res.Items ?? [];
      return current?.Id === item.Id && next ? next : null;
    },
    enabled: !!seriesId,
    staleTime: 10 * 60_000,
  });
}
