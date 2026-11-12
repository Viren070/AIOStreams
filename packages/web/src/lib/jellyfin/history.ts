import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import { useSession } from './session';
import { useFeature } from './server-info';
import { ticksToMs } from '@/lib/format';
import type {
  BaseItemDto,
  BaseItemDtoQueryResult,
  HistoryEntry,
  HistoryPage,
  PickableUser,
  SessionInfoDto,
  WebActivity,
} from './types';
import { PAGE, useKey } from './queries';

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

export function useOwnAvatar(): string | null {
  const { user } = useSession();
  const users = usePickableUsers();
  return users.data?.find((u) => u.user.Id === user.Id)?.avatar ?? null;
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

export function useRemoteDevices(
  opts: { pollMs?: number; enabled?: boolean } = {}
) {
  const { client, user } = useSession();
  return useQuery({
    queryKey: [...useKey(), REMOTE_DEVICES],
    queryFn: async () => {
      const own = client.deviceId.toLowerCase();
      const sessions = await client.get<SessionInfoDto[]>('/Sessions', {
        ControllableByUserId: user.Id,
      });
      return sessions.filter(
        (s) =>
          s.SupportsRemoteControl &&
          s.DeviceId?.toLowerCase() !== own &&
          s.PlayableMediaTypes?.some((type) => type === 'Video')
      );
    },
    staleTime: 30_000,
    refetchInterval: opts.pollMs ?? false,
    enabled: opts.enabled ?? true,
  });
}

export const REMOTE_DEVICES = 'remote-devices';

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
