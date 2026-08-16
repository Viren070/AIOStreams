import { Metadata, MetadataTitle, deduplicateTitles } from './utils.js';

export type MediaType = 'movie' | 'series';

export type MetadataSource =
  | 'anime'
  | 'request'
  | 'tmdb'
  | 'tvdb'
  | 'skyhook'
  | 'trakt'
  | 'cinemeta'
  | 'imdbSuggestion'
  | 'tmdbEpisode'
  | 'scene';

/** Plain array when movies and series agree, split when they do not. */
export type SourcePriority =
  | readonly MetadataSource[]
  | {
      readonly movie: readonly MetadataSource[];
      readonly series: readonly MetadataSource[];
    };

function forType(
  priority: SourcePriority,
  mediaType: MediaType
): readonly MetadataSource[] {
  return Array.isArray(priority)
    ? priority
    : (priority as Exclude<SourcePriority, readonly MetadataSource[]>)[
        mediaType
      ];
}

/** Absent fields are not contributed. */
export interface SourceContribution {
  year?: number;
  yearEnd?: number;
  originalLanguage?: string;
  country?: string;
  releaseDate?: string;
  runtime?: number;
  seasons?: { season_number: number; episode_count: number }[];
  genres?: string[];
  nextAirDate?: string;
  firstAiredDate?: string;
  lastAiredDate?: string;
  tmdbId?: number | null;
  tvdbId?: number | null;
  /** The source's own canonical title. */
  primaryTitle?: string;
  /** Alternate titles the source knows about. */
  aliases?: MetadataTitle[];
}

export type SourceContributions = Partial<
  Record<MetadataSource, SourceContribution>
>;

type PickedField = keyof typeof FIELD_PRIORITY;

/**
 * Strongest first: the first source offering a value wins and nothing weaker
 * can displace it. `genres` is absent (see GENRE_SOURCES); `year`/`yearEnd` are
 * ordered here but resolved jointly (see resolveYears).
 */
const FIELD_PRIORITY = {
  year: ['tvdb', 'tmdb', 'anime', 'skyhook', 'cinemeta', 'imdbSuggestion'],
  yearEnd: ['tvdb', 'tmdb', 'cinemeta', 'imdbSuggestion'],
  originalLanguage: ['tmdb', 'tvdb', 'skyhook'],
  country: ['tvdb', 'tmdb', 'skyhook'],
  releaseDate: ['tmdb', 'cinemeta'],
  runtime: ['tmdb', 'tvdb', 'skyhook', 'cinemeta'],
  seasons: ['cinemeta', 'tmdb', 'skyhook'],
  nextAirDate: ['tvdb', 'tmdbEpisode'],
  firstAiredDate: ['tvdb', 'skyhook', 'tmdb'],
  lastAiredDate: ['tvdb', 'skyhook', 'tmdb'],
  tmdbId: ['tmdb', 'request', 'skyhook'],
  tvdbId: ['tvdb', 'request', 'skyhook'],
} as const satisfies Partial<Record<keyof SourceContribution, SourcePriority>>;

/** Genres accumulate across these sources instead of one winning outright. */
const GENRE_SOURCES: SourcePriority = ['tmdb', 'skyhook', 'cinemeta'];

/** Which source's canonical title becomes `metadata.title`. */
const PRIMARY_TITLE_PRIORITY: SourcePriority = {
  movie: ['tmdb', 'tvdb', 'skyhook', 'cinemeta', 'imdbSuggestion'],
  series: ['tvdb', 'skyhook', 'tmdb', 'cinemeta', 'imdbSuggestion'],
};

/**
 * Position matters beyond `titles[0]`: consumers treat earlier entries as more
 * canonical, and deduplication keeps the first occurrence of a title.
 */
const TITLE_ORDER: readonly {
  source: MetadataSource;
  kind: 'primary' | 'aliases';
}[] = [
  { source: 'imdbSuggestion', kind: 'primary' },
  { source: 'cinemeta', kind: 'primary' },
  { source: 'tvdb', kind: 'primary' },
  { source: 'tmdb', kind: 'primary' },
  { source: 'anime', kind: 'aliases' },
  { source: 'tmdb', kind: 'aliases' },
  { source: 'tvdb', kind: 'aliases' },
  { source: 'skyhook', kind: 'aliases' },
  { source: 'trakt', kind: 'aliases' },
  { source: 'scene', kind: 'aliases' },
];

const WHOLE_SHOW_ALIAS_SOURCES: MetadataSource[] = ['tmdb', 'tvdb', 'trakt'];

/** Which source won a field, or undefined if none offered it. */
export function resolveSource(
  contributions: SourceContributions,
  field: PickedField,
  mediaType: MediaType
): MetadataSource | undefined {
  for (const source of forType(FIELD_PRIORITY[field], mediaType)) {
    if (contributions[source]?.[field]) return source;
  }
  return undefined;
}

function resolve<K extends PickedField>(
  contributions: SourceContributions,
  field: K,
  mediaType: MediaType
): SourceContribution[K] | undefined {
  const source = resolveSource(contributions, field, mediaType);
  return source ? contributions[source]?.[field] : undefined;
}

/**
 * Cinemeta parses year and yearEnd out of one `releaseInfo` string, so its pair
 * applies together and only when no stronger source has a year. A range whose
 * start will not parse yields a yearEnd with no year, leaving weaker sources
 * free to supply one. Hence one function rather than two lookups.
 */
