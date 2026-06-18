import XMLBuilder from 'fast-xml-builder';
import type { SearchApiResult } from './api.js';

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

export interface NabItem {
  title: string;
  guid: string;
  size: number;
  category: number;
  publishedAt?: number;
  enclosure: { url: string; length: number; type: string };
  attrs: Record<string, string | number>;
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
  season?: string;
  episode?: string;
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

  transform(results: SearchApiResult[], ctx: NabQueryContext): NabFeed {
    const category = ctx.mediaType === 'movie' ? CATEGORY_MOVIES : CATEGORY_TV;
    const imdb = ctx.imdbId ? ctx.imdbId.replace(/^tt/i, '') : undefined;
    const items: NabItem[] = [];
    for (const result of results) {
      const item =
        this.namespace === 'newznab'
          ? this.toNewznabItem(result, category, imdb, ctx)
          : this.toTorznabItem(result, category, imdb, ctx);
      if (item) items.push(item);
    }
    return {
      title: `${this.addonName} ${this.namespace}`,
      description: `${this.addonName} ${this.namespace} results`,
      items,
    };
  }

  private common(result: SearchApiResult): {
    title: string;
    size: number;
    publishedAt?: number;
  } {
    return {
      title: result.folderName ?? result.filename ?? 'Unknown',
      size: result.folderSize ?? result.size ?? 0,
      publishedAt:
        typeof result.age === 'number'
          ? Date.now() - result.age * 3_600_000
          : undefined,
    };
  }

  private baseAttrs(
    size: number,
    category: number,
    imdb: string | undefined,
    ctx: NabQueryContext
  ): Record<string, string | number> {
    const attrs: Record<string, string | number> = { size, category };
    if (imdb) attrs.imdb = imdb;
    if (ctx.season) attrs.season = ctx.season;
    if (ctx.episode) attrs.episode = ctx.episode;
    return attrs;
  }

  private toNewznabItem(
    result: SearchApiResult,
    category: number,
    imdb: string | undefined,
    ctx: NabQueryContext
  ): NabItem | null {
    if (!result.nzbUrl) return null;
    const { title, size, publishedAt } = this.common(result);
    return {
      title,
      guid: result.nzbUrl,
      size,
      category,
      publishedAt,
      enclosure: {
        url: result.nzbUrl,
        length: size,
        type: 'application/x-nzb',
      },
      attrs: this.baseAttrs(size, category, imdb, ctx),
    };
  }

  private toTorznabItem(
    result: SearchApiResult,
    category: number,
    imdb: string | undefined,
    ctx: NabQueryContext
  ): NabItem | null {
    const infoHash = result.infoHash;
    if (!infoHash) return null;
    const { title, size, publishedAt } = this.common(result);
    const magnet = buildMagnet(infoHash, title, result.sources ?? []);
    const attrs = this.baseAttrs(size, category, imdb, ctx);
    attrs.infohash = infoHash;
    attrs.magneturl = magnet;
    if (typeof result.seeders === 'number') attrs.seeders = result.seeders;
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
    ...(item.publishedAt
      ? { pubDate: new Date(item.publishedAt).toUTCString() }
      : {}),
    size: item.size,
    category: item.category,
    enclosure: {
      '@_url': item.enclosure.url,
      '@_length': item.enclosure.length,
      '@_type': item.enclosure.type,
    },
    [`${namespace}:attr`]: Object.entries(item.attrs).map(([name, value]) => ({
      '@_name': name,
      '@_value': String(value),
    })),
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
