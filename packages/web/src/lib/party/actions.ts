import { t } from '@lingui/core/macro';
import React from 'react';
import { useEpisodesAfter } from '../queries';
import { useServerInfo } from '../server-info';
import { useSession } from '../session';
import type { BaseItemDto, SourceInfo } from '../types';
import { relayBase, type Invite } from './invite';
import { partyItem } from './items';
import { party, type PartyIdentity } from './party';

/** Episodes queued after the one a party starts, so it plays on by itself. */
const QUEUED_EPISODES = 10;

const DEFAULT_RELAY = 'https://aiostreams.viren070.me';

export function usePartyIdentity(): PartyIdentity {
  const { client, user } = useSession();
  return React.useMemo(
    () => ({
      name: user.Name || t`Someone`,
      server: relayBase(client.base) ?? client.base,
      userId: user.Id!,
      token: client.token ?? undefined,
    }),
    [client, user]
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

/** Starts the item for everyone in the party. */
export function usePlayForParty() {
  const episodesAfter = useEpisodesAfter();
  return React.useCallback(
    async (item: BaseItemDto, source: SourceInfo | null, startMs = 0) => {
      const following = await episodesAfter(item).catch(() => []);
      const items = [
        partyItem(item, source),
        ...following.slice(0, QUEUED_EPISODES).map((e) => partyItem(e)),
      ]
        .map((i) => party.entry(i))
        .filter((e): e is NonNullable<typeof e> => !!e);
      if (items.length)
        party.request({ type: 'Play', items, index: 0, startMs });
    },
    [episodesAfter]
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
