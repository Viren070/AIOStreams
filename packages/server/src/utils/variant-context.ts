import type { Request } from 'express';
import { createLogger, type VariantRequestContext } from '@aiostreams/core';

const logger = createLogger('server');

/**
 * `/<resource>/<type>/<id>.json`, with the optional extras segment catalogues
 * and subtitles carry. The path is relative to the router mount, so the
 * variant selector prefix never appears here.
 */
const TYPED_RESOURCE =
  /^\/(stream|meta|catalog|subtitles|addon_catalog)\/([^/]+)\/([^/]+?)(?:\/[^/]+)?\.json$/;

const CHILLLINK_STREAMS = /^\/streams\/?$/;

/** Resources whose requests are about one piece of media, so carry a type and id. */
const TYPED_RESOURCES: ReadonlySet<string> = new Set([
  'stream',
  'meta',
  'catalog',
  'subtitles',
  'addon_catalog',
]);

/** Credentials and internal plumbing have no business in a user expression. */
const HIDDEN_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-aiostreams-user-data',
]);

const MAX_QUERY_VALUE = 1024;
const MAX_HEADER_VALUE = 2048;

function firstString(value: unknown): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === 'string' ? single : undefined;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The request as a variant condition sees it. ChillLink builds its Stremio id
 * from query parameters, so it is derived the same way `chilllink/streams.ts`
 * does rather than read off the path.
 */
export function buildVariantRequestContext(
  req: Pick<Request, 'path' | 'query' | 'headers'>,
  resource: string,
  overrides: { type?: string; id?: string } = {}
): VariantRequestContext {
  let type = overrides.type;
  let id = overrides.id;

  if (!type && !id) {
    const match = req.path.match(TYPED_RESOURCE);
    if (match) {
      type = decode(match[2]);
      id = decode(match[3]);
    } else if (CHILLLINK_STREAMS.test(req.path)) {
      const query = req.query as Record<string, unknown>;
      type = firstString(query.type);
      const imdb = firstString(query.imdbID);
      const tmdb = firstString(query.tmdbID);
      const base = imdb || (tmdb ? `tmdb:${tmdb}` : '');
      if (base) {
        const season = firstString(query.season);
        const episode = firstString(query.episode);
        id = `${base}${season ? `:${season}` : ''}${episode ? `:${episode}` : ''}`;
      }
    } else if (TYPED_RESOURCES.has(resource)) {
      logger.warn(
        { path: req.path, resource },
        'unrecognised request path: variant conditions using type or id cannot match it'
      );
    }
  }

  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.query ?? {})) {
    const single = firstString(value);
    if (single !== undefined) query[key] = single.slice(0, MAX_QUERY_VALUE);
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    const name = key.toLowerCase();
    if (HIDDEN_HEADERS.has(name)) continue;
    const single = Array.isArray(value) ? value.join(', ') : value;
    if (typeof single === 'string') {
      headers[name] = single.slice(0, MAX_HEADER_VALUE);
    }
  }

  return {
    resource,
    type,
    id,
    userAgent: headers['user-agent'] ?? '',
    query,
    headers,
  };
}
