import { t } from '@lingui/core/macro';
import React from 'react';
import { toast } from 'sonner';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import type { JellyfinClient } from '../client';
import { currentHost } from '../hosts';
import { goBack, navigate, to } from '../paths';
import { playableSources } from '../playback/play';
import { chosenPlayer } from '../playback/player-choice';
import { requestItem, usePlaybackInfoOptions } from '../queries';
import { useSession } from '../session';
import type { BaseItemDto, BaseItemDtoQueryResult, SourceInfo } from '../types';
import { matchingVersion, partyItemTitle, type PartyItem } from './items';
import {
  party,
  playingEntry,
  positionAt,
  useParty,
  type PartyEntry,
} from './party';

/*
 * Each member's own server finds the party's title and plays the member's own
 * version of it. Opening it is automatic; leaving the player opts out of that
 * item, which "back to the party" undoes.
 */

interface Binding {
  playlistItemId: string;
  itemId: string;
  source: SourceInfo;
}

const followed = {
  binding: null as Binding | null,
  /** Items the member left the player for. */
  away: new Set<string>(),
};
const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version++;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Whether this device's player can follow a party; another app's can't. */
export function canFollow(): boolean {
  return !currentHost().play && chosenPlayer().kind !== 'link';
}

const sameName = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;

/** The title on this member's server: by its id, else by its name. */
async function findItem(
  client: JellyfinClient,
  userId: string,
  item: PartyItem
): Promise<BaseItemDto | null> {
  for (const id of [item.id, item.sharedId]) {
    const found =
      id && (await requestItem(client, userId, id).catch(() => null));
    if (found) return found;
  }
  const episode = item.type === 'Episode';
  const name = episode ? item.seriesName : item.name;
  if (!name) return null;
  const { Items = [] } = await client.get<BaseItemDtoQueryResult>('/Items', {
    userId,
    SearchTerm: name,
    Recursive: true,
    IncludeItemTypes: episode ? 'Series' : 'Movie',
    Limit: 10,
  });
  const found = Items.find(
    (i) =>
      sameName(i.Name, name) &&
      (episode ||
        !item.year ||
        !i.ProductionYear ||
        i.ProductionYear === item.year)
  );
  if (!found || !episode) return found ?? null;
  const { Items: episodes = [] } = await client.get<BaseItemDtoQueryResult>(
    `/Shows/${found.Id}/Episodes`,
    { userId }
  );
  return (
    episodes.find(
      (e) =>
        e.ParentIndexNumber === item.season && e.IndexNumber === item.episode
    ) ?? null
  );
}

function sitOut(entry: PartyEntry, message: string): void {
  followed.away.add(entry.playlistItemId);
  party.request({ type: 'IgnoreWait', ignoreWait: true });
  toast.error(message);
  changed();
}

const onPlayer = () => /^#\/play\//.test(window.location.hash);

/** The player page open now, if it plays this version. */
function playingNow(itemId: string, sourceId: string): boolean {
  const match = /^#\/play\/([^/?]+)\?(.*)$/.exec(window.location.hash);
  return (
    !!match &&
    match[1] === itemId &&
    new URLSearchParams(match[2]).get('source') === sourceId
  );
}

/**
 * Opens what the party plays, and closes it when the party stops. Once, in the
 * layout; `onOpen` hears when it takes this device to the player.
 */
