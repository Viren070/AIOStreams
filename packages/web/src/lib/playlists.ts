import React from 'react';
import {
  queryOptions,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { JellyfinError } from './client';
import { useSession } from './session';
import { useServerInfo } from './server-info';
import { storage } from './storage';
import { useAdjacentEpisodes, useEpisodesAfter } from './queries';
import type { BaseItemDto, BaseItemDtoQueryResult } from './types';

/** Stock Jellyfin has playlists; a server with extensions has them with the feature. */
export function usePlaylistsOffered(): boolean {
  const info = useServerInfo();
  return !!info.features.playlists || info.stock;
}

/** Jellyfin cannot play a virtual item, such as an episode not yet aired. */
export const playable = (item: BaseItemDto) =>
  (item.Type === 'Movie' || item.Type === 'Episode') &&
  item.LocationType !== 'Virtual';

const sameId = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.replace(/-/g, '') === b.replace(/-/g, '');

function usePlaylistOptions() {
  const { client, user } = useSession();
  return React.useMemo(() => {
    const all = ['jf', client.base, user.Id, 'playlists'] as const;
    return {
      all,
      list: () =>
        queryOptions({
          queryKey: all,
          meta: { cache: 'titles' },
          queryFn: () =>
            client
              .get<BaseItemDtoQueryResult>('/Items', {
                userId: user.Id,
                IncludeItemTypes: 'Playlist',
                Recursive: true,
                SortBy: 'SortName',
                Fields: 'ChildCount',
              })
              .then((res) => res.Items ?? []),
        }),
      entries: (playlist: string) =>
        queryOptions({
          queryKey: [...all, playlist],
          meta: { cache: 'titles' },
          queryFn: () =>
            client
              .get<BaseItemDtoQueryResult>(`/Playlists/${playlist}/Items`, {
                userId: user.Id,
              })
              .then((res) => res.Items ?? []),
        }),
    };
  }, [client, user.Id]);
}

export function usePlaylists(enabled = true) {
  return useQuery({ ...usePlaylistOptions().list(), enabled });
}

export function usePlaylistEntries(playlist: string | undefined) {
  return useQuery({
    ...usePlaylistOptions().entries(playlist ?? ''),
    enabled: !!playlist,
  });
}

export function usePlaylistName(playlist: string | undefined): string | null {
  const list = usePlaylists(!!playlist).data;
  return list?.find((p) => sameId(p.Id, playlist))?.Name ?? null;
}

/** The playlist last added to, which the add dialog lists first. */
export const lastPlaylist = {
  key: (userId: string) => `aiostreams-web-last-playlist:${userId}`,
  get: (userId: string) => storage.get<string>(lastPlaylist.key(userId)),
  set: (userId: string, id: string) =>
    storage.set(lastPlaylist.key(userId), id),
};

/** One playlist's edits go out one after another, and its list is fetched once they're all in. */
const editing = new Map<string, Promise<unknown>>();

function inTurn(
  queryClient: QueryClient,
  key: readonly unknown[],
  playlist: string,
  request: () => Promise<unknown>
): Promise<unknown> {
  const before = editing.get(playlist) ?? Promise.resolve();
  const mine = before.catch(() => {}).then(request);
  editing.set(playlist, mine);
  return mine.finally(() => {
    if (editing.get(playlist) !== mine) return;
    editing.delete(playlist);
    void queryClient.invalidateQueries({ queryKey: key });
  });
}

/** Edits shown at once, and undone by the fetch that follows a failed one. */
export function usePlaylistEdits() {
  const { client, user } = useSession();
  const queryClient = useQueryClient();
  const { all, entries } = usePlaylistOptions();
  return React.useMemo(() => {
    const change = async (
      playlist: string,
      edit: (list: BaseItemDto[]) => BaseItemDto[]
    ) => {
      const { queryKey } = entries(playlist);
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<BaseItemDto[]>(queryKey, (list) =>
        list ? edit(list) : list
      );
    };
    const send = (playlist: string, request: () => Promise<unknown>) =>
      inTurn(queryClient, all, playlist, request);
    return {
      create: async (name: string, ids: string[]) => {
        const { Id } = await client.post<{ Id: string }>('/Playlists', {
          Name: name,
          Ids: ids,
          UserId: user.Id,
          MediaType: 'Video',
        });
        lastPlaylist.set(user.Id!, Id);
        void queryClient.invalidateQueries({ queryKey: all });
        return Id;
      },
      /** Adds what isn't there yet, after `after` or at the end; false when all of it was. */
      add: (playlist: string, ids: string[], after?: string) =>
        send(playlist, async () => {
          // Jellyfin keeps a title twice if it's added again.
          const { ItemIds = [] } = await client.get<{ ItemIds?: string[] }>(
            `/Playlists/${playlist}`
          );
          const fresh = ids.filter((id) => !ItemIds.some((i) => sameId(i, id)));
          if (!fresh.length) return false;
          const at = after ? ItemIds.findIndex((id) => sameId(id, after)) : -1;
          lastPlaylist.set(user.Id!, playlist);
          await client.post(`/Playlists/${playlist}/Items`, undefined, {
            ids: fresh,
            userId: user.Id,
            position: at >= 0 ? at + 1 : undefined,
          });
          return true;
        }).then(Boolean),
      remove: async (playlist: string, entry: BaseItemDto) => {
        await change(playlist, (list) =>
          list.filter((e) => e.PlaylistItemId !== entry.PlaylistItemId)
        );
        return send(playlist, () =>
          client.delete(`/Playlists/${playlist}/Items`, {
            entryIds: entry.PlaylistItemId!,
          })
        );
      },
      move: async (playlist: string, entry: BaseItemDto, index: number) => {
        await change(playlist, (list) => {
          const rest = list.filter(
            (e) => e.PlaylistItemId !== entry.PlaylistItemId
          );
          rest.splice(index, 0, entry);
          return rest;
        });
        return send(playlist, () =>
          client.post(
            `/Playlists/${playlist}/Items/${entry.PlaylistItemId}/Move/${index}`
          )
        );
      },
      rename: (playlist: string, name: string) => {
        queryClient.setQueryData<BaseItemDto[]>(all, (list) =>
          list?.map((p) => (sameId(p.Id, playlist) ? { ...p, Name: name } : p))
        );
        return send(playlist, () =>
          client.post(`/Playlists/${playlist}`, { Name: name })
        );
      },
      delete: async (playlist: string) => {
        await client.delete(`/Items/${playlist}`);
        queryClient.removeQueries({ queryKey: entries(playlist).queryKey });
        void queryClient.invalidateQueries({ queryKey: all });
      },
    };
  }, [client, user.Id, queryClient, all, entries]);
}

/**
 * What plays after an item: the rest of the playlist it plays from, else
 * its show's next episodes.
 */
export function useFollowing() {
  const queryClient = useQueryClient();
  const { entries } = usePlaylistOptions();
  const episodesAfter = useEpisodesAfter();
  return async (
    item: BaseItemDto,
    playlist?: string
  ): Promise<BaseItemDto[]> => {
    if (!playlist) return episodesAfter(item);
    const list = await queryClient.fetchQuery(entries(playlist));
    const at = list.findIndex((e) => sameId(e.Id, item.Id));
    return at < 0 ? [] : list.slice(at + 1).filter(playable);
  };
}

export interface UpNext {
  next: BaseItemDto | null;
  previous: BaseItemDto | null;
  /** The playlist they come from, when the item plays from one it is in. */
  playlist?: string;
  /** From a party's queue rather than a playlist here. */
  listed?: boolean;
}

/**
 * The titles either side of the one playing: its playlist's, once that has
 * loaded and while it holds it, else its show's episodes.
 */
export function useUpNext(item: BaseItemDto, playlist?: string): UpNext {
  const entries = usePlaylistEntries(playlist);
  // A deleted playlist leaves the title as if it was never in one.
  const gone =
    entries.error instanceof JellyfinError && entries.error.status === 404;
  const listed = gone ? undefined : entries.data;
  const found = listed?.findIndex((e) => sameId(e.Id, item.Id)) ?? -1;
  // Taken out while it plays, a title still leads on to what followed it.
  const key = `${playlist}:${item.Id}`;
  const [seen, setSeen] = React.useState<{ key: string; at: number }>();
  if (found >= 0 && (seen?.key !== key || seen.at !== found))
    setSeen({ key, at: found });
  const at = found >= 0 ? found : seen?.key === key ? seen.at : -1;
  const inPlaylist = !!listed && at >= 0;
  const episodes = useAdjacentEpisodes(
    item,
    !playlist || gone || (!!listed && !inPlaylist)
  ).data;
  if (playlist && !listed && !gone) return { next: null, previous: null };
  if (inPlaylist)
    return {
      next: listed!.slice(found >= 0 ? at + 1 : at).find(playable) ?? null,
      previous: listed!.slice(0, at).reverse().find(playable) ?? null,
      playlist,
    };
  return {
    next: episodes?.next ?? null,
    previous: episodes?.previous ?? null,
  };
}
