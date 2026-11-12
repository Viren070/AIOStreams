import { t } from '@lingui/core/macro';
import React from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQueries,
  useQuery,
} from '@tanstack/react-query';
import { useSession } from '@/lib/jellyfin/session';
import { useGenres, useKey, useLiveTvView } from '@/lib/jellyfin/queries';
import { storage, storedMap } from '@/lib/storage';
import type { BaseItemDto, BaseItemDtoQueryResult } from '@/lib/jellyfin/types';
import { createLive, useLive } from '@/lib/live-value';
import { lacksDetails } from '@/lib/format';

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

/** The channels the live page lists, which the player steps through. */
const lineup = createLive<BaseItemDto[]>([]);

export const setLineup = lineup.set;

export const useLineup = () => useLive(lineup);

/** A later programme to be told about as it starts. */
export interface Reminder {
  id: string;
  title: string;
  start: number;
  channelId: string;
  channelName: string;
}

/** Reminders on this device, by user. */
const reminders = storedMap<Reminder[]>('aiostreams-web-live-reminders', 20);
const remindersVersion = createLive(0);

export const remindersOf = (userId: string): Reminder[] =>
  reminders.get(userId) ?? [];

export function setReminders(userId: string, list: Reminder[]): void {
  reminders.set(userId, list.length ? list : undefined);
  remindersVersion.set(remindersVersion.get() + 1);
}

export function useReminders() {
  const { user } = useSession();
  const userId = user.Id!;
  const version = useLive(remindersVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- read again on each change
  const list = React.useMemo(() => remindersOf(userId), [userId, version]);
  return {
    list,
    has: (programmeId: string | undefined) =>
      !!programmeId && list.some((r) => r.id === programmeId),
    /** True when it now has one. */
    toggle(programme: BaseItemDto): boolean {
      const current = remindersOf(userId);
      if (current.some((r) => r.id === programme.Id)) {
        setReminders(
          userId,
          current.filter((r) => r.id !== programme.Id)
        );
        return false;
      }
      setReminders(userId, [
        ...current,
        {
          id: programme.Id!,
          title: programme.Name ?? '',
          start: startOf(programme),
          channelId: programme.ChannelId!,
          channelName: programme.ChannelName ?? '',
        },
      ]);
      return true;
    },
  };
}

/** The channel last moved to, played or zapped to, which the live page opens on again. */
let lastChannel: string | null = null;

export const lastChannelId = () => lastChannel;

export function rememberChannel(id: string | null | undefined): void {
  if (id) lastChannel = id;
}

const GROUP_KEY = 'aiostreams-web-live-group';

export const lastGroup = (): string => storage.get<string>(GROUP_KEY) ?? ALL;

export function rememberGroup(id: string): void {
  storage.set(GROUP_KEY, id);
}

export type LiveView = 'list' | 'guide';
const VIEW_KEY = 'aiostreams-web-live-view';

export const lastView = (): LiveView | null => storage.get<LiveView>(VIEW_KEY);

export function rememberView(view: LiveView): void {
  storage.set(VIEW_KEY, view);
}

export function useChannelGroups(): {
  groups: ChannelGroup[];
  isLoading: boolean;
} {
  const view = useLiveTvView();
  // Elsewhere the view's genres are its programmes', which channels aren't listed by.
  const grouped =
    (view.data as { aiostreams?: { groups?: boolean } } | null | undefined)
      ?.aiostreams?.groups === true;
  const genres = useGenres(grouped ? (view.data?.Id ?? '') : '');
  const favourites = useChannelPages(FAVOURITES, { pageSize: 1 });
  const hasFavourites = !!favourites.data?.pages[0]?.TotalRecordCount;
  const recent = useChannelPages(RECENT);
  const hasRecents = !!recent.data?.pages[0]?.Items?.length;
  const groups = React.useMemo(
    () => [
      ...(hasFavourites ? [{ id: FAVOURITES, name: t`Favourites` }] : []),
      ...(hasRecents ? [{ id: RECENT, name: t`Recent` }] : []),
      { id: ALL, name: t`All channels` },
      ...((grouped && genres.data?.Items) || []).map((g) => ({
        id: g.Id!,
        name: g.Name ?? '',
      })),
    ],
    [hasFavourites, hasRecents, genres.data]
  );
  return {
    groups,
    isLoading: view.isLoading || genres.isLoading || recent.isLoading,
  };
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
          .filter(
            (c): c is BaseItemDto => c?.Type === 'TvChannel' && !lacksDetails(c)
          );
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

/** Finds a channel by its number in the whole lineup, which a group shows only part of. */
export function useChannelByNumber() {
  const { client, user } = useSession();
  return React.useCallback(
    async (number: string) => {
      const found = await client.get<BaseItemDtoQueryResult>('/Items', {
        userId: user.Id,
        SearchTerm: number,
        Recursive: true,
        IncludeItemTypes: 'TvChannel',
        Limit: 1,
      });
      return found.Items?.find((c) => c.ChannelNumber === number);
    },
    [client, user.Id]
  );
}

/** Plays from its start, as its channel keeps it. */
export const caughtUp = (p: BaseItemDto | undefined) =>
  !!(p as { aiostreams?: { catchup?: boolean } } | undefined)?.aiostreams
    ?.catchup;

/** The days the server's guide covers, back as far as channels keep programmes. */
export function useGuideRange() {
  const { client } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'live-guide-range'],
    queryFn: async () => {
      const info = await client.get<{ StartDate?: string; EndDate?: string }>(
        '/LiveTv/GuideInfo'
      );
      return {
        from: Date.parse(info.StartDate ?? ''),
        to: Date.parse(info.EndDate ?? ''),
      };
    },
    staleTime: 60 * 60_000,
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

/**
 * Programmes by channel, from now unless a window is given; a batch two lists
 * share is asked for once.
 */
export function useSchedules(
  batches: string[][],
  opts: { from?: number; to?: number; enabled?: boolean } = {}
): Map<string, BaseItemDto[]> {
  const { client, user } = useSession();
  const key = useKey();
  const from =
    opts.from ?? Math.floor(Date.now() / WINDOW_STEP_MS) * WINDOW_STEP_MS;
  const to = opts.to ?? from + SCHEDULE_AHEAD_MS;
  return useQueries({
    queries: batches.map((ids) => ({
      queryKey: [...key, 'live-schedules', ids.join(), from, to],
      queryFn: () =>
        client.post<BaseItemDtoQueryResult>('/LiveTv/Programs', {
          UserId: user.Id,
          ChannelIds: ids,
          MinEndDate: new Date(from).toISOString(),
          MaxStartDate: new Date(to).toISOString(),
          SortBy: ['StartDate'],
          Fields: ['Overview', 'Genres'],
        }),
      enabled: (opts.enabled ?? true) && ids.length > 0,
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

export function useNow(stepMs = 30_000, enabled = true): number {
  const [now, setNow] = React.useState(Date.now);
  React.useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    let timer = 0;
    const tick = () => {
      setNow(Date.now());
      timer = window.setTimeout(tick, stepMs - (Date.now() % stepMs));
    };
    timer = window.setTimeout(tick, stepMs - (Date.now() % stepMs));
    return () => window.clearTimeout(timer);
  }, [stepMs, enabled]);
  return now;
}