export function usePartyFollow(onOpen: () => void): void {
  const state = useParty();
  const { client, user } = useSession();
  const queryClient = useQueryClient();
  const infoOptions = usePlaybackInfoOptions();
  const opening = React.useRef<string | null>(null);
  const entry = state?.status === 'live' ? playingEntry(state) : null;
  const entryId = entry?.playlistItemId ?? null;
  const awayVersion = React.useSyncExternalStore(subscribe, () => version);

  React.useEffect(() => {
    const binding = followed.binding;
    if (!entry) {
      if (binding && state?.status !== 'reconnecting') {
        followed.binding = null;
        changed();
        if (onPlayer()) goBack(to.item(binding.itemId));
      }
      return;
    }
    if (binding?.playlistItemId === entry.playlistItemId) return;
    if (followed.away.has(entry.playlistItemId)) return;
    if (opening.current === entry.playlistItemId) return;
    if (!canFollow())
      return sitOut(
        entry,
        t`Your player can't follow a watch party. Pick the app's player in settings to watch along.`
      );
    if (!entry.item)
      return sitOut(
        entry,
        t`This device couldn't read what the party is playing.`
      );
    const item = entry.item;
    const title = partyItemTitle(item);
    opening.current = entry.playlistItemId;
    const previous = binding?.source;
    void (async () => {
      try {
        const local = await findItem(client, user.Id!, item);
        if (!local) return sitOut(entry, t`${title} isn't on your server.`);
        const info = await queryClient.fetchQuery(infoOptions(local.Id!));
        const source = matchingVersion(
          playableSources(info),
          item.version,
          (sources) =>
            sources.find(
              (s) =>
                !!previous?.aiostreams?.bingeGroup &&
                s.aiostreams?.bingeGroup === previous.aiostreams.bingeGroup
            )
        );
        if (!source?.Id)
          return sitOut(entry, t`No version of ${title} plays here.`);
        const now = party.state();
        if (
          now?.queue[now.playingIndex]?.playlistItemId !== entry.playlistItemId
        )
          return;
        const clock = party.clock();
        const timeline = now.timeline;
        const startMs = timeline
          ? positionAt(timeline, clock ? clock.now() : Date.now())
          : 0;
        followed.binding = {
          playlistItemId: entry.playlistItemId,
          itemId: local.Id!,
          source,
        };
        changed();
        // A party started from the player takes over what it already plays.
        if (!playingNow(local.Id!, source.Id)) {
          navigate(to.play(local.Id!, source.Id, startMs), {
            replace: onPlayer(),
          });
          onOpen();
        }
      } catch {
        sitOut(entry, t`Couldn't open ${title}.`);
      } finally {
        if (opening.current === entry.playlistItemId) opening.current = null;
      }
    })();
    // The entry is identified by its id; the rest is read when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, state?.status, awayVersion]);

  React.useEffect(() => {
    if (state) return;
    followed.binding = null;
    followed.away.clear();
    changed();
  }, [state]);
}

/** The party item this player page plays, while the party plays it. */
export function usePartyBinding(itemId: string): string | null {
  const state = useParty();
  React.useSyncExternalStore(subscribe, () => version);
  const binding = followed.binding;
  if (!state || !binding || binding.itemId !== itemId) return null;
  const entry = state.queue[state.playingIndex];
  return entry?.playlistItemId === binding.playlistItemId
    ? binding.playlistItemId
    : null;
}

/** Leaves the party's playback, staying in the party. */
export function leavePartyPlayback(): void {
  const binding = followed.binding;
  if (!binding) return;
  followed.away.add(binding.playlistItemId);
  followed.binding = null;
  party.request({ type: 'IgnoreWait', ignoreWait: true });
  changed();
}

/** Whether the member sat out what the party plays now. */
export function usePartyAway(): boolean {
  const state = useParty();
  React.useSyncExternalStore(subscribe, () => version);
  const entry = playingEntry(state);
  return !!entry && followed.away.has(entry.playlistItemId);
}

export function rejoinPartyPlayback(): void {
  const state = party.state();
  const entry = state?.queue[state.playingIndex];
  if (!entry || !followed.away.delete(entry.playlistItemId)) return;
  changed();
}

export interface PartyNeighbours {
  next: BaseItemDto | null;
  previous: BaseItemDto | null;
}

/**
 * The party's titles either side of the one this player plays, as this
 * member's server has them; undefined while they're looked up.
 */
export function usePartyNeighbours(
  playlistItemId: string | null
): PartyNeighbours | undefined {
  const state = useParty();
  const { client, user } = useSession();
  const at =
    state && playlistItemId
      ? state.queue.findIndex((e) => e.playlistItemId === playlistItemId)
      : -1;
  const entries = at < 0 ? [] : [state!.queue[at - 1], state!.queue[at + 1]];
  const [previous, next] = useQueries({
    queries: [0, 1].map((i) => {
      const entry = entries[i];
      return {
        queryKey: [
          'jf',
          client.base,
          user.Id,
          'party-entry',
          entry?.playlistItemId ?? null,
        ],
        queryFn: () =>
          entry?.item ? findItem(client, user.Id!, entry.item) : null,
        enabled: !!entry,
        staleTime: Infinity,
      };
    }),
  });
  const looking = entries.some((e, i) => e && [previous, next][i].isPending);
  const found = at >= 0 && !looking;
  return React.useMemo(
    () =>
      found
        ? { previous: previous.data ?? null, next: next.data ?? null }
        : undefined,
    [found, previous.data, next.data]
  );
}
