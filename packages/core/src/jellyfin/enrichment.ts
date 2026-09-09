import type { Meta, MetaPreview } from '../db/schemas.js';

export interface EnrichedPerson {
  name: string;
  type: 'Actor' | 'Director' | 'Writer';
  role?: string;
  photo?: string;
}

/** Optional meta fields, read by presence and skipped when absent. */
export interface Enrichment {
  providerIds: Record<string, string>;
  thumb?: string;
  logo?: string;
  people: EnrichedPerson[];
  seasonPosters: (string | null)[];
  certification?: string;
  customRating?: string;
  trailers: { Name: string; Url: string }[];
  status?: 'Continuing' | 'Ended';
  endDate?: string;
  country?: string;
  year?: number;
  premiere?: string;
  runtimeMs?: number;
  /** genre name -> catalog that a discover link points at */
  genreTargets: Map<string, { type: string; catalogId: string }>;
}

type AnyMeta = (MetaPreview | Meta) & Record<string, unknown>;

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function parseRuntimeMs(runtime: unknown): number | undefined {
  if (runtime == null) return undefined;
  if (typeof runtime === 'number')
    return runtime > 0 ? runtime * 60_000 : undefined;
  const s = String(runtime).toLowerCase();
  let minutes = 0;
  const h = s.match(/(\d+)\s*h/);
  const m = s.match(/(\d+)\s*m/);
  if (h) minutes += Number(h[1]) * 60;
  if (m) minutes += Number(m[1]);
  if (!h && !m) {
    const n = s.match(/(\d+)/);
    if (n) minutes = Number(n[1]);
  }
  return minutes > 0 ? minutes * 60_000 : undefined;
}

export function parseYear(value: unknown): number | undefined {
  if (value == null) return undefined;
  const m = String(value).match(/(\d{4})/);
  return m ? Number(m[1]) : undefined;
}

export function toIso(date: unknown): string | undefined {
  if (!date) return undefined;
  const d = new Date(String(date));
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

function statusFrom(meta: AnyMeta): 'Continuing' | 'Ended' | undefined {
  const explicit = str(meta.status)?.toLowerCase();
  if (
    explicit === 'continuing' ||
    explicit === 'returning series' ||
    explicit === 'ongoing'
  )
    return 'Continuing';
  if (
    explicit === 'ended' ||
    explicit === 'canceled' ||
    explicit === 'cancelled'
  )
    return 'Ended';
  const info = str(meta.releaseInfo);
  if (!info) return undefined;
  if (/\d{4}\s*[-–]\s*$/.test(info)) return 'Continuing';
  if (/\d{4}\s*[-–]\s*\d{4}/.test(info)) return 'Ended';
  return undefined;
}

function peopleFrom(meta: AnyMeta): EnrichedPerson[] {
  const out: EnrichedPerson[] = [];
  const seen = new Set<string>();
  const push = (p: EnrichedPerson) => {
    const key = `${p.type}|${p.name.toLowerCase()}`;
    if (!p.name || seen.has(key)) return;
    seen.add(key);
    out.push(p);
  };
  const extras = meta.app_extras as Record<string, unknown> | undefined;
  const fromExtras = (list: unknown, type: EnrichedPerson['type']) => {
    if (!Array.isArray(list)) return false;
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const name = str(e.name);
      if (!name) continue;
      const role = str(e.character);
      push({
        name,
        type,
        role: role && role !== name ? role : undefined,
        photo: str(e.photo),
      });
    }
    return list.length > 0;
  };
  const hadCast = fromExtras(extras?.cast, 'Actor');
  const hadDirectors = fromExtras(extras?.directors, 'Director');
  const hadWriters = fromExtras(extras?.writers, 'Writer');

  const links = Array.isArray(meta.links)
    ? (meta.links as { name: string; category: string }[])
    : [];
  const byCategory = (category: string) =>
    links
      .filter((l) => l.category?.toLowerCase() === category)
      .map((l) => l.name);

  if (!hadCast) {
    const cast = Array.isArray(meta.cast)
      ? (meta.cast as unknown[])
      : byCategory('cast');
    for (const c of cast)
      if (typeof c === 'string') push({ name: c, type: 'Actor' });
  }
  if (!hadDirectors) {
    const d = meta.director;
    const list = Array.isArray(d)
      ? d
      : typeof d === 'string'
        ? [d]
        : byCategory('directors');
    for (const c of list)
      if (typeof c === 'string') push({ name: c, type: 'Director' });
  }
  if (!hadWriters) {
    const w = meta.writer;
    const list = Array.isArray(w)
      ? w
      : typeof w === 'string'
        ? [w]
        : byCategory('writers');
    for (const c of list)
      if (typeof c === 'string') push({ name: c, type: 'Writer' });
  }
  return out;
}

