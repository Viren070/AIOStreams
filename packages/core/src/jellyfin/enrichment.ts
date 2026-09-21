import type {
  Meta,
  MetaPerson,
  MetaPreview,
  ParsedMeta,
  Subtitle,
} from '../db/schemas.js';
import {
  iso6391ToLanguage,
  iso6392ToIso6391,
  languageToIso6392,
  normaliseLangCode,
  normaliseLanguage,
} from '../utils/languages.js';

export interface EnrichedPerson {
  name: string;
  type: (typeof PERSON_TYPES)[keyof typeof PERSON_TYPES];
  role?: string;
  photo?: string;
}

export interface SeasonDetails {
  name?: string;
  overview?: string;
  poster?: string;
  premiere?: string;
}

/** Optional meta fields (`reference/addon-protocol/metadata`); a documented name wins over a fallback. */
export interface Enrichment {
  providerIds: Record<string, string>;
  originalTitle?: string;
  tagline?: string;
  thumb?: string;
  logo?: string;
  people: EnrichedPerson[];
  seasons: Map<number, SeasonDetails>;
  certification?: string;
  customRating?: string;
  criticRating?: number;
  studios: string[];
  countries: string[];
  tags: string[];
  trailers: { Name: string; Url: string }[];
  status?: 'Continuing' | 'Ended';
  endDate?: string;
  airDays: string[];
  airTime?: string;
  year?: number;
  premiere?: string;
  runtimeMs?: number;
  /** genre name -> catalog that a discover link points at */
  genreTargets: Map<string, { type: string; catalogId: string }>;
}

export interface VideoEnrichment {
  providerIds: Record<string, string>;
  rating?: number;
  runtimeMs?: number;
  people: EnrichedPerson[];
}

export interface SubtitleEnrichment {
  title?: string;
  forced: boolean;
  hearingImpaired: boolean;
}

export interface SubtitleLanguage {
  /** ISO 639-2 */
  code?: string;
  name?: string;
  /** `lang` names the language and nothing else. */
  exact: boolean;
}

type AnyMeta = (MetaPreview | Meta) & Record<string, unknown>;
type AnyObject = Record<string, unknown>;

