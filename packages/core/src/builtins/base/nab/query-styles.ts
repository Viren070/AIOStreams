import type { NabCapsCategory } from './scan.js';

export type NabMediaType = 'movie' | 'series';

/** How one client writes newznab/torznab API URLs. */
export interface NabQueryStyle {
  /**
   * Parameter order. `extra` is the user's API path parameters and `*` the
   * rest in their own order; anything unlisted isn't sent.
   */
  search: readonly string[];
  caps: readonly string[];
  /** Sent with every search that doesn't set them. */
  defaults?: Readonly<Record<string, string>>;
  pageSize?: number;
  categories?: (
    type: NabMediaType,
    caps: readonly NabCapsCategory[]
  ) => number[] | undefined;
  encode: (value: string) => string;
  /** Written without encoding. */
  raw?: readonly string[];
  /** Searches tried after caps until one has results. */
  test: readonly Readonly<Record<string, string>>[];
}

const AIOSTREAMS: NabQueryStyle = {
  search: ['t', '*', 'extra', 'apikey'],
  caps: ['t', '*', 'extra', 'apikey'],
  encode: (value) => new URLSearchParams({ v: value }).toString().slice(2),
  test: [{ t: 'search', limit: '1' }],
};

/** System.Net.WebUtility.UrlEncode: `+` for spaces, keeps `-_.!*()`. */
function dotNetEncode(value: string): string {
  let out = '';
  for (const byte of Buffer.from(value, 'utf8')) {
    const c = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.!*()]/.test(c)) out += c;
    else if (c === ' ') out += '+';
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** Spring's UriComponentsBuilder for a query parameter (RFC 3986 pchar). */
function springEncode(value: string): string {
  let out = '';
  for (const byte of Buffer.from(value, 'utf8')) {
    const c = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~!$'()*+,;:@/?]/.test(c)) out += c;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** Advertised categories for the media type, children first within each group. */
function prowlarrCategories(
  type: NabMediaType,
  caps: readonly NabCapsCategory[]
): number[] | undefined {
  const parent = type === 'movie' ? 2000 : 5000;
  const category = caps.find((c) => c.id === parent);
  if (!category) return undefined;

  const categories = [...category.subcats, category.id];
  if (type === 'movie') return categories;

  // Indexers can advertise extra TV groups alongside 5000 in the TV ID range.
  const additionalCategories = caps
    .filter(({ id }) => id > parent && id < parent + 1000)
    .flatMap(({ id, subcats }) => [...subcats, id]);

  return [...new Set([...categories, ...additionalCategories])];
}

function servarr(categories: number[], type: string): NabQueryStyle {
  const cat = categories.join(',');
  return {
    search: [
      't',
      'cat',
      'extended',
      'extra',
      'apikey',
      'offset',
      'limit',
      'tvdbid',
      'imdbid',
      'tmdbid',
      'season',
      'ep',
      'q',
    ],
    caps: ['t', 'apikey'],
    defaults: { extended: '1', offset: '0' },
    pageSize: 100,
    categories: () => categories,
    encode: dotNetEncode,
    raw: [
      't',
      'cat',
      'extended',
      'apikey',
      'offset',
      'limit',
      'tvdbid',
      'imdbid',
      'tmdbid',
      'season',
      'ep',
    ],
    test: [{ t: type, cat, extended: '1', offset: '0', limit: '100' }],
  };
}

const STYLES: Record<string, NabQueryStyle> = {
  prowlarr: {
    search: [
      't',
      'extended',
      'cat',
      'extra',
      'apikey',
      'tvdbid',
      'tmdbid',
      'imdbid',
      'season',
      'ep',
      'q',
      'limit',
      'offset',
    ],
    caps: ['t', 'apikey'],
    defaults: { extended: '1', offset: '0' },
    // What Radarr and Sonarr ask Prowlarr for.
    pageSize: 100,
    categories: prowlarrCategories,
    encode: dotNetEncode,
    raw: ['t', 'extended', 'cat', 'apikey'],
    test: [{ t: 'search', extended: '1' }],
  },
  nzbhydra2: {
    search: [
      'apikey',
      't',
      'extended',
      'imdbid',
      'tmdbid',
      'tvdbid',
      'q',
      'season',
      'ep',
      'password',
      'extra',
      'cat',
      'limit',
      'offset',
    ],
    caps: ['apikey', 't'],
    defaults: { extended: '1', password: '1', offset: '0' },
    pageSize: 1000,
    categories: (type) => [type === 'movie' ? 2000 : 5000],
    encode: springEncode,
    test: [
      { t: 'search', q: 'mp3' },
      { t: 'movie', imdbid: '26443597' },
      { t: 'tvsearch', tvdbid: '121361' },
    ],
  },
  sonarr: servarr([5030, 5040], 'tvsearch'),
  radarr: servarr([2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060], 'movie'),
};

export function nabQueryStyle(preset: string | undefined): NabQueryStyle {
  return (preset && STYLES[preset]) || AIOSTREAMS;
}

export function sendsParam(style: NabQueryStyle, name: string): boolean {
  return style.search.includes(name) || style.search.includes('*');
}

/** `extra` entries that `params` also sets are skipped. */
export function formatNabQuery(
  style: NabQueryStyle,
  order: readonly string[],
  params: Readonly<Record<string, string>>,
  extra: Readonly<Record<string, string>>,
  apiKey: string | undefined
): string {
  const pairs: [string, string][] = [];
  const listed = new Set(order);
  for (const name of order) {
    if (name === 'apikey') {
      if (apiKey) pairs.push(['apikey', apiKey]);
    } else if (name === 'extra') {
      for (const [key, value] of Object.entries(extra)) {
        if (params[key] === undefined) pairs.push([key, value]);
      }
    } else if (name === '*') {
      for (const [key, value] of Object.entries(params)) {
        if (!listed.has(key)) pairs.push([key, value]);
      }
    } else if (params[name] !== undefined) {
      pairs.push([name, params[name]]);
    }
  }
  return pairs
    .map(
      ([key, value]) =>
        `${key}=${style.raw?.includes(key) ? value : style.encode(value)}`
    )
    .join('&');
}
