import XMLBuilder from 'fast-xml-builder';
import type { ParsedStream } from '../db/index.js';

/**
 * Newznab / Torznab feed transformer + XML renderer.
 *
 * AIOStreams exposes a user's stream pipeline to newznab/torznab clients. It only
 * supports ID + season/episode lookups.
 */

export type NabNamespace = 'newznab' | 'torznab';

const NS_URI: Record<NabNamespace, string> = {
  newznab: 'http://www.newznab.com/DTD/2010/feeds/attributes/',
  torznab: 'http://torznab.com/schemas/2015/feed',
};

const CATEGORY_MOVIES = 2000;
const CATEGORY_TV = 5000;

/**
 * Fallback age for a result with no known upload time.
 */
const UNKNOWN_AGE_HOURS = 24;

/** Milliseconds in an hour, for age calculations. */
const HOUR_MS = 3_600_000;

/** Fake but well-formed torrent identity for the RSS placeholder item. */
const PLACEHOLDER_INFO_HASH = '0'.repeat(40);
/** Reserved TLD (RFC 2606), so the placeholder can never resolve to a download. */
const PLACEHOLDER_NZB_URL = 'https://placeholder.invalid/aiostreams.nzb';

/**
 * Static capability facts, declared once so the XML caps document and the
 * `o=json` mirror never drift. `search` (free-text) is advertised as
 * unavailable because AIOStreams cannot do title search.
 */
export const NAB_CAPABILITIES = {
  limits: { max: 1000, default: 1000 },
  searching: {
    search: { available: false, supportedParams: ['q'] },
    'tv-search': {
      available: true,
      supportedParams: ['q', 'imdbid', 'tvdbid', 'tmdbid', 'season', 'ep'],
    },
    'movie-search': {
      available: true,
      supportedParams: ['q', 'imdbid', 'tmdbid', 'tvdbid'],
    },
  },
  categories: [
    { id: CATEGORY_MOVIES, name: 'Movies' },
    { id: CATEGORY_TV, name: 'TV' },
  ],
} as const;

/** An array renders as one `<ns:attr>` element per value (e.g. `language`). */
export type NabAttrValue = string | number | Array<string | number>;

export interface NabItem {
  title: string;
  guid: string;
  size: number;
  category: number;
  publishedAt: number;
  enclosure: { url: string; length: number; type: string };
  attrs: Record<string, NabAttrValue>;
}

export interface NabFeed {
  title: string;
  description: string;
  items: NabItem[];
  offset?: number;
  total?: number;
}

export interface NabQueryContext {
  mediaType: 'movie' | 'series';
  imdbId?: string;
  tvdbId?: string;
  tmdbId?: string;
  season?: string;
  episode?: string;
}

function isUsenetStream(stream: ParsedStream): boolean {
  return (
    stream.type === 'usenet' ||
    stream.type === 'stremio-usenet' ||
    Boolean(stream.nzbUrl)
  );
}

function buildMagnet(
  infoHash: string,
  name: string,
  sources: string[]
): string {
  let magnet = `magnet:?xt=urn:btih:${infoHash}`;
  if (name) magnet += `&dn=${encodeURIComponent(name)}`;
  for (const tr of sources) magnet += `&tr=${encodeURIComponent(tr)}`;
  return magnet;
}

export class NabTransformer {
  constructor(
    private readonly namespace: NabNamespace,
    private readonly addonName: string
  ) {}

  transform(streams: ParsedStream[], ctx: NabQueryContext): NabFeed {
    const category = ctx.mediaType === 'movie' ? CATEGORY_MOVIES : CATEGORY_TV;
    const items: NabItem[] = [];
    for (const stream of streams) {
      const item =
        this.namespace === 'newznab'
          ? this.toNewznabItem(stream, category, ctx)
          : this.toTorznabItem(stream, category, ctx);
      if (item) items.push(item);
    }
    return this.feed(items);
  }

