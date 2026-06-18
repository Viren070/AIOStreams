/**
 * Source-agnostic type definitions for the AnimeDatabase.
 *
 * Each external dataset (Fribb, Manami, Kitsu↔IMDB, Anitrakt, Anime-List XML,
 * AnimeApi, …) is parsed into a uniform {@link SourceEntry} which the merger
 * unions into canonical {@link AnimeRecord}s by shared anime-identifying ids
 * (anidb / mal / anilist / kitsu / livechart / simkl / notify.moe). Public
 * lookups return an {@link AnimeEntry} built from a chosen record.
 */
import type { IdType } from '../utils/id-parser.js';

export enum AnimeType {
  TV = 'TV',
  SPECIAL = 'SPECIAL',
  OVA = 'OVA',
  MOVIE = 'MOVIE',
  ONA = 'ONA',
  UNKNOWN = 'UNKNOWN',
}

export enum AnimeStatus {
  CURRENT = 'CURRENT',
  FINISHED = 'FINISHED',
  UPCOMING = 'UPCOMING',
  UNKNOWN = 'UNKNOWN',
  ONGOING = 'ONGOING',
}

export enum AnimeSeason {
  WINTER = 'WINTER',
  SPRING = 'SPRING',
  SUMMER = 'SUMMER',
  FALL = 'FALL',
  UNDEFINED = 'UNDEFINED',
}

export type IdValue = string | number;

/**
 * Single anidb-season → tvdb/tmdb-season mapping rule from the Anime-List XML
 * (`anime-list-master.xml`), preserved for episode-range disambiguation.
 */
export interface AnimeListMapping {
  anidbSeason: number;
  tvdbSeason?: number;
  tmdbSeason?: number;
  start?: number;
  end?: number;
  offset?: number;
  episodes?: string;
}

export interface ImdbHints {
  title?: string;
  /** Season number on IMDb where this canonical record starts. */
  fromSeason?: number;
  /** Episode number within the IMDb season where this record starts. */
  fromEpisode?: number;
  /** Anidb-relative episode numbers that have no IMDb counterpart. */
  nonImdbEpisodes?: number[];
}

export interface TvdbHints {
  /** TVDB season number; `'a'` = absolute numbering. */
  seasonNumber?: number | 'a' | null;
  seasonId?: number | null;
  /** Episode number on TVDB where this record's first anidb episode lives. */
  fromEpisode?: number | null;
  /** Detailed per-anidb-season → tvdb/tmdb-season mappings (XML). */
  episodeMappings?: AnimeListMapping[];
}

export interface TmdbHints {
  type?: 'movie' | 'tv';
  seasonNumber?: number | null;
  seasonId?: number | null;
  fromEpisode?: number | null;
}

export interface TraktHints {
  id?: number;
  slug?: string;
  title?: string;
  type?: 'movies' | 'shows';
  isSplitCour?: boolean;
  seasonNumber?: number | null;
  seasonId?: number | null;
  /** Whether trakt+tmdb wrongly merged a split cour into one season. */
  mayInvalid?: boolean;
}

export interface FanartHints {
  logoId?: number;
}

/**
 * The canonical, source-agnostic anime record. One record is the granularity
 * of a single MAL/AniDB id (i.e. typically one cour of a show); a parent
 * IMDb/TVDB show may be referenced by multiple records.
 */
export interface AnimeRecord {
  /** Stable internal index into the records array. */
  rid: number;
  type: AnimeType;
  ids: Partial<Record<IdType, IdValue>>;
  title?: string;
  synonyms?: string[];
  animeSeason?: { season: AnimeSeason; year: number | null };
  imdb?: ImdbHints;
  tvdb?: TvdbHints;
  tmdb?: TmdbHints;
  trakt?: TraktHints;
  fanart?: FanartHints;
}

/**
 * Partial canonical record emitted by an individual source. The merger unions
 * these into {@link AnimeRecord}s by shared anime-identifying ids.
 */
export interface SourceEntry {
  type?: AnimeType;
  ids: Partial<Record<IdType, IdValue>>;
  title?: string;
  synonyms?: string[];
  animeSeason?: { season: AnimeSeason; year: number | null };
  imdb?: ImdbHints;
  tvdb?: TvdbHints;
  tmdb?: TmdbHints;
  trakt?: TraktHints;
  fanart?: FanartHints;
}

/**
 * IDs that uniquely identify a single anime entry (cour-level). Used by the
 * merger as the union-find keys; sharing any one of these between two
 * SourceEntries means they describe the same record.
 *
 * Excludes show-level ids (imdb / tmdb / tvdb / trakt) which can legitimately
 * be shared by multiple cours of the same parent show.
 */
export const ANIME_IDENTIFYING_ID_TYPES: readonly IdType[] = [
  'anidbId',
  'malId',
  'anilistId',
  'kitsuId',
  'livechartId',
  'simklId',
  'notifyMoeId',
  'animePlanetId',
  'animecountdownId',
  'anisearchId',
] as const;

// ---------------------------------------------------------------------------
// Public API surface (consumed by streams/, metadata/, builtins/, …)
// ---------------------------------------------------------------------------

/** Fribb-style mappings block embedded in {@link AnimeEntry}. */
export interface AnimeEntryMappings {
  animePlanetId?: string | number;
  animecountdownId?: number;
  anidbId?: number;
  anilistId?: number;
  anisearchId?: number;
  imdbId?: string | null;
  kitsuId?: number;
  livechartId?: number;
  malId?: number;
  notifyMoeId?: string;
  simklId?: number;
  themoviedbId?: number;
  thetvdbId?: number | null;
  traktId?: number;
}

/** Public anime entry returned by {@link AnimeDatabase.getEntryById}. */
export interface AnimeEntry {
  mappings?: AnimeEntryMappings;
  type: AnimeType;
  imdb?: {
    seasonNumber?: number;
    fromEpisode?: number;
    nonImdbEpisodes?: number[];
    title?: string;
  } | null;
  fanart?: { logoId: number } | null;
  trakt?: {
    title: string;
    slug: string;
    isSplitCour?: boolean;
    seasonId?: number | null;
    seasonNumber?: number | null;
  } | null;
  tmdb: {
    seasonNumber: number | null;
    seasonId: number | null;
    fromEpisode?: number | null;
  };
  tvdb: {
    seasonNumber: number | null;
    seasonId: number | null;
    fromEpisode?: number | null;
  };
  title?: string;
  animeSeason?: { season: AnimeSeason; year: number | null };
  synonyms?: string[];
  episodeMappings?: AnimeListMapping[];
}
