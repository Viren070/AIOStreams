import { parseInvite, type Invite } from './party/invite';
import { to } from './paths';
import { plainId, type RemoteCommand } from './remote/commands';

/**
 * What an `aiostreams://` link opens. A value in a link is encoded once where
 * the link is made and decoded once here, so a `+` in it stays a `+`.
 */
export type AppLink =
  | { kind: 'server'; address: string }
  | { kind: 'route'; path: string }
  | { kind: 'party'; invite: Invite }
  /** Item ids belong to one server, which `server` names. */
  | { kind: 'remote'; command: RemoteCommand; server?: string };

const LINK = /^aiostreams:\/\/([^/?#]+)(\/[^?#]*)?(?:\?([^#]*))?/i;

export const playLink = (server: string, itemId: string, startMs: number) =>
  `aiostreams://play/${itemId}?server=${encodeURIComponent(server)}${startMs > 0 ? `&start=${startMs}` : ''}`;

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function param(query: string, name: string): string | null {
  for (const pair of query.split('&')) {
    const at = pair.indexOf('=');
    if (at > 0 && decode(pair.slice(0, at)) === name)
      return decode(pair.slice(at + 1));
  }
  return null;
}

const isAddress = (value: string | null): value is string =>
  !!value && /^https?:\/\//i.test(value);

export function parseAppLink(raw: string): AppLink | null {
  const match = LINK.exec(raw.trim());
  if (!match) return null;
  const [, route, path = '', query = ''] = match;
  const id = plainId(/^\/([^/]+)\/?$/.exec(path)?.[1]);
  const remote = (command: RemoteCommand): AppLink | null => {
    const server = param(query, 'server');
    if (server && !isAddress(server)) return null;
    return { kind: 'remote', command, server: server ?? undefined };
  };
  switch (route.toLowerCase()) {
    case 'server': {
      const address = param(query, 'url');
      return isAddress(address) ? { kind: 'server', address } : null;
    }
    case 'item': {
      if (!id) return null;
      // Also a show with its season and episode, where the episode wins.
      const episode = plainId(param(query, 'episode'));
      const season = plainId(param(query, 'season')) ?? undefined;
      return remote(
        episode
          ? { kind: 'show', itemId: episode }
          : { kind: 'show', itemId: id, seasonId: season }
      );
    }
    case 'play': {
      if (!id) return null;
      const start = Number(param(query, 'start'));
      return remote({
        kind: 'play',
        itemId: id,
        startMs: start > 0 ? start : 0,
        sourceId: plainId(param(query, 'version')) ?? undefined,
      });
    }
    case 'search':
      return { kind: 'route', path: to.search(param(query, 'q') ?? undefined) };
    case 'party': {
      const invite = parseInvite(raw);
      return invite ? { kind: 'party', invite } : null;
    }
    // Handed on as it came; the item page decodes what the player added.
    case 'return':
      return path.startsWith('/item/')
        ? { kind: 'route', path: query ? `${path}?${query}` : path }
        : null;
    default:
      return null;
  }
}
