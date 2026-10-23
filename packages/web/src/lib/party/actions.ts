import { t } from '@lingui/core/macro';
import React from 'react';
import { useOwnAvatar } from '../queries';
import { useFollowing } from '../playlists';
import { useLatest } from '../use-latest';
import { useServerInfo } from '../server-info';
import { useSession } from '../session';
import type { BaseItemDto, SourceInfo } from '../types';
import { relayBase, type Invite } from './invite';
import { partyItem } from './items';
import { party, type PartyIdentity } from './party';

/** What's queued after the title a party starts: relays take 20 titles. */
const QUEUED_AFTER = 19;

const DEFAULT_RELAY = 'https://aiostreams.viren070.me';

export function usePartyIdentity(): PartyIdentity {
  const { client, user } = useSession();
  const avatar = useOwnAvatar();
  return React.useMemo(
    () => ({
      name: user.Name || t`Someone`,
      avatar,
      server: relayBase(client.base) ?? client.base,
      userId: user.Id!,
      token: client.token ?? undefined,
    }),
    [client, user, avatar]
  );
}

export interface RelayChoice {
  base: string;
  /** Lets in people from other servers. */
  open: boolean;
  own: boolean;
}

/** The relays a party can start on: this server's, then the one it suggests. */
export function usePartyRelays(): RelayChoice[] {
  const info = useServerInfo();
  const { client } = useSession();
  return React.useMemo(() => {
    const own = relayBase(client.base);
    const relays: RelayChoice[] = [];
    if (info.features.parties && own)
      relays.push({
        base: own,
        open: info.parties?.relay !== 'off',
        own: true,
      });
    // A server with no party info gets the public relay; one that sends none means none.
    const fallback = info.parties ? info.parties.defaultRelay : DEFAULT_RELAY;
    const suggested = fallback ? relayBase(fallback) : null;
    if (suggested && suggested !== own)
      relays.push({ base: suggested, open: true, own: false });
    return relays;
  }, [info, client.base]);
}

/** Starts the item for everyone in the party, with what follows it here. */
export function usePlayForParty() {
  const following = useLatest(useFollowing());
  return React.useCallback(
    async (
      item: BaseItemDto,
      source: SourceInfo | null,
      startMs = 0,
      playlist?: string
    ) => {
      const after = await following.current(item, playlist).catch(() => []);
      const items = [
        partyItem(item, source),
        ...after.slice(0, QUEUED_AFTER).map((e) => partyItem(e)),
      ]
        .map((i) => party.entry(i))
        .filter((e): e is NonNullable<typeof e> => !!e);
      if (items.length)
        party.request({ type: 'Play', items, index: 0, startMs });
    },
    [following]
  );
}

export function usePartyActions() {
  const identity = usePartyIdentity();
  const playForParty = usePlayForParty();
  return React.useMemo(
    () => ({
      start: async (
        relay: string,
        play?: {
          item: BaseItemDto;
          source: SourceInfo | null;
          startMs?: number;
        }
      ) => {
        await party.start(relay, identity);
        if (play) await playForParty(play.item, play.source, play.startMs);
      },
      join: (invite: Invite) => party.join(invite, identity),
      peek: (invite: Invite) => party.peek(invite, identity),
    }),
    [identity, playForParty]
  );
}

/** Hands on an invite the app was opened with. Once, in the layout. */
export function useHeldInvites(onInvite: (invite: Invite) => void): void {
  const latest = React.useRef(onInvite);
  latest.current = onInvite;
  React.useEffect(() => {
    const take = () => {
      const invite = party.takeHeld();
      if (invite) latest.current(invite);
    };
    take();
    return party.subscribe(take);
  }, []);
}
