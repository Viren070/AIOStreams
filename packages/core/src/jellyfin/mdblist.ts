import { makeRequest } from '../utils/http.js';

/** A public MDBList list, as `mdblist.com/lists/<user>/<slug>` names it. */
export interface MdbListRef {
  user: string;
  slug: string;
}

/** A title from a list: its IMDb id and whether it plays as a film or a show. */
export interface MdbListTitle {
  type: 'movie' | 'series';
  id: string;
}

const HOSTS = new Set(['mdblist.com', 'www.mdblist.com']);
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const IMDB = /^tt\d+$/;
const TIMEOUT_MS = 15_000;

/**
 * The list a pasted link names, or null for anything else. Only mdblist.com
 * is read, so a link can never make the server fetch another address.
 */
export function parseMdbListUrl(input: string): MdbListRef | null {
  const text = input.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;
  if (url.port || url.username || url.password) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[parts.length - 1] === 'json') parts.pop();
  if (parts.length !== 3 || parts[0] !== 'lists') return null;
  const [, user, slug] = parts.map(decodeURIComponent);
  if (!NAME.test(user) || !NAME.test(slug)) return null;
  return { user, slug };
}

/** MDBList serves every public list as JSON, without an API key. */
export function mdbListJsonUrl(list: MdbListRef): string {
  return `https://mdblist.com/lists/${encodeURIComponent(list.user)}/${encodeURIComponent(list.slug)}/json`;
}

/** A playlist name from the list's slug: `christmas-movies` → `Christmas movies`. */
export function mdbListName(list: MdbListRef): string {
  const words = list.slug.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The titles of a list's JSON, in its rank order, once each. Entries without
 * an IMDb id, or of a kind that does not play, are left out.
 */
export function mdbListTitles(body: unknown): MdbListTitle[] {
  if (!Array.isArray(body)) return [];
  const entries = body
    .map((entry, index) => ({ entry, index }))
    .filter(
      (e): e is { entry: Record<string, unknown>; index: number } =>
        !!e.entry && typeof e.entry === 'object'
    );
  const rank = (e: { entry: Record<string, unknown>; index: number }) =>
    typeof e.entry.rank === 'number' ? e.entry.rank : Infinity;
  entries.sort((a, b) => rank(a) - rank(b) || a.index - b.index);
  const seen = new Set<string>();
  const titles: MdbListTitle[] = [];
  for (const { entry } of entries) {
    const id = entry.imdb_id;
    const type =
      entry.mediatype === 'movie'
        ? 'movie'
        : entry.mediatype === 'show'
          ? 'series'
          : null;
    if (typeof id !== 'string' || !IMDB.test(id) || !type || seen.has(id))
      continue;
    seen.add(id);
    titles.push({ type, id });
  }
  return titles;
}

export class MdbListError extends Error {
  constructor(
    message: string,
    readonly reason: 'not-found' | 'unavailable'
  ) {
    super(message);
    this.name = 'MdbListError';
  }
}

/** Reads a public list's titles from MDBList. */
export async function fetchMdbList(list: MdbListRef): Promise<MdbListTitle[]> {
  let response: Response;
  try {
    response = await makeRequest(mdbListJsonUrl(list), {
      timeout: TIMEOUT_MS,
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new MdbListError('MDBList could not be reached', 'unavailable');
  }
  if (response.status === 404)
    throw new MdbListError('No public MDBList list at that link', 'not-found');
  if (!response.ok)
    throw new MdbListError(
      `MDBList answered ${response.status}`,
      'unavailable'
    );
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new MdbListError('MDBList sent an unreadable answer', 'unavailable');
  }
  if (!Array.isArray(body))
    throw new MdbListError('No public MDBList list at that link', 'not-found');
  return mdbListTitles(body);
}
