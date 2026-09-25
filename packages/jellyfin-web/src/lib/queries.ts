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
import type {
  BaseItemDto,
  BaseItemDtoQueryResult,
  HistoryPage,
  MediaSegmentDtoQueryResult,
  PickableUser,
  PlaybackInfoResponse,
  WebActivity,
} from './types';

const PAGE = 60;

/** Every key starts here, so a user switch or sign-out drops them all. */
function useKey() {
  const { client, user } = useSession();
  return ['jf', client.base, user.Id] as const;
}

export function useViews() {
  const { client, user } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'views'],
    queryFn: () =>
      client.get<BaseItemDtoQueryResult>('/UserViews', { userId: user.Id }),
    staleTime: 5 * 60_000,
  });
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

/** The children of a library, genre or collection, in the catalog's order. */
export function useItemPages(
  parentId: string,
  opts: {
    pageSize?: number;
    filter?: ItemFilter;
    types?: string;
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

export function useLibraryHeads(viewIds: string[], limit: number) {
  const { client, user } = useSession();
  const key = useKey();
  return useQueries({
    queries: viewIds.map((id) => ({
      queryKey: [...key, 'head', id, limit],
      queryFn: () =>
        client.get<BaseItemDtoQueryResult>('/Items', {
          userId: user.Id,
          ParentId: id,
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

export function useItem(itemId: string) {
  const { client, user } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'item', itemId],
    queryFn: () =>
      client.get<BaseItemDto>(`/Items/${itemId}`, { userId: user.Id }),
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

/** `Refresh` reruns the addons even when the server has a recent result. */
function usePlaybackInfoRequest() {
  const { client, user } = useSession();
  return (itemId: string, refresh = false) =>
    client.post<PlaybackInfoResponse>(
      `/Items/${itemId}/PlaybackInfo`,
      { UserId: user.Id, ...(refresh && { Refresh: true }) },
      { userId: user.Id }
    );
}

export function usePlaybackInfoOptions() {
  const request = usePlaybackInfoRequest();
  const key = useKey();
  return (itemId: string) =>
    queryOptions({
      queryKey: [...key, 'playback-info', itemId],
      queryFn: () => request(itemId),
      staleTime: 10 * 60_000,
    });
}

/**
 * The version list asks on every open, as the server decides when a result is
 * too old; the player reuses whatever the list showed.
 */
export function usePlaybackInfo(
  itemId: string,
  opts: { listing?: boolean } = {}
) {
  const options = usePlaybackInfoOptions();
  return useQuery({
    ...options(itemId),
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
    staleTime: 5 * 60_000,
  });
}

export function useActivity() {
  const { client } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'activity'],
    queryFn: () => client.get<WebActivity>('/AIOStreams/Activity'),
    refetchInterval: 15_000,
  });
}

export function useHistory(userId: string | null, localOnly: boolean) {
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
  });
}

/** Watch-state edits change every list, so each one refreshes them all. */
function useRefreshAll() {
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
