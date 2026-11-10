import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from './session';
import { useFeature } from './server-info';
import type { BaseItemDto, BaseItemDtoQueryResult } from './types';
import { useKey } from './queries';

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

/**
 * Only movies, shows and channels are listed as favourites; anything else
 * already one can still be taken off.
 */
export const offersFavourite = (type: BaseItemDto['Type'], favorite: boolean) =>
  favorite || type === 'Movie' || type === 'Series' || type === 'TvChannel';

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
