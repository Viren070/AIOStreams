import { useQueries } from '@tanstack/react-query';
import { JellyfinClient, JellyfinError } from '@/lib/jellyfin/client';
import { readCredentials } from '@/lib/jellyfin/credentials';
import { savedServers, type SavedServer } from '@/lib/jellyfin/servers';
import { usePickableUsers } from '@/lib/jellyfin/history';
import { useSession } from '@/lib/jellyfin/session';
import { storage } from '@/lib/storage';
import type { PickableUser, UserDto } from '@/lib/jellyfin/types';

export interface ServerProfile extends PickableUser {
  server: SavedServer;
}

export type OtherServer =
  | { server: SavedServer; state: 'ready'; users: ServerProfile[] }
  | { server: SavedServer; state: 'signed-out' | 'unreachable' };

const cacheKey = (base: string) => `aiostreams-web-picker:${base}`;

async function listProfiles(server: SavedServer): Promise<OtherServer> {
  const stored = readCredentials(server.base);
  if (!stored) return { server, state: 'signed-out' };
  const client = new JellyfinClient(server.base, stored.token);
  const ready = (users: PickableUser[]): OtherServer => {
    storage.set(cacheKey(server.base), users);
    return {
      server,
      state: 'ready',
      users: users.map((u) => ({ ...u, server })),
    };
  };
  try {
    return ready(await client.get<PickableUser[]>('/AIOStreams/Users'));
  } catch (error) {
    if (!(error instanceof JellyfinError)) {
      const cached = storage.get<PickableUser[]>(cacheKey(server.base));
      return cached ? ready(cached) : { server, state: 'unreachable' };
    }
    if (error.status === 401) return { server, state: 'signed-out' };
  }
  // A server without other users lists the one signed in.
  try {
    const me = await client.get<UserDto>('/Users/Me');
    return ready([{ user: me, avatar: null, needs: null }]);
  } catch (error) {
    return error instanceof JellyfinError && error.status === 401
      ? { server, state: 'signed-out' }
      : { server, state: 'unreachable' };
  }
}

function pickerServers(current: string): SavedServer[] {
  return savedServers().filter(
    (s) => s.base !== current && s.onPicker !== false
  );
}

export function useOtherServers(current: string): OtherServer[] {
  const servers = __STANDALONE__ ? pickerServers(current) : [];
  const results = useQueries({
    queries: servers.map((server) => ({
      queryKey: ['picker-profiles', server.base],
      queryFn: () => listProfiles(server),
      staleTime: 60_000,
    })),
  });
  return results.flatMap((r) => (r.data ? [r.data] : []));
}

export function useCanSwitch(): boolean {
  const { client } = useSession();
  const users = usePickableUsers();
  return (
    (users.data?.length ?? 0) > 1 ||
    (__STANDALONE__ && pickerServers(client.base).length > 0)
  );
}
