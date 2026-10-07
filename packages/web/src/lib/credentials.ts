import { storage } from './storage';

/*
 * The same key and shape jellyfin-web uses, which apps hosting a web client
 * read to sign their native player in.
 */
const KEY = 'jellyfin_credentials';
const SIGNED_OUT_KEY = 'aiostreams-web-signed-out';

interface StoredServer {
  Id: string;
  ManualAddress: string;
  AccessToken?: string;
  UserId?: string;
  DateLastAccessed: number;
  LastConnectionMode: number;
}

interface Stored {
  Servers: StoredServer[];
}

function read(): StoredServer[] {
  return storage.get<Stored>(KEY)?.Servers ?? [];
}

export function readCredentials(
  base: string
): { token: string; userId: string } | null {
  const server = read().find((s) => s.ManualAddress === base);
  return server?.AccessToken && server.UserId
    ? { token: server.AccessToken, userId: server.UserId }
    : null;
}

export function saveCredentials(
  base: string,
  entry: { serverId: string; token: string; userId: string }
): void {
  const others = read().filter((s) => s.ManualAddress !== base);
  storage.set(KEY, {
    Servers: [
      {
        Id: entry.serverId,
        ManualAddress: base,
        AccessToken: entry.token,
        UserId: entry.userId,
        DateLastAccessed: Date.now(),
        LastConnectionMode: 2,
      },
      ...others,
    ],
  } satisfies Stored);
  storage.remove(`${SIGNED_OUT_KEY}:${base}`);
}

/** Also stops a configuration sign-in from signing the app straight back in. */
export function clearCredentials(base: string): void {
  storage.set(KEY, {
    Servers: read().filter((s) => s.ManualAddress !== base),
  } satisfies Stored);
  storage.set(`${SIGNED_OUT_KEY}:${base}`, true);
}

export function signedOut(base: string): boolean {
  return storage.get<boolean>(`${SIGNED_OUT_KEY}:${base}`) === true;
}