  /**
   * Answer for a bare query (nothing to search for), which clients issue to
   * test an indexer. The category must intersect the client's configured
   * categories or e.g. Sonarr fails the whole test, so the caller passes the
   * one it derived from the request.
   */
  rssPlaceholder(category: number = CATEGORY_MOVIES): NabFeed {
    const title = `${this.addonName} supports ID based search only and has no RSS feed`;
    const shared = {
      title,
      size: 0,
      category,
      publishedAt: Date.now() - UNKNOWN_AGE_HOURS * HOUR_MS,
    };
    const item: NabItem =
      this.namespace === 'newznab'
        ? {
            ...shared,
            guid: PLACEHOLDER_NZB_URL,
            enclosure: {
              url: PLACEHOLDER_NZB_URL,
              length: 0,
              type: 'application/x-nzb',
            },
            attrs: { size: 0, category },
          }
        : {
            ...shared,
            guid: PLACEHOLDER_INFO_HASH,
            enclosure: {
              url: buildMagnet(PLACEHOLDER_INFO_HASH, title, []),
              length: 0,
              type: 'application/x-bittorrent',
            },
            attrs: {
              size: 0,
              category,
              infohash: PLACEHOLDER_INFO_HASH,
              magneturl: buildMagnet(PLACEHOLDER_INFO_HASH, title, []),
            },
          };
    return this.feed([item]);
  }

  private feed(items: NabItem[]): NabFeed {
    return {
      title: `${this.addonName} ${this.namespace}`,
      description: `${this.addonName} ${this.namespace} results`,
      items,
    };
  }

  private common(stream: ParsedStream): {
    title: string;
    size: number;
    publishedAt: number;
  } {
    const ageHours =
      typeof stream.age === 'number' ? stream.age : UNKNOWN_AGE_HOURS;
    return {
      title: stream.folderName ?? stream.filename ?? 'Unknown',
      size: stream.folderSize ?? stream.size ?? 0,
      publishedAt: Date.now() - ageHours * HOUR_MS,
    };
  }

  /**
   * The ids come from the query rather than the result because the pipeline
   * matched on them but doesn't report them per-stream.
   */
  private baseAttrs(
    stream: ParsedStream,
    size: number,
    category: number,
    ctx: NabQueryContext
  ): Record<string, NabAttrValue> {
    const attrs: Record<string, NabAttrValue> = { size, category };
    if (ctx.imdbId) attrs.imdb = ctx.imdbId.replace(/^tt/i, '');
    if (ctx.tvdbId) attrs.tvdbid = ctx.tvdbId;
    if (ctx.tmdbId) attrs.tmdbid = ctx.tmdbId;
    if (ctx.season) attrs.season = ctx.season;
    if (ctx.episode) attrs.episode = ctx.episode;

    const parsed = stream.parsedFile;
    if (parsed?.languages?.length) attrs.language = parsed.languages.join(',');
    if (parsed?.subtitles?.length) attrs.subs = parsed.subtitles.join(',');
    if (parsed?.resolution) attrs.resolution = parsed.resolution;
    if (parsed?.year) attrs.year = parsed.year;
    attrs.sourceAddon = stream.addon.name;
    if (stream.indexer) attrs.sourceIndexerName = stream.indexer;

    return attrs;
  }

  private toNewznabItem(
    stream: ParsedStream,
    category: number,
    ctx: NabQueryContext
  ): NabItem | null {
    if (!stream.nzbUrl) return null;
    const { title, size, publishedAt } = this.common(stream);
    const attrs = this.baseAttrs(stream, size, category, ctx);
    attrs.usenetdate = new Date(publishedAt).toUTCString();
    return {
      title,
      guid: stream.nzbUrl,
      size,
      category,
      publishedAt,
      enclosure: {
        url: stream.nzbUrl,
        length: size,
        type: 'application/x-nzb',
      },
      attrs,
    };
  }

  private toTorznabItem(
    stream: ParsedStream,
    category: number,
    ctx: NabQueryContext
  ): NabItem | null {
    const infoHash = stream.torrent?.infoHash;
    if (!infoHash || isUsenetStream(stream)) return null;
    const { title, size, publishedAt } = this.common(stream);
    const magnet = buildMagnet(infoHash, title, stream.torrent?.sources ?? []);
    const attrs = this.baseAttrs(stream, size, category, ctx);
    attrs.infohash = infoHash;
    attrs.magneturl = magnet;
    if (typeof stream.torrent?.seeders === 'number') {
      attrs.seeders = stream.torrent.seeders;
    }
    if (stream.torrent?.freeleech) attrs.downloadvolumefactor = 0;
    return {
      title,
      guid: infoHash,
      size,
      category,
      publishedAt,
      enclosure: {
        url: magnet,
        length: size,
        type: 'application/x-bittorrent',
      },
      attrs,
    };
  }
}

