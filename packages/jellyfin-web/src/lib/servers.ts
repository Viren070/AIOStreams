import { storage } from './storage';
import { clearCredentials } from './credentials';

/** A server the standalone build has connected to; `base` is its API base. */
export interface SavedServer {
  base: string;
  name: string;
  logo: string | null;
  lastUsed: number;
}

const SERVERS_KEY = 'aiostreams-web-servers';
const CURRENT_KEY = 'aiostreams-web-server';

export function savedServers(): SavedServer[] {
  return [...(storage.get<SavedServer[]>(SERVERS_KEY) ?? [])].sort(
    (a, b) => b.lastUsed - a.lastUsed
  );
}

export function currentServer(): string | null {
  const base = storage.get<string>(CURRENT_KEY);
  return base && savedServers().some((s) => s.base === base) ? base : null;
}

export function enterServer(server: SavedServer): void {
  storage.set(SERVERS_KEY, [
    { ...server, lastUsed: Date.now() },
    ...savedServers().filter((s) => s.base !== server.base),
  ]);
  storage.set(CURRENT_KEY, server.base);
}

export function leaveServer(): void {
  storage.remove(CURRENT_KEY);
}

export function forgetServer(base: string): void {
  storage.set(
    SERVERS_KEY,
    savedServers().filter((s) => s.base !== base)
  );
  clearCredentials(base);
}

export function serverAddress(base: string): string {
  return base.replace(/^https?:\/\//, '');
}

interface PublicInfo {
  Id?: string;
  ServerName?: string;
  aiostreams?: { logo?: string | null };
}

async function publicInfo(base: string): Promise<PublicInfo | null> {
  try {
    const res = await fetch(`${base}/System/Info/Public`, {
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? ((await res.json()) as PublicInfo) : null;
  } catch {
    return null;
  }
}

/**
 * Takes a bare host, a Jellyfin base or the address the web app is opened at.
 * A bare host may be AIOStreams, whose API lives under `/jellyfin`.
 */
export async function findServer(input: string): Promise<SavedServer> {
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    throw new Error('That is not a valid address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The address must start with http:// or https://.');
  }
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/web(\/index\.html)?$/i, '');
  for (const candidate of path ? [path] : ['/jellyfin', '']) {
    const base = url.origin + candidate;
    const info = await publicInfo(base);
    if (info?.Id) {
      return {
        base,
        name: info.ServerName || url.host,
        logo: info.aiostreams?.logo ?? null,
        lastUsed: Date.now(),
      };
    }
  }
  throw new Error('No server answered at that address.');
}