function resolveYears(
  contributions: SourceContributions,
  mediaType: MediaType
): { year?: number; yearEnd?: number } {
  const yearOrder = forType(FIELD_PRIORITY.year, mediaType);
  const yearEndOrder = forType(FIELD_PRIORITY.yearEnd, mediaType);
  const cinemetaAt = yearEndOrder.indexOf('cinemeta');

  let year: number | undefined;
  let yearEnd: number | undefined;

  // yearEnd sources that outrank cinemeta resolve independently of year
  for (const source of cinemetaAt === -1
    ? yearEndOrder
    : yearEndOrder.slice(0, cinemetaAt)) {
    const value = contributions[source]?.yearEnd;
    if (value) {
      yearEnd = value;
      break;
    }
  }

  for (const source of yearOrder) {
    const contribution = contributions[source];
    if (!contribution) continue;
    if (source === 'cinemeta') {
      if (contribution.year === undefined && contribution.yearEnd === undefined)
        continue;
      year = contribution.year;
      if (contribution.yearEnd !== undefined) yearEnd = contribution.yearEnd;
      if (year) break;
      continue;
    }
    if (contribution.year) {
      year = contribution.year;
      break;
    }
  }

  if (!yearEnd && cinemetaAt !== -1) {
    for (const source of yearEndOrder.slice(cinemetaAt + 1)) {
      const value = contributions[source]?.yearEnd;
      if (value) {
        yearEnd = value;
        break;
      }
    }
  }

  // Release names follow IMDb, so it decides when TVDB and TMDB disagree. Only
  // ever one of their two values: an odd IMDb record cannot invent a year.
  const tvdbYear = contributions.tvdb?.year;
  const tmdbYear = contributions.tmdb?.year;
  const imdbYear = contributions.imdbSuggestion?.year;
  if (
    tvdbYear &&
    tmdbYear &&
    tvdbYear !== tmdbYear &&
    (imdbYear === tvdbYear || imdbYear === tmdbYear)
  ) {
    year = imdbYear;
  }

  return { year, yearEnd };
}

/**
 * The title list before the winning primary title is prepended. Exposed because
 * scene mappings key off this list's head, not `metadata.title`.
 */
export function assembleTitles(
  contributions: SourceContributions,
  options?: { suppressWholeShowAliases?: boolean }
): MetadataTitle[] {
  const titles: MetadataTitle[] = [];
  for (const { source, kind } of TITLE_ORDER) {
    const contribution = contributions[source];
    if (!contribution) continue;
    if (kind === 'primary') {
      if (contribution.primaryTitle)
        titles.push({ title: contribution.primaryTitle });
    } else if (contribution.aliases?.length) {
      if (
        options?.suppressWholeShowAliases &&
        WHOLE_SHOW_ALIAS_SOURCES.includes(source)
      ) {
        continue;
      }
      titles.push(...contribution.aliases);
    }
  }
  return titles;
}

export type MergedMetadata = Pick<
  Metadata,
  | 'title'
  | 'titles'
  | 'year'
  | 'yearEnd'
  | 'originalLanguage'
  | 'country'
  | 'releaseDate'
  | 'runtime'
  | 'seasons'
  | 'genres'
  | 'nextAirDate'
  | 'firstAiredDate'
  | 'lastAiredDate'
  | 'tmdbId'
  | 'tvdbId'
> & {
  titles: MetadataTitle[];
  /** How many titles were offered before deduplication. Diagnostic only. */
  titleCandidateCount: number;
};

/** Returns `title: ''` when no source had one; callers decide if that is fatal. */
export function mergeMetadata(
  contributions: SourceContributions,
  mediaType: MediaType,
  options?: { suppressWholeShowAliases?: boolean }
): MergedMetadata {
  const primaryTitle = forType(PRIMARY_TITLE_PRIORITY, mediaType)
    .map((source) => contributions[source]?.primaryTitle)
    .find(Boolean);

  const originalLanguage = resolve(
    contributions,
    'originalLanguage',
    mediaType
  );

  const titles = assembleTitles(contributions, options);
  if (primaryTitle) titles.unshift({ title: primaryTitle });
  const uniqueTitles = deduplicateTitles(titles, originalLanguage);

  const genres = [
    ...new Set(
      forType(GENRE_SOURCES, mediaType).flatMap(
        (source) => contributions[source]?.genres ?? []
      )
    ),
  ];

  const { year, yearEnd } = resolveYears(contributions, mediaType);

  return {
    title: uniqueTitles[0]?.title ?? '',
    titles: uniqueTitles,
    titleCandidateCount: titles.length,
    year,
    yearEnd,
    originalLanguage,
    country: resolve(contributions, 'country', mediaType),
    releaseDate: resolve(contributions, 'releaseDate', mediaType),
    runtime: resolve(contributions, 'runtime', mediaType),
    seasons: resolve(contributions, 'seasons', mediaType),
    genres,
    nextAirDate: resolve(contributions, 'nextAirDate', mediaType),
    firstAiredDate: resolve(contributions, 'firstAiredDate', mediaType),
    lastAiredDate: resolve(contributions, 'lastAiredDate', mediaType),
    tmdbId: resolve(contributions, 'tmdbId', mediaType) ?? null,
    tvdbId: resolve(contributions, 'tvdbId', mediaType) ?? null,
  };
}