/**
 * Category for the placeholder item of a bare test query: the first category
 * the client asked for, else the natural one for the search function.
 */
export function nabPlaceholderCategory(t: string, cat?: string): number {
  const requested = cat
    ?.split(',')
    .map((c) => Number.parseInt(c.trim(), 10))
    .find((c) => Number.isFinite(c) && c > 0);
  if (requested) return requested;
  return t === 'tvsearch' ? CATEGORY_TV : CATEGORY_MOVIES;
}

/**
 * Apply newznab/torznab `offset`/`limit` paging to a fully-built feed. We have
 * every result up front (the pipeline runs in one shot, so there's no real
 * pagination cost), so the default is to return everything.
 */
export function paginateNabFeed(
  feed: NabFeed,
  paging: { limit?: number; offset?: number }
): NabFeed {
  const total = feed.items.length;
  const { max } = NAB_CAPABILITIES.limits;
  const offset =
    typeof paging.offset === 'number' && paging.offset > 0
      ? Math.floor(paging.offset)
      : 0;
  const hasLimit =
    typeof paging.limit === 'number' &&
    Number.isFinite(paging.limit) &&
    paging.limit >= 0;
  const end = hasLimit
    ? offset + Math.min(Math.floor(paging.limit as number), max)
    : undefined;
  return {
    ...feed,
    items: feed.items.slice(offset, end),
    offset,
    total,
  };
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n';

const builder = new XMLBuilder({
  format: true,
  indentBy: '  ',
  ignoreAttributes: false,
  suppressEmptyNode: true,
  attributeNamePrefix: '@_',
});

export function renderNabFeedXml(
  namespace: NabNamespace,
  feed: NabFeed
): string {
  const items = feed.items.map((item) => ({
    title: item.title,
    guid: { '@_isPermaLink': 'false', '#text': item.guid },
    pubDate: new Date(item.publishedAt).toUTCString(),
    size: item.size,
    category: item.category,
    enclosure: {
      '@_url': item.enclosure.url,
      '@_length': item.enclosure.length,
      '@_type': item.enclosure.type,
    },
    [`${namespace}:attr`]: Object.entries(item.attrs).flatMap(([name, value]) =>
      (Array.isArray(value) ? value : [value]).map((v) => ({
        '@_name': name,
        '@_value': String(v),
      }))
    ),
  }));

  const obj = {
    rss: {
      '@_version': '2.0',
      '@_xmlns:atom': 'http://www.w3.org/2005/Atom',
      [`@_xmlns:${namespace}`]: NS_URI[namespace],
      channel: {
        title: feed.title,
        description: feed.description,
        [`${namespace}:response`]: {
          '@_offset': feed.offset ?? 0,
          '@_total': feed.total ?? feed.items.length,
        },
        item: items,
      },
    },
  };
  return XML_HEADER + builder.build(obj);
}

export function renderNabCapsXml(serverTitle: string): string {
  const searching: Record<string, unknown> = {};
  for (const [fn, cfg] of Object.entries(NAB_CAPABILITIES.searching)) {
    searching[fn] = {
      '@_available': cfg.available ? 'yes' : 'no',
      '@_supportedParams': cfg.supportedParams.join(','),
    };
  }
  const obj = {
    caps: {
      server: { '@_title': serverTitle, '@_version': '1.0' },
      limits: {
        '@_max': NAB_CAPABILITIES.limits.max,
        '@_default': NAB_CAPABILITIES.limits.default,
      },
      searching,
      categories: {
        category: NAB_CAPABILITIES.categories.map((c) => ({
          '@_id': c.id,
          '@_name': c.name,
        })),
      },
    },
  };
  return XML_HEADER + builder.build(obj);
}

/** Clean (non-`@_`) caps object for the `o=json` debug mirror. */
export function nabCapsJson(serverTitle: string) {
  return {
    server: { title: serverTitle, version: '1.0' },
    ...NAB_CAPABILITIES,
  };
}

/**
 * Newznab/torznab error document (e.g. code 100 = incorrect credentials,
 * 200 = missing parameter), matching the `<error code= description=/>` shape
 * real indexers return.
 */
export function renderNabErrorXml(code: number, description: string): string {
  return (
    XML_HEADER +
    builder.build({ error: { '@_code': code, '@_description': description } })
  );
}
