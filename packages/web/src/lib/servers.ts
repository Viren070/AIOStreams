import { storage } from './storage';
import { JellyfinClient } from './client';
import { clearCredentials, readCredentials } from './credentials';
import type { UserDto } from './types';

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

/** Null when nothing answers in time, or the answer is not JSON. */
async function quickGet<T>(
  url: string,
  headers?: Record<string, string>
): Promise<{ status: number; body: T | null } | null> {
  // Older engines lack AbortSignal.timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    return {
      status: res.status,
      body: res.ok ? ((await res.json()) as T) : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type Label = Pick<SavedServer, 'name' | 'logo'>;

function labelOf(info: PublicInfo, base: string): Label {
  return {
    name: info.ServerName || new URL(base).host,
    logo: info.aiostreams?.logo ?? null,
  };
}

async function publicInfo(base: string): Promise<PublicInfo | null> {
  return (
    (await quickGet<PublicInfo>(`${base}/System/Info/Public`))?.body ?? null
  );
}

export type ServerStatus =
  | { kind: 'signed-in'; user: UserDto }
  | { kind: 'signed-out' }
  | { kind: 'unreachable' };

export interface ServerCheck {
  status: ServerStatus;
  /** Its name and logo now, saved over the old ones; null when it did not answer. */
  label: Label | null;
}

/** Who this device is signed in as there, if the server answers. */
export async function checkServer(base: string): Promise<ServerCheck> {
  const stored = readCredentials(base);
  const client = new JellyfinClient(base, stored?.token ?? null);
  // Some servers only name the configuration to a signed-in request.
  const headers = stored ? { Authorization: client.authorization } : undefined;
  const [info, me] = await Promise.all([
    quickGet<PublicInfo>(client.url('/System/Info/Public'), headers),
    stored ? quickGet<UserDto>(client.url('/Users/Me'), headers) : null,
  ]);
  const label = info?.body ? labelOf(info.body, base) : null;
  if (label) {
    storage.set(
      SERVERS_KEY,
      (storage.get<SavedServer[]>(SERVERS_KEY) ?? []).map((s) =>
        s.base === base ? { ...s, ...label } : s
      )
    );
  }
  let status: ServerStatus;
  if (me?.body) status = { kind: 'signed-in', user: me.body };
  // As the session reads it: only a rejected token means signed out.
  else if (stored)
    status = { kind: me?.status === 401 ? 'signed-out' : 'unreachable' };
  else status = { kind: label ? 'signed-out' : 'unreachable' };
  return { status, label };
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
    if (info?.Id) return { base, ...labelOf(info, base), lastUsed: Date.now() };
  }
  throw new Error('No server answered at that address.');
}
