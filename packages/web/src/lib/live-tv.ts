import { t } from '@lingui/core/macro';
import React from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQueries,
} from '@tanstack/react-query';
import { useSession } from './session';
import { useGenres, useKey, useLiveTvView } from './queries';
import { storage, storedMap } from './storage';
import type { BaseItemDto, BaseItemDtoQueryResult } from './types';

/** Groups of the app's own, before the server's. */
export const FAVOURITES = 'favourites';
export const RECENT = 'recent';
export const ALL = 'all';

export interface ChannelGroup {
  id: string;
  name: string;
}

const CHANNEL_PAGE = 100;
const RECENT_MAX = 30;

/** Channels played on this device, newest first, by user. */
const recents = storedMap<string[]>('aiostreams-web-recent-channels', 20);

export function noteChannelPlayed(userId: string, channelId: string): void {
  const list = recents.get(userId) ?? [];
  recents.set(
    userId,
    [channelId, ...list.filter((id) => id !== channelId)].slice(0, RECENT_MAX)
  );
}

export const recentChannels = (userId: string): string[] =>
  recents.get(userId) ?? [];

const GROUP_KEY = 'aiostreams-web-live-group';

export const lastGroup = (): string => storage.get<string>(GROUP_KEY) ?? ALL;

export function rememberGroup(id: string): void {
  storage.set(GROUP_KEY, id);
}

export function useChannelGroups(): {
  groups: ChannelGroup[];
  isLoading: boolean;
} {
  const { user } = useSession();
  const view = useLiveTvView();
  const genres = useGenres(view.data?.Id ?? '');
  const favourites = useChannelPages(FAVOURITES, { pageSize: 1 });
  const hasFavourites = !!favourites.data?.pages[0]?.TotalRecordCount;
  const hasRecents = recentChannels(user.Id!).length > 0;
  const groups = React.useMemo(
    () => [
      ...(hasFavourites ? [{ id: FAVOURITES, name: t`Favourites` }] : []),
      ...(hasRecents ? [{ id: RECENT, name: t`Recent` }] : []),
      { id: ALL, name: t`All channels` },
      ...(genres.data?.Items ?? []).map((g) => ({
        id: g.Id!,
        name: g.Name ?? '',
      })),
    ],
    [hasFavourites, hasRecents, genres.data]
  );
  return { groups, isLoading: view.isLoading || genres.isLoading };
}

export function useChannelPages(
  group: string,
  opts: { pageSize?: number; enabled?: boolean } = {}
) {
  const { client, user } = useSession();
  const pageSize = opts.pageSize ?? CHANNEL_PAGE;
  const recent = group === RECENT ? recentChannels(user.Id!) : null;
  return useInfiniteQuery({
    queryKey: [...useKey(), 'live-channels', group, pageSize, recent?.join()],
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      if (recent) {
        const ids = recent;
        const found = ids.length
          ? await client.get<BaseItemDtoQueryResult>(
              '/Items',
              { userId: user.Id, Ids: ids.join(',') },
              signal
            )
          : { Items: [] };
        const items = ids
          .map((id) => found.Items?.find((c) => c.Id === id))
          .filter((c): c is BaseItemDto => c?.Type === 'TvChannel');
        return { Items: items, TotalRecordCount: items.length };
      }
      return client.get<BaseItemDtoQueryResult>(
        '/LiveTv/Channels',
        {
          userId: user.Id,
          StartIndex: pageParam,
          Limit: pageSize,
          IsFavorite: group === FAVOURITES || undefined,
          GenreIds: group === FAVOURITES || group === ALL ? undefined : group,
          AddCurrentProgram: true,
          EnableTotalRecordCount: true,
        },
        signal
      );
    },
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

export const startOf = (p: BaseItemDto) => Date.parse(p.StartDate ?? '');
export const endOf = (p: BaseItemDto) => Date.parse(p.EndDate ?? '');

export function airedShare(p: BaseItemDto, now: number): number {
  const start = startOf(p);
  const length = endOf(p) - start;
  return length > 0 ? Math.min(1, Math.max(0, (now - start) / length)) : 0;
}

export const airingAt = (programmes: BaseItemDto[], at: number) =>
  programmes.find((p) => startOf(p) <= at && at < endOf(p));

const SCHEDULE_AHEAD_MS = 6 * 3_600_000;
/** Windows start on the half hour, so one asked for a little later is the same. */
const WINDOW_STEP_MS = 30 * 60_000;

/** Programmes from now, by channel; a batch two lists share is asked for once. */
export function useSchedules(
  batches: string[][],
  enabled = true
): Map<string, BaseItemDto[]> {
  const { client, user } = useSession();
  const key = useKey();
  const from = Math.floor(Date.now() / WINDOW_STEP_MS) * WINDOW_STEP_MS;
  return useQueries({
    queries: batches.map((ids) => ({
      queryKey: [...key, 'live-schedules', ids.join(), from],
      queryFn: () =>
        client.post<BaseItemDtoQueryResult>('/LiveTv/Programs', {
          UserId: user.Id,
          ChannelIds: ids,
          MinEndDate: new Date(from).toISOString(),
          MaxStartDate: new Date(from + SCHEDULE_AHEAD_MS).toISOString(),
          SortBy: ['StartDate'],
          Fields: ['Overview', 'Genres'],
        }),
      enabled: enabled && ids.length > 0,
      placeholderData: keepPreviousData,
      staleTime: 10 * 60_000,
    })),
    combine: mergeSchedules,
  });
}

function mergeSchedules(
  results: { data?: BaseItemDtoQueryResult }[]
): Map<string, BaseItemDto[]> {
  const byChannel = new Map<string, BaseItemDto[]>();
  for (const { data } of results)
    for (const p of data?.Items ?? []) {
      if (!p.ChannelId) continue;
      const list = byChannel.get(p.ChannelId) ?? [];
      list.push(p);
      byChannel.set(p.ChannelId, list);
    }
  return byChannel;
}

export function useNow(stepMs = 30_000): number {
  const [now, setNow] = React.useState(Date.now);
  React.useEffect(() => {
    let timer = 0;
    const tick = () => {
      setNow(Date.now());
      timer = window.setTimeout(tick, stepMs - (Date.now() % stepMs));
    };
    timer = window.setTimeout(tick, stepMs - (Date.now() % stepMs));
    return () => window.clearTimeout(timer);
  }, [stepMs]);
  return now;
}
