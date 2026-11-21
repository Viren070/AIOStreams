import { randomBytes } from 'node:crypto';

// Prowlarr's NewznabRequestGenerator appends search params in this order.
const PARAM_ORDER = [
  'tvdbid',
  'tmdbid',
  'imdbid',
  'season',
  'ep',
  'q',
  'limit',
  'offset',
];
const rank = (key: string) =>
  PARAM_ORDER.includes(key) ? PARAM_ORDER.indexOf(key) : PARAM_ORDER.length;

/**
 * A newznab/torznab query string in Prowlarr's order: `t`, `extended`, the
 * endpoint's extra params, `apikey`, then the search params.
 */
export function buildNabQuery(
  func: string,
  params: Record<string, string>,
  extraParams: Record<string, string> = {},
  apiKey?: string
): string {
  const { extended, ...search } = params;
  const auth = apiKey || extraParams.apikey;
  const query = new URLSearchParams({ t: func });
  if (extended !== undefined) query.append('extended', extended);
  for (const [key, value] of Object.entries(extraParams)) {
    if (key !== 't' && key !== 'apikey' && !(key in params)) {
      query.append(key, value);
    }
  }
  if (auth) query.append('apikey', auth);
  const ordered = Object.entries(search).sort(([a], [b]) => rank(a) - rank(b));
  for (const [key, value] of ordered) {
    // Prowlarr sends season 0 as `00`: NNTmux reads `0` as no season.
    query.append(key, key === 'season' && value === '0' ? '00' : value);
  }
  return query.toString();
}

/** A W3C `traceparent` value, unsampled, as .NET sends from inside a request. */
export function newTraceparent(): string {
  return `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-00`;
}
