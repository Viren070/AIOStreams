import { useQueries } from '@tanstack/react-query';
import { JellyfinClient, JellyfinError } from '@/lib/jellyfin/client';
import { readCredentials } from '@/lib/jellyfin/credentials';
import { savedServers, type SavedServer } from '@/lib/jellyfin/servers';
import { usePickableUsers } from '@/lib/jellyfin/history';
import { stayingUser, useSession } from '@/lib/jellyfin/session';
import { storage } from '@/lib/storage';
import type { PickableUser, UserDto } from '@/lib/jellyfin/types';

export interface ServerProfile extends PickableUser {
  server: SavedServer;
}

export type PickerServer =
  | { server: SavedServer; state: 'ready'; users: ServerProfile[] }
  | { server: SavedServer; state: 'signed-out' | 'unreachable' };

const cacheKey = (base: string) => `aiostreams-web-picker:${base}`;

async function listProfiles(server: SavedServer): Promise<PickerServer> {
  const stored = readCredentials(server.base);
  if (!stored) return { server, state: 'signed-out' };
  const client = new JellyfinClient(server.base, stored.token);
  const ready = (users: PickableUser[]): PickerServer => {
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

export function pickerServers(current: string): SavedServer[] {
  const saved = savedServers();
  if (saved.find((s) => s.base === current)?.onPicker === false) return [];
  return saved.filter((s) => s.base !== current && s.onPicker !== false);
}

/** This server, then the others sharing its picker, each once it has answered. */
export function usePickerProfiles(current: string): PickerServer[] {
  const here = savedServers().filter((s) => s.base === current);
  const servers = [...here, ...pickerServers(current)];
  const stay = stayingUser(current);
  const results = useQueries({
    queries: servers.map((server) => ({
      queryKey: ['picker-profiles', server.base],
      queryFn: () => listProfiles(server),
      staleTime: 60_000,
    })),
  });
  return results.flatMap(({ data }) => {
    if (!data) return [];
    if (data.state !== 'ready' || data.server.base !== current) return [data];
    return [
      {
        ...data,
        users: data.users.map((u) =>
          u.user.Id === stay ? { ...u, needs: null } : u
        ),
      },
    ];
  });
}

export function useCanSwitch(): boolean {
  const { client } = useSession();
  const users = usePickableUsers();
  return (
    (users.data?.length ?? 0) > 1 ||
    (__STANDALONE__ && pickerServers(client.base).length > 0)
  );
}