const PROVIDER_FIELDS: [string, string][] = [
  ['_imdbId', 'Imdb'],
  ['imdb_id', 'Imdb'],
  ['_tmdbId', 'Tmdb'],
  ['tmdb_id', 'Tmdb'],
  ['moviedb_id', 'Tmdb'],
  ['_tvdbId', 'Tvdb'],
  ['tvdb_id', 'Tvdb'],
  ['_malId', 'MyAnimeList'],
  ['mal_id', 'MyAnimeList'],
  ['_kitsuId', 'Kitsu'],
  ['kitsu_id', 'Kitsu'],
  ['_anilistId', 'AniList'],
  ['anilist_id', 'AniList'],
  ['_anidbId', 'AniDB'],
  ['anidb_id', 'AniDB'],
];

function genreTargetsFrom(
  meta: AnyMeta
): Map<string, { type: string; catalogId: string }> {
  const out = new Map<string, { type: string; catalogId: string }>();
  const links = Array.isArray(meta.links)
    ? (meta.links as { name: string; category: string; url: string }[])
    : [];
  for (const link of links) {
    if (link.category?.toLowerCase() !== 'genres') continue;
    const m =
      /^stremio:\/\/\/discover\/[^/]+\/([^/]+)\/([^/?]+)\?genre=(.+)$/.exec(
        link.url ?? ''
      );
    if (!m) continue;
    try {
      out.set(link.name, {
        type: decodeURIComponent(m[1]),
        catalogId: decodeURIComponent(m[2]),
      });
    } catch {}
  }
  return out;
}

export function readEnrichment(input: MetaPreview | Meta): Enrichment {
  const meta = input as AnyMeta;
  const extras = (meta.app_extras ?? {}) as Record<string, unknown>;

  const providerIds: Record<string, string> = {};
  for (const [field, key] of PROVIDER_FIELDS) {
    const v = str(meta[field]);
    if (v && !providerIds[key])
      providerIds[key] = key === 'Imdb' && !v.startsWith('tt') ? `tt${v}` : v;
  }

  const trailers: { Name: string; Url: string }[] = [];
  const seenTrailers = new Set<string>();
  const addTrailer = (name: string, url: string) => {
    if (seenTrailers.has(url)) return;
    seenTrailers.add(url);
    trailers.push({ Name: name, Url: url });
  };
  if (Array.isArray(meta.trailerStreams)) {
    for (const t of meta.trailerStreams as Record<string, unknown>[]) {
      const yt = str(t.ytId);
      if (yt)
        addTrailer(
          str(t.title) ?? 'Trailer',
          `https://www.youtube.com/watch?v=${yt}`
        );
    }
  }
  if (Array.isArray(meta.trailers)) {
    for (const t of meta.trailers as Record<string, unknown>[]) {
      const source = str(t.source);
      if (!source) continue;
      addTrailer(
        str(t.name) ?? str(t.type) ?? 'Trailer',
        source.startsWith('http')
          ? source
          : `https://www.youtube.com/watch?v=${source}`
      );
    }
  }

  const seasonPosters = Array.isArray(extras.seasonPosters)
    ? (extras.seasonPosters as unknown[]).map((p) => str(p) ?? null)
    : [];

  const stability = (meta._stability ?? {}) as Record<string, unknown>;

  return {
    providerIds,
    thumb: str(meta.landscapePoster),
    logo: str(meta.logo),
    people: peopleFrom(meta),
    seasonPosters,
    certification: str(extras.certification) ?? str(meta.certification),
    customRating: str(extras.certificationLocal),
    trailers,
    status: statusFrom(meta),
    endDate: toIso(stability.endDate),
    country: str(meta.country),
    year:
      parseYear(meta.year) ??
      parseYear(meta.releaseInfo) ??
      parseYear(meta.released),
    premiere: toIso(meta.released),
    runtimeMs: parseRuntimeMs(meta.runtime),
    genreTargets: genreTargetsFrom(meta),
  };
}

export function genresFrom(input: MetaPreview | Meta): string[] {
  const meta = input as AnyMeta;
  const direct = Array.isArray(meta.genres) ? (meta.genres as unknown[]) : [];
  const links = Array.isArray(meta.links)
    ? (meta.links as { name: string; category: string }[])
    : [];
  const fromLinks = links
    .filter((l) => l.category?.toLowerCase() === 'genres')
    .map((l) => l.name)
    .filter((n) => !/^\d+$/.test(n));
  const list = direct.length ? direct : fromLinks;
  return [
    ...new Set(
      list.filter((g): g is string => typeof g === 'string' && g.length > 0)
    ),
  ];
}

export function imdbRatingOf(input: MetaPreview | Meta): number | undefined {
  const meta = input as AnyMeta;
  const direct = num(meta.imdbRating);
  if (direct !== undefined) return direct;
  const links = Array.isArray(meta.links)
    ? (meta.links as { name: string; category: string }[])
    : [];
  const link = links.find((l) => l.category?.toLowerCase() === 'imdb');
  return link ? num(link.name) : undefined;
}
