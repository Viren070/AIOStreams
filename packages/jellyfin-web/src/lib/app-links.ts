import { to } from './paths';

/**
 * What an `aiostreams://` link opens. A value in a link is encoded once where
 * the link is made and decoded once here, so a `+` in it stays a `+`.
 */
export type AppLink =
  | { kind: 'server'; address: string }
  | { kind: 'route'; path: string };

const LINK = /^aiostreams:\/\/([^/?#]+)(\/[^?#]*)?(?:\?([^#]*))?/i;

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

export function parseAppLink(raw: string): AppLink | null {
  const match = LINK.exec(raw.trim());
  if (!match) return null;
  const [, route, path = '', query = ''] = match;
  switch (route.toLowerCase()) {
    case 'server': {
      const address = param(query, 'url');
      return address && /^https?:\/\//i.test(address)
        ? { kind: 'server', address }
        : null;
    }
    case 'search':
      return { kind: 'route', path: to.search(param(query, 'q') ?? undefined) };
    // Handed on as it came; the item page decodes what the player added.
    case 'return':
      return path.startsWith('/item/')
        ? { kind: 'route', path: query ? `${path}?${query}` : path }
        : null;
    default:
      return null;
  }
}