function isObject(v: unknown): v is AnyObject {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function upTo(max: number, v: unknown): number | undefined {
  const n = num(v);
  return n !== undefined && n >= 0 && n <= max ? n : undefined;
}

function strings(list: unknown): string[] {
  return Array.isArray(list)
    ? [...new Set(list.map(str).filter((s): s is string => !!s))]
    : [];
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

const PROVIDER_KEYS: Record<string, string> = {
  imdb: 'Imdb',
  tmdb: 'Tmdb',
  tvdb: 'Tvdb',
  mal: 'MyAnimeList',
  kitsu: 'Kitsu',
  anilist: 'AniList',
  anidb: 'AniDB',
  simkl: 'Simkl',
  trakt: 'Trakt',
};

const ID_FALLBACKS: [string, string][] = [
  ['_imdbId', 'imdb'],
  ['imdb_id', 'imdb'],
  ['_tmdbId', 'tmdb'],
  ['tmdb_id', 'tmdb'],
  ['moviedb_id', 'tmdb'],
  ['_tvdbId', 'tvdb'],
  ['tvdb_id', 'tvdb'],
  ['_malId', 'mal'],
  ['mal_id', 'mal'],
  ['_kitsuId', 'kitsu'],
  ['kitsu_id', 'kitsu'],
  ['_anilistId', 'anilist'],
  ['anilist_id', 'anilist'],
  ['_anidbId', 'anidb'],
  ['anidb_id', 'anidb'],
];

function providerIdsFrom(source: AnyObject): Record<string, string> {
  const out: Record<string, string> = {};
  const declared = isObject(source.ids) ? Object.entries(source.ids) : [];
  const fallbacks = ID_FALLBACKS.map(([field, key]) => [key, source[field]]);
  for (const [key, raw] of [...declared, ...fallbacks]) {
    const jf = PROVIDER_KEYS[key as string];
    const v = str(raw);
    if (!jf || !v || out[jf]) continue;
    out[jf] = key === 'imdb' && !v.startsWith('tt') ? `tt${v}` : v;
  }
  return out;
}

const PERSON_TYPES = {
  actor: 'Actor',
  director: 'Director',
  writer: 'Writer',
  producer: 'Producer',
  composer: 'Composer',
  creator: 'Creator',
  guestStar: 'GuestStar',
} as const;

function uniquePeople(people: EnrichedPerson[]): EnrichedPerson[] {
  const seen = new Set<string>();
  return people.filter((p) => {
    const key = `${p.type}|${p.name.toLowerCase()}`;
    if (!p.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** `{ name, character, photo }` entries. */
function detailed(
  list: unknown,
  typeOf: (entry: AnyObject) => EnrichedPerson['type'] | undefined
): EnrichedPerson[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const name = isObject(entry) ? str(entry.name) : undefined;
    const type = name ? typeOf(entry) : undefined;
    if (!name || !type) return [];
    const role = str(entry.character);
    return [
      {
        name,
        type,
        role: role && role !== name ? role : undefined,
        photo: str(entry.photo),
      },
    ];
  });
}

function declaredPeople(list: MetaPerson[] | null | undefined) {
  return uniquePeople(
    detailed(
      list,
      (entry) => PERSON_TYPES[entry.role as keyof typeof PERSON_TYPES]
    )
  );
}

function peopleFrom(meta: AnyMeta): EnrichedPerson[] {
  const declared = declaredPeople(meta.people);
  if (declared.length) return declared;

  const extras = isObject(meta.app_extras) ? meta.app_extras : {};
  const links = Array.isArray(meta.links)
    ? (meta.links as { name: string; category: string }[])
    : [];
  const names = (
    value: unknown,
    category: string,
    type: EnrichedPerson['type']
  ): EnrichedPerson[] => {
    const list =
      typeof value === 'string'
        ? [value]
        : Array.isArray(value)
          ? value
          : links
              .filter((l) => l.category?.toLowerCase() === category)
              .map((l) => l.name);
    return strings(list).map((name) => ({ name, type }));
  };
  const either = (
    rich: unknown,
    flat: unknown,
    category: string,
    type: EnrichedPerson['type']
  ) =>
    Array.isArray(rich) && rich.length
      ? detailed(rich, () => type)
      : names(flat, category, type);

  return uniquePeople([
    ...either(extras.cast, meta.cast, 'cast', 'Actor'),
    ...either(extras.directors, meta.director, 'directors', 'Director'),
    ...either(extras.writers, meta.writer, 'writers', 'Writer'),
    ...detailed(extras.producers, () => 'Producer'),
  ]);
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

/** In `app_extras.ratings`, `tomatoes` is the critic score. */
function criticRatingFrom(
  meta: AnyMeta,
  extras: AnyObject
): number | undefined {
  const declared = upTo(100, meta.criticRating);
  if (declared !== undefined || !Array.isArray(extras.ratings)) return declared;
  const tomatoes = extras.ratings.find(
    (r): r is AnyObject => isObject(r) && r.source === 'tomatoes'
  );
  return upTo(100, tomatoes?.value ?? tomatoes?.score);
}

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

function seasonsFrom(
  meta: AnyMeta,
  extras: AnyObject
): Map<number, SeasonDetails> {
  const out = new Map<number, SeasonDetails>();
  for (const s of meta.seasons ?? [])
    out.set(s.season, {
      name: str(s.name),
      overview: str(s.overview),
      poster: str(s.poster),
      premiere: toIso(s.released),
    });

  // `app_extras` posters: keyed by number, or a list in season order.
  const posters = new Map<number, string>();
  if (isObject(extras.seasonPosterByNumber)) {
    for (const [k, v] of Object.entries(extras.seasonPosterByNumber)) {
      const url = str(v);
      const season = num(k);
      if (url && season !== undefined) posters.set(season, url);
    }
  }
  const list = Array.isArray(extras.seasonPosters) ? extras.seasonPosters : [];
  if (!posters.size && list.length) {
    const seasons = new Set<number>();
    for (const v of (meta.videos as { season?: unknown }[] | undefined) ?? [])
      seasons.add(typeof v.season === 'number' ? v.season : 1);
    if (list.length === seasons.size)
      [...seasons]
        .sort((a, b) => a - b)
        .forEach((season, index) => {
          const url = str(list[index]);
          if (url) posters.set(season, url);
        });
  }
  for (const [season, poster] of posters) {
    const details = out.get(season) ?? {};
    if (!details.poster) out.set(season, { ...details, poster });
  }
  return out;
}

function trailersFrom(meta: AnyMeta): { Name: string; Url: string }[] {
  const trailers: { Name: string; Url: string }[] = [];
  const add = (name: string, url: string) => {
    if (!trailers.some((t) => t.Url === url))
      trailers.push({ Name: name, Url: url });
  };
  for (const t of Array.isArray(meta.trailerStreams)
    ? meta.trailerStreams
    : []) {
    const yt = isObject(t) ? str(t.ytId) : undefined;
    if (yt)
      add(str(t.title) ?? 'Trailer', `https://www.youtube.com/watch?v=${yt}`);
  }
  for (const t of meta.trailers ?? []) {
    const source = str(t.source);
    if (!source) continue;
    add(
      str((t as AnyObject).name) ?? str(t.type) ?? 'Trailer',
      source.startsWith('http')
        ? source
        : `https://www.youtube.com/watch?v=${source}`
    );
  }
  return trailers;
}

const AIR_DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export function readEnrichment(input: MetaPreview | Meta): Enrichment {
  const meta = input as AnyMeta;
  const extras = isObject(meta.app_extras) ? meta.app_extras : {};
  const stability = isObject(meta._stability) ? meta._stability : {};
  const country = str(meta.country);

  return {
    providerIds: providerIdsFrom(meta),
    originalTitle: str(meta.originalTitle),
    tagline: str(meta.tagline),
    thumb: str(meta.landscapePoster),
    logo: str(meta.logo),
    people: peopleFrom(meta),
    seasons: seasonsFrom(meta, extras),
    certification:
      str(meta.certification) ??
      str(meta.ageRating) ??
      str(extras.certification),
    customRating:
      str(meta.certificationLocal) ?? str(extras.certificationLocal),
    criticRating: criticRatingFrom(meta, extras),
    studios: strings([...(meta.studios ?? []), ...(meta.networks ?? [])]),
    countries: meta.countries?.length
      ? strings(meta.countries)
      : strings(country?.split(',')),
    tags: strings(meta.tags),
    trailers: trailersFrom(meta),
    status: statusFrom(meta),
    endDate:
      toIso(meta.endDate) ??
      toIso(meta.lastAirDate) ??
      toIso(stability.endDate),
    airDays: AIR_DAYS.filter((d) => meta.airDays?.includes(d)),
    airTime: str(meta.airTime),
    year:
      parseYear(meta.year) ??
      parseYear(meta.releaseInfo) ??
      parseYear(meta.released),
    premiere: toIso(meta.released),
    runtimeMs: parseRuntimeMs(meta.runtime),
    genreTargets: genreTargetsFrom(meta),
  };
}

export function readVideoEnrichment(
  video: NonNullable<ParsedMeta['videos']>[number]
): VideoEnrichment {
  return {
    providerIds: providerIdsFrom(video),
    rating: upTo(10, video.rating),
    runtimeMs: parseRuntimeMs(video.runtime),
    people: declaredPeople(video.people),
  };
}

/* Codes some subtitle sources use that are not ISO 639. */
const SUBTITLE_LANG_ALIASES: Record<string, string> = {
  pob: 'pt-br',
  zht: 'zh-tw',
  spn: 'es-419',
};

function languageOf(text: string): Omit<SubtitleLanguage, 'exact'> | null {
  const value = SUBTITLE_LANG_ALIASES[text.toLowerCase()] ?? text;
  const name = normaliseLanguage(value);
  const code = languageToIso6392(name ?? normaliseLangCode(value));
  if (!code) return null;
  const iso1 = iso6392ToIso6391(code);
  return { code, name: name ?? (iso1 && iso6391ToLanguage(iso1)) ?? code };
}

function withoutMarks(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '');
}

function languageIn(text: string): Omit<SubtitleLanguage, 'exact'> | null {
  return languageOf(text) ?? languageOf(withoutMarks(text));
}

const SUBTITLE_LANGUAGE_CACHE = new Map<string, SubtitleLanguage>();

/** `lang` is a code or a name, sometimes among other words. */
export function subtitleLanguage(lang: string): SubtitleLanguage {
  const cached = SUBTITLE_LANGUAGE_CACHE.get(lang);
  if (cached) return cached;
  if (/^\s*(und|mul)\s*$/i.test(lang)) return { exact: true };
  const whole = languageIn(lang.trim());
  let result: SubtitleLanguage = { ...whole, exact: !!whole };
  if (!whole) {
    for (const word of lang.split(/[^\p{L}\p{M}]+/u)) {
      const found = word.length >= 4 ? languageIn(word) : null;
      if (found) {
        result = { ...found, exact: false };
        break;
      }
    }
  }
  if (SUBTITLE_LANGUAGE_CACHE.size >= 1000) SUBTITLE_LANGUAGE_CACHE.clear();
  SUBTITLE_LANGUAGE_CACHE.set(lang, result);
  return result;
}

const SUBTITLE_EXTENSION = /(?:\.(?:srt|vtt|ass|ssa|sub|smi|txt))+$/i;
/* A year, an episode or a resolution tells a release name from an opaque file name. */
const RELEASE_HINT = /\b(?:19|20)\d{2}\b|\bS\d{1,2}E\d{1,3}\b|\b\d{3,4}p\b/i;

function withoutExtension(name: unknown): string | undefined {
  return str(str(name)?.replace(SUBTITLE_EXTENSION, ''));
}

/** An id of the form `[tags]Release_N`. */
function releaseFromId(id: string): string | undefined {
  const m = /^((?:\[[^\]]*\])*)(.+)_\d+$/.exec(id);
  if (!m || !(m[1] || /[.\s-]/.test(m[2]))) return undefined;
  return m[1] ? `${m[1]} ${m[2]}` : m[2];
}

function releaseFromUrl(url: string): string | undefined {
  try {
    const file = decodeURIComponent(new URL(url).pathname.split('/').pop()!);
    const name = withoutExtension(file);
    return name && name !== file && RELEASE_HINT.test(name) ? name : undefined;
  } catch {
    return undefined;
  }
}

const HEARING_IMPAIRED_CUES = [
  /\bsdh\b/i,
  /hearing[\s._-]?impaired/i,
  /\[(?:hi|cc)\]/i,
  /(?:^|[\s._\-(])(?:HI|CC)(?:$|[\s._\-)])/,
];

/** Subtitle fields (`reference/addon-protocol/subtitles`); a documented name wins over a fallback. */
export function readSubtitleEnrichment(input: Subtitle): SubtitleEnrichment {
  const sub = input as Subtitle & AnyObject;
  const language = subtitleLanguage(sub.lang);
  const title =
    str(sub.label) ??
    str(sub.title) ??
    withoutExtension(sub.subtitleFileName) ??
    releaseFromId(sub.id) ??
    releaseFromUrl(sub.url) ??
    (language.exact
      ? undefined
      : str(sub.lang.replace(/^[\s.\-_:|]+|[\s.\-_:|]+$/g, '')));
  const cues = [title, sub.lang].join(' ');
  return {
    title,
    forced:
      typeof sub.forced === 'boolean' ? sub.forced : /\bforced\b/i.test(cues),
    hearingImpaired:
      typeof sub.hearingImpaired === 'boolean'
        ? sub.hearingImpaired
        : HEARING_IMPAIRED_CUES.some((re) => re.test(cues)),
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
