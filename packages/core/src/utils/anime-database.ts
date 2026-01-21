import path from 'path';
import fs from 'fs/promises';
import {
  getDataFolder,
  makeRequest,
  getTimeTakenSincePoint,
  IdParser,
  IdType,
  ID_TYPES,
  Env,
  withRetry,
  ParsedId,
} from './index.js';
import { createWriteStream } from 'fs';
import { createLogger } from './logger.js';
import { Parser } from 'xml2js';

const logger = createLogger('anime-database');

// --- Constants for Data Sources ---
const ANIME_DATABASE_PATH = path.join(getDataFolder(), 'anime-database');

const DATA_SOURCES = {
  fribbMappings: {
    name: 'Fribb Mappings',
    url: 'https://raw.githubusercontent.com/Fribb/anime-lists/refs/heads/master/anime-list-full.json',
    filePath: path.join(ANIME_DATABASE_PATH, 'fribb-mappings.json'),
    etagPath: path.join(ANIME_DATABASE_PATH, 'fribb-mappings.etag'),
    loader: 'loadFribbMappings',
    refreshInterval: Env.ANIME_DB_FRIBB_MAPPINGS_REFRESH_INTERVAL,
    dataKey: 'fribbMappingsById',
  },
  manami: {
    name: 'Manami DB',
    url: 'https://github.com/manami-project/anime-offline-database/releases/download/latest/anime-offline-database-minified.json',
    filePath: path.join(ANIME_DATABASE_PATH, 'manami-db.json'),
    etagPath: path.join(ANIME_DATABASE_PATH, 'manami-db.etag'),
    loader: 'loadManamiDb',
    refreshInterval: Env.ANIME_DB_MANAMI_DB_REFRESH_INTERVAL,
    dataKey: 'manamiById',
  },
  kitsuImdb: {
    name: 'Kitsu IMDB Mapping',
    url: 'https://raw.githubusercontent.com/TheBeastLT/stremio-kitsu-anime/master/static/data/imdb_mapping.json',
    filePath: path.join(ANIME_DATABASE_PATH, 'kitsu-imdb-mapping.json'),
    etagPath: path.join(ANIME_DATABASE_PATH, 'kitsu-imdb-mapping.etag'),
    loader: 'loadKitsuImdbMapping',
    refreshInterval: Env.ANIME_DB_KITSU_IMDB_MAPPING_REFRESH_INTERVAL,
    dataKey: 'kitsuById',
  },
  anitraktMovies: {
    name: 'Extended Anitrakt Movies',
    url: 'https://github.com/rensetsu/db.trakt.extended-anitrakt/releases/download/latest/movies_ex.json',
    filePath: path.join(ANIME_DATABASE_PATH, 'anitrakt-movies-ex.json'),
    etagPath: path.join(ANIME_DATABASE_PATH, 'anitrakt-movies-ex.etag'),
    loader: 'loadExtendedAnitraktMovies',
    refreshInterval: Env.ANIME_DB_EXTENDED_ANITRAKT_MOVIES_REFRESH_INTERVAL,
    dataKey: 'extendedAnitraktMoviesById',
  },
  anitraktTv: {
    name: 'Extended Anitrakt TV',
    url: 'https://github.com/rensetsu/db.trakt.extended-anitrakt/releases/download/latest/tv_ex.json',
    filePath: path.join(ANIME_DATABASE_PATH, 'anitrakt-tv-ex.json'),
    etagPath: path.join(ANIME_DATABASE_PATH, 'anitrakt-tv-ex.etag'),
    loader: 'loadExtendedAnitraktTv',
    refreshInterval: Env.ANIME_DB_EXTENDED_ANITRAKT_TV_REFRESH_INTERVAL,
    dataKey: 'extendedAnitraktTvById',
  },
  animeList: {
    name: 'Anime Lists XML',
    url: 'https://raw.githubusercontent.com/Anime-Lists/anime-lists/refs/heads/master/anime-list-master.xml',
    filePath: path.join(ANIME_DATABASE_PATH, 'anime-list-master.xml'),
    etagPath: path.join(ANIME_DATABASE_PATH, 'anime-list-master.etag'),
    loader: 'loadAnimeList',
    refreshInterval: Env.ANIME_DB_ANIME_LIST_REFRESH_INTERVAL,
    dataKey: 'animeListById',
  },
} as const;

const extractIdFromUrl: {
  [K in
    | 'anidbId'
    | 'anilistId'
    | 'animePlanetId'
    | 'animecountdownId'
    | 'anisearchId'
    | 'imdbId'
    | 'kitsuId'
    | 'livechartId'
    | 'malId'
    | 'notifyMoeId'
    | 'simklId'
    | 'themoviedbId'
    | 'thetvdbId']?: (url: string) => string | null;
} = {
  anidbId: (url: string) => {
    const match = url.match(/anidb\.net\/anime\/(\d+)/);
    return match ? match[1] : null;
  },
  anilistId: (url: string) => {
    const match = url.match(/anilist\.co\/anime\/(\d+)/);
    return match ? match[1] : null;
  },
  animePlanetId: (url: string) => {
    const match = url.match(/anime-planet\.com\/anime\/(\w+)/);
    return match ? match[1] : null;
  },
  animecountdownId: (url: string) => {
    const match = url.match(/animecountdown\.com\/(\d+)/);
    return match ? match[1] : null;
  },
  anisearchId: (url: string) => {
    const match = url.match(/anisearch\.com\/anime\/(\d+)/);
    return match ? match[1] : null;
  },
  kitsuId: (url: string) => {
    const match = url.match(/kitsu\.app\/anime\/(\d+)/);
    return match ? match[1] : null;
  },
  livechartId: (url: string) => {
    const match = url.match(/livechart\.me\/anime\/(\d+)/);
    return match ? match[1] : null;
  },
  malId: (url: string) => {
    const match = url.match(/myanimelist\.net\/anime\/(\d+)/);
    return match ? match[1] : null;
  },
  notifyMoeId: (url: string) => {
    const match = url.match(/notify\.moe\/anime\/(\w+)/);
    return match ? match[1] : null;
  },
  simklId: (url: string) => {
    const match = url.match(/simkl\.com\/anime\/(\d+)/);
    return match ? match[1] : null;
  },
};

// --- Types and Interfaces ---

enum AnimeType {
  TV = 'TV',
  SPECIAL = 'SPECIAL',
  OVA = 'OVA',
  MOVIE = 'MOVIE',
  ONA = 'ONA',
  UNKNOWN = 'UNKNOWN',
}

enum AnimeStatus {
  CURRENT = 'CURRENT',
  FINISHED = 'FINISHED',
  UPCOMING = 'UPCOMING',
  UNKNOWN = 'UNKNOWN',
  ONGOING = 'ONGOING',
}

enum AnimeSeason {
  WINTER = 'WINTER',
  SPRING = 'SPRING',
  SUMMER = 'SUMMER',
  FALL = 'FALL',
  UNDEFINED = 'UNDEFINED',
}
// Interfaces and Types
interface MappingEntry {
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
  type: AnimeType;
  season?:
    | {
        tvdb?: number;
        tmdb?: number;
      }
    | undefined;
}

interface ManamiEntry {
  sources: string[];
  title: string;
  type: AnimeType;
  episodes: number;
  status: AnimeStatus;
  animeSeason: {
    season: AnimeSeason;
    year: number | null;
  };
  picture: string | null;
  thumbnail: string | null;
  duration: {
    value: number;
    unit: 'SECONDS';
  } | null;
  score: {
    arithmeticGeometricMean: number;
    arithmeticMean: number;
    median: number;
  } | null;
  synonyms: string[];
  studios: string[];
  producers: string[];
  relatedAnime: string[];
  tags: string[];
}

interface MinimisedManamiEntry {
  title: string;
  animeSeason: {
    season: AnimeSeason;
    year: number | null;
  };
  synonyms: string[];
}

interface KitsuEntry {
  fanartLogoId?: number;
  tvdbId?: number;
  imdbId?: string;
  title?: string;
  fromSeason?: number;
  fromEpisode?: number;
  nonImdbEpisodes?: number[];
}

interface ExtendedAnitraktMovieEntry {
  myanimelist: {
    title: string;
    id: number;
  };
  trakt: {
    title: string;
    id: number;
    slug: string;
    type: 'movies';
  };
  releaseYear: number;
  externals: {
    tmdb?: number | null;
    imdb?: string | null;
    letterboxd?: {
      slug: string | null;
      lid: string | null;
      uid: number | null;
    } | null;
  };
}

interface ExtendedAnitraktTvEntry {
  myanimelist: {
    title: string;
    id: number;
  };
  trakt: {
    title: string;
    id: number;
    slug: string;
    type: 'shows';
    isSplitCour: boolean;
    season: {
      id: number;
      number: number;
      externals: {
        tvdb: number | null;
        tmdb: number | null;
      };
    } | null;
  };
  releaseYear: number;
  externals: {
    tvdb?: number | null;
    tmdb?: number | null;
    imdb?: string | null;
  };
}

interface AnimeListMapping {
  anidbSeason: number;
  tvdbSeason?: number;
  tmdbSeason?: number;
  start?: number;
  end?: number;
  offset?: number;
  episodes?: string;
}

interface AnimeListEntry {
  anidbId: number;
  tvdbId?: number | null;
  defaultTvdbSeason?: number | 'a' | null; // 'a' means absolute numbering
  episodeOffset?: number | null;
  tmdbTv?: number | null;
  tmdbSeason?: number | null;
  tmdbOffset?: number | null;
  tmdbId?: number | null;
  imdbId?: string | null;
  mappings?: AnimeListMapping[];
  before?: string;
}

interface AnimeEntry {
  mappings?: Omit<MappingEntry, 'type'>;
  type: AnimeType;
  imdb?: {
    seasonNumber?: number;
    fromEpisode?: number;
    nonImdbEpisodes?: number[];
    title?: string;
  } | null;
  fanart?: {
    logoId: number;
  } | null;
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
    fromEpisode?: number | null; // Episode offset from AnimeList
  };
  tvdb: {
    seasonNumber: number | null;
    seasonId: number | null;
    fromEpisode?: number | null; // Episode offset from AnimeList
  };
  title?: string;
  animeSeason?: {
    season: AnimeSeason;
    year: number | null;
  };
  synonyms?: string[];
  episodeMappings?: AnimeListMapping[];
}

// Validation functions
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function validateMappingEntry(data: any): MappingEntry | null {
  if (!data || typeof data !== 'object') return null;

  const season = data['season'];
  if (season !== undefined && typeof season !== 'object') return null;
  if (
    season &&
    ((season.tmdb !== undefined && typeof season.tmdb !== 'number') ||
      (season.tvdb !== undefined && typeof season.tvdb !== 'number'))
  )
    return null;

  // Transform raw data to match our interface
  const entry: MappingEntry = {
    animePlanetId: data['anime-planet_id'],
    animecountdownId: data['animecountdown_id'],
    anidbId: data['anidb_id'],
    anilistId: data['anilist_id'],
    anisearchId: data['anisearch_id'],
    imdbId: data['imdb_id'],
    kitsuId: data['kitsu_id'],
    livechartId: data['livechart_id'],
    malId: data['mal_id'],
    notifyMoeId: data['notify.moe_id'],
    simklId: data['simkl_id'],
    themoviedbId:
      typeof data['themoviedb_id'] === 'string'
        ? parseInt(data['themoviedb_id'])
        : data['themoviedb_id'],
    thetvdbId: data['thetvdb_id'] || data['tvdb_id'],
    traktId: data['trakt_id'],
    type: data['type'] ?? AnimeType.UNKNOWN,
    season: data['season'],
  };

  // Validate type
  if (!Object.values(AnimeType).includes(entry.type)) {
    return null;
  }

  return entry;
}

function validateManamiEntry(data: any): ManamiEntry | null {
  if (!data || typeof data !== 'object') return null;

  // Basic type checks
  if (!Array.isArray(data.sources) || !data.sources.every(isValidUrl))
    return null;
  if (typeof data.title !== 'string') return null;
  if (!Object.values(AnimeType).includes(data.type)) return null;
  if (typeof data.episodes !== 'number') return null;
  if (!Object.values(AnimeStatus).includes(data.status)) return null;

  // Validate animeSeason
  if (
    !data.animeSeason ||
    !Object.values(AnimeSeason).includes(data.animeSeason.season) ||
    (data.animeSeason.year !== null &&
      data.animeSeason.year !== undefined &&
      typeof data.animeSeason.year !== 'number')
  ) {
    return null;
  }

  // Validate arrays
  if (
    !Array.isArray(data.synonyms) ||
    !data.synonyms.every((s: unknown) => typeof s === 'string')
  )
    return null;
  if (
    !Array.isArray(data.studios) ||
    !data.studios.every((s: unknown) => typeof s === 'string')
  )
    return null;
  if (
    !Array.isArray(data.producers) ||
    !data.producers.every((s: unknown) => typeof s === 'string')
  )
    return null;
  if (
    !Array.isArray(data.relatedAnime) ||
    !data.relatedAnime.every((s: unknown) => isValidUrl(s as string))
  )
    return null;
  if (
    !Array.isArray(data.tags) ||
    !data.tags.every((s: unknown) => typeof s === 'string')
  )
    return null;

  return data as ManamiEntry;
}

function validateKitsuEntry(data: any): KitsuEntry | null {
  if (!data || typeof data !== 'object') return null;

  const entry: KitsuEntry = {
    fanartLogoId:
      typeof data.fanartLogoId === 'string'
        ? parseInt(data.fanartLogoId)
        : data.fanartLogoId,
    tvdbId:
      typeof data.tvdb_id === 'string' ? parseInt(data.tvdb_id) : data.tvdb_id,
    imdbId: data.imdb_id,
    title: data.title,
    fromSeason: data.fromSeason,
    fromEpisode: data.fromEpisode,
    nonImdbEpisodes: data.nonImdbEpisodes,
  };

  // All fields are optional, just validate types
  if (
    entry.fanartLogoId !== undefined &&
    typeof entry.fanartLogoId !== 'number'
  )
    return null;
  if (entry.tvdbId !== undefined && typeof entry.tvdbId !== 'number')
    return null;
  if (entry.imdbId !== undefined && typeof entry.imdbId !== 'string')
    return null;
  if (entry.title !== undefined && typeof entry.title !== 'string') return null;
  if (entry.fromSeason !== undefined && typeof entry.fromSeason !== 'number')
    return null;
  if (entry.fromEpisode !== undefined && typeof entry.fromEpisode !== 'number')
    return null;

  return entry;
}

function validateExtendedAnitraktMovieEntry(
  data: any
): ExtendedAnitraktMovieEntry | null {
  if (!data || typeof data !== 'object') return null;

  // Validate required nested objects
  if (!data.myanimelist?.title || typeof data.myanimelist.id !== 'number')
    return null;
  if (
    !data.trakt?.title ||
    typeof data.trakt.id !== 'number' ||
    typeof data.trakt.slug !== 'string' ||
    data.trakt.type !== 'movies'
  )
    return null;
  if (typeof data.release_year !== 'number') return null;

  return {
    myanimelist: data.myanimelist,
    trakt: data.trakt,
    releaseYear: data.release_year,
    externals: data.externals,
  };
}

function validateExtendedAnitraktTvEntry(
  data: any
): ExtendedAnitraktTvEntry | null {
  if (!data || typeof data !== 'object') return null;

  // Validate required nested objects
  if (!data.myanimelist?.title || typeof data.myanimelist.id !== 'number')
    return null;
  if (
    !data.trakt?.title ||
    typeof data.trakt.id !== 'number' ||
    typeof data.trakt.slug !== 'string' ||
    data.trakt.type !== 'shows' ||
    typeof data.trakt.is_split_cour !== 'boolean'
  )
    return null;
  if (typeof data.release_year !== 'number') return null;

  return {
    myanimelist: data.myanimelist,
    trakt: {
      title: data.trakt.title,
      id: data.trakt.id,
      slug: data.trakt.slug,
      type: data.trakt.type,
      isSplitCour: data.trakt.is_split_cour,
      season: data.trakt.season,
    },
    releaseYear: data.release_year,
    externals: data.externals,
  };
}

function validateAnimeListEntry(data: any): AnimeListEntry | null {
  if (!data || typeof data !== 'object') return null;

  const attrs = data.$;
  if (!attrs) return null;

  const parseNum = (val: any): number | null => {
    if (val === undefined || val === null || val === '') return null;
    if (typeof val === 'number') return val;
    if (typeof val !== 'string') return null;
    if (['unknown', 'hentai', 'a'].includes(val.toLowerCase())) return null;
    const num = parseInt(val, 10);
    return isNaN(num) ? null : num;
  };

  const parseSeason = (val: any): number | 'a' | null => {
    if (val === undefined || val === null || val === '') return null;
    if (val === 'a' || val === 'A') return 'a';
    return parseNum(val);
  };

  const anidbId = parseNum(attrs.anidbid);
  if (anidbId === null) return null;

  const entry: AnimeListEntry = {
    anidbId,
    tvdbId: parseNum(attrs.tvdbid),
    defaultTvdbSeason: parseSeason(attrs.defaulttvdbseason),
    episodeOffset: parseNum(attrs.episodeoffset),
    tmdbTv: parseNum(attrs.tmdbtv),
    tmdbSeason: parseNum(attrs.tmdbseason),
    tmdbOffset: parseNum(attrs.tmdboffset),
    tmdbId: parseNum(attrs.tmdbid),
    imdbId: attrs.imdbid && attrs.imdbid !== '' ? attrs.imdbid : null,
  };

  if (data.before?.[0]) {
    entry.before = data.before[0];
  }

  if (
    Array.isArray(data['mapping-list']) &&
    Env.ANIME_DB_LEVEL_OF_DETAIL === 'full'
  ) {
    const mappingList = data['mapping-list'][0];
    if (mappingList?.mapping && Array.isArray(mappingList.mapping)) {
      const mappings = mappingList.mapping
        .map((m: any) => {
          const mAttrs = m.$;
          if (!mAttrs) return null;

          const anidbSeason = parseNum(mAttrs.anidbseason);
          if (anidbSeason === null) return null;

          const mapping: AnimeListMapping = {
            anidbSeason,
            tvdbSeason: parseNum(mAttrs.tvdbseason) ?? undefined,
            tmdbSeason: parseNum(mAttrs.tmdbseason) ?? undefined,
            start: parseNum(mAttrs.start) ?? undefined,
            end: parseNum(mAttrs.end) ?? undefined,
            offset: parseNum(mAttrs.offset) ?? undefined,
          };

          if (m._ && typeof m._ === 'string') {
            mapping.episodes = m._;
          }

          return mapping;
        })
        .filter((m: any): m is AnimeListMapping => m !== null);

      if (mappings.length > 0) {
        entry.mappings = mappings;
      }
    }
  }

  return entry;
}

type MappingIdMap = Map<IdType, Map<string | number, MappingEntry[]>>;
type ManamiIdMap = Map<
  IdType,
  Map<string | number, ManamiEntry | MinimisedManamiEntry>
>;
type KitsuIdMap = Map<number, KitsuEntry>;
type ExtendedAnitraktMoviesIdMap = Map<number, ExtendedAnitraktMovieEntry>;
type ExtendedAnitraktTvIdMap = Map<number, ExtendedAnitraktTvEntry>;
type AnimeListIdMap = Map<number, AnimeListEntry>;
type AnimeListByTvdbIdMap = Map<number, AnimeListEntry[]>;

export class AnimeDatabase {
  private static instance: AnimeDatabase;
  private isInitialised = false;

  private dataStore: {
    fribbMappingsById: MappingIdMap;
    manamiById: ManamiIdMap;
    kitsuById: KitsuIdMap;
    extendedAnitraktMoviesById: ExtendedAnitraktMoviesIdMap;
    extendedAnitraktTvById: ExtendedAnitraktTvIdMap;
    animeListById: AnimeListIdMap;
    animeListByTvdbId: AnimeListByTvdbIdMap;
  } = {
    fribbMappingsById: new Map(),
    manamiById: new Map(),
    kitsuById: new Map(),
    extendedAnitraktMoviesById: new Map(),
    extendedAnitraktTvById: new Map(),
    animeListById: new Map(),
    animeListByTvdbId: new Map(),
  };

  // Refresh timers
  private refreshTimers: NodeJS.Timeout[] = [];

  private constructor() {}

  public static getInstance(): AnimeDatabase {
    if (!this.instance) {
      this.instance = new AnimeDatabase();
    }
    return this.instance;
  }

  public async initialise(): Promise<void> {
    if (this.isInitialised) {
      logger.warn('AnimeDatabase is already initialised.');
      return;
    }

    if (Env.ANIME_DB_LEVEL_OF_DETAIL === 'none') {
      logger.info(
        'AnimeDatabase detail level is none, skipping initialisation.'
      );
      this.isInitialised = true;
      return;
    }

    logger.info('Starting initial refresh of all anime data sources...');
    for (const dataSource of Object.values(DATA_SOURCES)) {
      try {
        await this.refreshDataSource(dataSource);
      } catch (error) {
        logger.error(`Failed to refresh data source ${dataSource}: ${error}`);
      }
    }

    this.setupAllRefreshIntervals();
    this.isInitialised = true;
    logger.info('AnimeDatabase initialised successfully.');
  }

  // --- Public Methods for Data Access ---

  public isAnime(id: string): boolean {
    const parsedId = IdParser.parse(id, 'unknown');
    if (
      parsedId &&
      this.getEntryById(
        parsedId.type,
        parsedId.value,
        parsedId.season ? Number(parsedId.season) : undefined,
        parsedId.episode ? Number(parsedId.episode) : undefined
      ) !== null
    ) {
      return true;
    }
    return false;
  }

  public getEntryById(
    idType: IdType,
    idValue: string | number,
    season?: number,
    episode?: number
  ): AnimeEntry | null {
    const getFromMap = <T>(map: Map<any, T> | undefined, key: any) =>
      map?.get(key) || map?.get(key.toString()) || map?.get(Number(key));

    let mappingsList = getFromMap(
      this.dataStore.fribbMappingsById.get(idType),
      idValue
    );

    mappingsList = this.filterMappingsBySeasonType(mappingsList, season);

    const { mappings, details, animeListEntry } =
      this.selectBestMappingAndDetails(
        mappingsList,
        idType,
        idValue,
        season,
        episode
      );

    const malId =
      mappings?.malId ?? (idType === 'malId' ? Number(idValue) : null);
    const kitsuId =
      mappings?.kitsuId ?? (idType === 'kitsuId' ? Number(idValue) : null);
    const anidbId =
      mappings?.anidbId ?? (idType === 'anidbId' ? Number(idValue) : null);

    const kitsuEntry = kitsuId ? this.dataStore.kitsuById.get(kitsuId) : null;
    const tvAnitraktEntry = malId
      ? this.dataStore.extendedAnitraktTvById.get(malId)
      : null;
    const movieAnitraktEntry = malId
      ? this.dataStore.extendedAnitraktMoviesById.get(malId)
      : null;

    const finalAnimeListEntry =
      animeListEntry ??
      (anidbId ? this.dataStore.animeListById.get(anidbId) : null);

    if (
      !details &&
      !mappings &&
      !kitsuEntry &&
      !tvAnitraktEntry &&
      !movieAnitraktEntry &&
      !finalAnimeListEntry
    ) {
      return null;
    }

    return this.buildAnimeEntry(
      mappings,
      details,
      kitsuEntry ?? null,
      tvAnitraktEntry ?? null,
      movieAnitraktEntry ?? null,
      finalAnimeListEntry ?? null
    );
  }

  private filterMappingsBySeasonType(
    mappingsList: MappingEntry[] | undefined,
    season?: number
  ): MappingEntry[] | undefined {
    if (!mappingsList) return mappingsList;

    const seasonFiltered = mappingsList.filter((entry) => {
      if (entry.type === AnimeType.UNKNOWN) return true;
      if (season === undefined) return entry.type === AnimeType.MOVIE;
      if (season === 0)
        return [AnimeType.SPECIAL, AnimeType.OVA, AnimeType.ONA].includes(
          entry.type
        );
      return entry.type === AnimeType.TV;
    });

    return seasonFiltered.length > 0 ? seasonFiltered : mappingsList;
  }

  private findManamiDetailsFromMapping(
    mapping: MappingEntry
  ): MinimisedManamiEntry | undefined {
    const getFromMap = <T>(map: Map<any, T> | undefined, key: any) =>
      map?.get(key) || map?.get(key.toString()) || map?.get(Number(key));

    // Try all available ID types in the mapping
    for (const [type, id] of Object.entries(mapping)) {
      if (!id) continue;
      const details = getFromMap(
        this.dataStore.manamiById.get(type as IdType),
        id
      );
      if (details) return details;
    }
    return undefined;
  }

  private selectBestMappingAndDetails(
    mappingsList: MappingEntry[] | undefined,
    idType: IdType,
    idValue: string | number,
    season?: number,
    episode?: number
  ): {
    mappings?: MappingEntry;
    details?: MinimisedManamiEntry;
    animeListEntry?: AnimeListEntry;
  } {
    if (!mappingsList?.length) {
      return {};
    }

    if (mappingsList.length === 1) {
      return {
        mappings: mappingsList[0],
        details: this.findManamiDetailsFromMapping(mappingsList[0]),
      };
    }

    if (season !== undefined && episode !== undefined) {
      const match = this.findBestMatchForSeasonEpisode(
        mappingsList,
        season,
        episode,
        idType,
        idValue
      );
      if (match.mappings) return match;
    }

    logger.debug(
      'No detailed match found, defaulting to first mapping entry...'
    );
    const mappings = mappingsList[0];

    return { mappings, details: this.findManamiDetailsFromMapping(mappings) };
  }

  private findBestMatchForSeasonEpisode(
    mappingsList: MappingEntry[],
    season: number,
    episode: number,
    idType: IdType,
    idValue: string | number
  ): {
    mappings?: MappingEntry;
    details?: MinimisedManamiEntry;
    animeListEntry?: AnimeListEntry;
  } {
    const getFromMap = <T>(map: Map<any, T> | undefined, key: any) =>
      map?.get(key) || map?.get(key.toString()) || map?.get(Number(key));

    logger.debug(
      `Multiple mapping entries found for ${idType}:${idValue}, attempting to find matching details...`,
      {
        mappingsList: mappingsList.map(
          (m) =>
            `${m.anidbId ? 'anidb:' : m.kitsuId ? 'kitsu:' : ''}${m.anidbId ?? m.kitsuId ?? 'UNKNOWN'}`
        ),
      }
    );

    // Collect all potential matches from both Kitsu and AnimeList
    type CandidateMatch = {
      mapping: MappingEntry;
      fromEpisode: number;
      source: 'kitsu' | 'animeList';
      animeListEntry?: AnimeListEntry;
    };

    const candidates: CandidateMatch[] = [];

    // Check Kitsu entries
    for (const mappingEntry of mappingsList) {
      if (mappingEntry.kitsuId) {
        const kitsuEntry = this.dataStore.kitsuById.get(mappingEntry.kitsuId);
        if (kitsuEntry?.fromSeason === season) {
          const fromEpisode = kitsuEntry.fromEpisode ?? 1;

          if (episode >= fromEpisode) {
            candidates.push({
              mapping: mappingEntry,
              fromEpisode,
              source: 'kitsu',
            });
          }
        }
      }
    }

    // Check AnimeList entries
    let tvdbId: number | null = null;

    if (idType === 'thetvdbId') {
      tvdbId =
        typeof idValue === 'number' ? idValue : parseInt(idValue.toString());
    } else if (idType === 'imdbId') {
      tvdbId = this.getTvdbIdFromImdbId(idValue.toString());
    }

    if (tvdbId) {
      const animeListMatch = this.findAnimeListMatchForTvdbSeason(
        tvdbId,
        season,
        episode
      );
      if (animeListMatch) {
        // Find the mapping entry that has this anidbId
        const matchingMapping = mappingsList.find(
          (m) => m.anidbId === animeListMatch.anidbId
        );
        if (matchingMapping) {
          const fromEpisode = (animeListMatch.episodeOffset ?? 0) + 1;
          candidates.push({
            mapping: matchingMapping,
            fromEpisode,
            source: 'animeList',
            animeListEntry: animeListMatch,
          });
        }
      }
    }

    // Select the best match: highest fromEpisode that episode still qualifies for
    if (candidates.length > 0) {
      const bestMatch = candidates.reduce((best, current) =>
        current.fromEpisode > best.fromEpisode ? current : best
      );

      logger.debug(
        `Best match for S${season}E${episode}: ${bestMatch.source === 'kitsu' ? `kitsuId:${bestMatch.mapping.kitsuId}` : `anidbId:${bestMatch.mapping.anidbId}`} (fromEpisode: ${bestMatch.fromEpisode})`
      );

      return {
        mappings: bestMatch.mapping,
        details: this.findManamiDetailsFromMapping(bestMatch.mapping),
        animeListEntry: bestMatch.animeListEntry,
      };
    }

    // Try synonym matching
    const seasonRegex = new RegExp(`season[\\s_-]*${season}`, 'i');
    for (const mappingEntry of mappingsList) {
      for (const [type, id] of Object.entries(mappingEntry)) {
        if (!id) continue;
        const potentialDetails = getFromMap(
          this.dataStore.manamiById.get(type as IdType),
          id
        );
        if (!potentialDetails) continue;
        if (potentialDetails?.synonyms.some((syn) => seasonRegex.test(syn))) {
          logger.debug(`Matched season regex on synonym for ${type}:${id}`);
          return { mappings: mappingEntry, details: potentialDetails };
        }
        break;
      }
    }

    return {};
  }

  /**
   * Convert IMDB ID to TVDB ID using Fribb mappings
   */
  private getTvdbIdFromImdbId(imdbId: string): number | null {
    const imdbMappings = this.dataStore.fribbMappingsById
      .get('imdbId')
      ?.get(imdbId);
    if (!imdbMappings || imdbMappings.length === 0) return null;

    // Return the first TVDB ID found in mappings
    for (const mapping of imdbMappings) {
      if (mapping.thetvdbId) {
        return mapping.thetvdbId;
      }
    }
    return null;
  }

  /**
   * Find the best AnimeList entry for a TVDB ID + season/episode combination
   * Uses TVDB/TMDB season mappings and offsets from the AnimeList XML
   */
  private findAnimeListMatchForTvdbSeason(
    tvdbId: number,
    season: number,
    episode: number
  ): AnimeListEntry | null {
    const candidates = this.dataStore.animeListByTvdbId.get(tvdbId);
    if (!candidates || candidates.length === 0) return null;

    if (candidates.length === 1) {
      return candidates[0];
    }

    let bestMatch: AnimeListEntry | null = null;
    let highestOffset = -1;

    for (const candidate of candidates) {
      // Check TVDB season match
      if (
        candidate.defaultTvdbSeason !== null &&
        (candidate.defaultTvdbSeason === season ||
          candidate.defaultTvdbSeason === 'a')
      ) {
        const offset = candidate.episodeOffset ?? 0;
        if (episode >= 1 + offset && offset > highestOffset) {
          bestMatch = candidate;
          highestOffset = offset;
        }
      }

      // Check TMDB season match as fallback (only if no TVDB match for this season)
      if (
        candidate.tmdbSeason !== null &&
        candidate.tmdbSeason === season &&
        candidate.defaultTvdbSeason !== season
      ) {
        const offset = candidate.tmdbOffset ?? 0;
        if (episode >= 1 + offset && offset > highestOffset) {
          bestMatch = candidate;
          highestOffset = offset;
        }
      }
    }

    if (bestMatch) {
      return bestMatch;
    }

    return null;
  }

  private buildAnimeEntry(
    mappings: MappingEntry | undefined,
    details: MinimisedManamiEntry | undefined,
    kitsuEntry: KitsuEntry | null,
    tvAnitraktEntry: ExtendedAnitraktTvEntry | null,
    movieAnitraktEntry: ExtendedAnitraktMovieEntry | null,
    animeListEntry: AnimeListEntry | null
  ): AnimeEntry {
    const combinedMappings: MappingEntry = {
      ...mappings,
      type: mappings?.type ?? AnimeType.UNKNOWN,
      imdbId:
        mappings?.imdbId ??
        animeListEntry?.imdbId ??
        kitsuEntry?.imdbId ??
        movieAnitraktEntry?.externals?.imdb ??
        tvAnitraktEntry?.externals?.imdb,
      kitsuId: mappings?.kitsuId,
      malId: mappings?.malId,
      themoviedbId:
        mappings?.themoviedbId ??
        animeListEntry?.tmdbId ??
        animeListEntry?.tmdbTv ??
        movieAnitraktEntry?.externals?.tmdb ??
        tvAnitraktEntry?.externals?.tmdb ??
        undefined,
      thetvdbId:
        animeListEntry?.tvdbId ??
        kitsuEntry?.tvdbId ??
        mappings?.thetvdbId ??
        tvAnitraktEntry?.externals?.tvdb,
      traktId:
        mappings?.traktId ??
        tvAnitraktEntry?.trakt?.id ??
        movieAnitraktEntry?.trakt?.id,
    };

    const {
      type,
      season: mappingSeasonInfo,
      ...finalMappings
    } = combinedMappings;
    const traktExternalSeasonInfo = tvAnitraktEntry?.trakt?.season?.externals;

    // Determine TVDB season and episode offset
    const tvdbSeasonNumber =
      mappingSeasonInfo?.tvdb ??
      (animeListEntry?.defaultTvdbSeason === 'a'
        ? null
        : (animeListEntry?.defaultTvdbSeason ?? null));
    const tvdbFromEpisode =
      animeListEntry?.episodeOffset != null
        ? animeListEntry.episodeOffset + 1
        : null;

    const tmdbSeasonNumber =
      mappingSeasonInfo?.tmdb ?? animeListEntry?.tmdbSeason ?? null;
    const tmdbFromEpisode =
      animeListEntry?.tmdbOffset != null ? animeListEntry.tmdbOffset + 1 : null;

    return {
      mappings: finalMappings,
      tmdb: {
        seasonNumber: tmdbSeasonNumber,
        seasonId: traktExternalSeasonInfo?.tmdb ?? null,
        fromEpisode: tmdbFromEpisode,
      },
      tvdb: {
        seasonNumber: tvdbSeasonNumber,
        seasonId: traktExternalSeasonInfo?.tvdb ?? null,
        fromEpisode: tvdbFromEpisode,
      },
      imdb: kitsuEntry
        ? {
            seasonNumber: kitsuEntry?.fromSeason,
            fromEpisode: kitsuEntry?.fromEpisode,
            nonImdbEpisodes: kitsuEntry?.nonImdbEpisodes,
            title: kitsuEntry?.title,
          }
        : null,
      fanart: kitsuEntry?.fanartLogoId
        ? { logoId: kitsuEntry.fanartLogoId }
        : null,
      trakt: tvAnitraktEntry?.trakt
        ? {
            title: tvAnitraktEntry.trakt.title,
            slug: tvAnitraktEntry.trakt.slug,
            isSplitCour: tvAnitraktEntry.trakt.isSplitCour,
            seasonId: tvAnitraktEntry.trakt.season?.id ?? null,
            seasonNumber: tvAnitraktEntry.trakt.season?.number ?? null,
          }
        : movieAnitraktEntry?.trakt
          ? {
              title: movieAnitraktEntry.trakt.title,
              slug: movieAnitraktEntry.trakt.slug,
            }
          : null,
      type: type,
      ...details,
      episodeMappings: animeListEntry?.mappings,
    };
  }

  // --- Refresh Interval Configuration ---

  private setupAllRefreshIntervals(): void {
    this.refreshTimers.forEach(clearInterval);
    this.refreshTimers = [];

    for (const source of Object.values(DATA_SOURCES)) {
      const timer = setInterval(
        () =>
          this.refreshDataSource(source).catch((e) =>
            logger.error(`[${source.name}] Failed to auto-refresh: ${e}`)
          ),
        source.refreshInterval
      );
      this.refreshTimers.push(timer);
      logger.info(
        `[${source.name}] Set auto-refresh interval to ${source.refreshInterval}ms`
      );
    }
  }

  // --- Private Refresh and Load Methods ---

  private async refreshDataSource(
    source: (typeof DATA_SOURCES)[keyof typeof DATA_SOURCES]
  ): Promise<void> {
    return withRetry(
      async () => {
        const remoteEtag = await this.fetchRemoteEtag(source.url);
        const localEtag = await this.readLocalFile(source.etagPath);

        const isDbMissing = !(await this.fileExists(source.filePath));
        const isOutOfDate =
          !remoteEtag || !localEtag || remoteEtag !== localEtag;
        const fetchFromRemote = isDbMissing || isOutOfDate;

        if (fetchFromRemote) {
          logger.info(
            `[${source.name}] Source is missing or out of date. Downloading...`
          );
          await this.downloadFile(
            source.url,
            source.filePath,
            source.etagPath,
            remoteEtag
          );
        } else {
          logger.info(`[${source.name}] Source is up to date.`);
        }
        try {
          await this[source.loader]();
        } catch (error) {
          // if we didnt fetch from remote and loading it failed, force a refresh next time by deleting the local file and etag
          if (!fetchFromRemote) {
            logger.debug(
              `[${source.name}] Deleting local file and etag due to error.`
            );
            await fs.unlink(source.etagPath);
            await fs.unlink(source.filePath);
          }
          throw error;
        }
      },
      {
        getContext: () => source.name,
      }
    );
  }

  private async loadFribbMappings(): Promise<void> {
    const start = Date.now();
    const fileContents = await this.readLocalFile(
      DATA_SOURCES.fribbMappings.filePath
    );
    if (!fileContents)
      throw new Error(DATA_SOURCES.fribbMappings.name + ' file not found');

    const data = JSON.parse(fileContents);
    if (!Array.isArray(data))
      throw new Error(
        DATA_SOURCES.fribbMappings.name + ' data must be an array'
      );

    const validEntries = this.validateEntries(data, validateMappingEntry);

    const newMappingsById: MappingIdMap = new Map();

    for (const idType of ID_TYPES) {
      newMappingsById.set(idType, new Map());
    }

    for (const entry of validEntries) {
      for (const idType of ID_TYPES) {
        const idValue = entry[idType];
        if (idValue !== undefined && idValue !== null) {
          const existingEntry = newMappingsById.get(idType)?.get(idValue);
          if (!existingEntry) {
            newMappingsById.get(idType)?.set(idValue, [entry]);
          } else {
            existingEntry.push(entry);
          }
        }
      }
    }
    this.dataStore.fribbMappingsById = newMappingsById;
    logger.info(
      `[${DATA_SOURCES.fribbMappings.name}] Loaded and indexed ${validEntries.length} valid entries in ${getTimeTakenSincePoint(start)}`
    );
  }

  private async loadManamiDb(): Promise<void> {
    const start = Date.now();
    const fileContents = await this.readLocalFile(DATA_SOURCES.manami.filePath);
    if (!fileContents)
      throw new Error(DATA_SOURCES.manami.name + ' file not found');

    const data = JSON.parse(fileContents);
    if (!Array.isArray(data.data))
      throw new Error(DATA_SOURCES.manami.name + ' data must be an array');

    const validEntries = this.validateEntries(data.data, validateManamiEntry);

    const newManamiById: ManamiIdMap = new Map();
    const idTypes = Object.keys(extractIdFromUrl) as Exclude<
      IdType,
      'traktId'
    >[];

    for (const idType of idTypes) {
      newManamiById.set(idType, new Map());
    }

    for (const entry of validEntries) {
      for (const sourceUrl of entry.sources) {
        for (const idType of idTypes) {
          const idExtractor = extractIdFromUrl[idType];
          if (idExtractor) {
            const idValue = idExtractor(sourceUrl);
            if (idValue) {
              const existingEntry = newManamiById.get(idType)?.get(idValue);
              if (!existingEntry) {
                newManamiById
                  .get(idType)
                  ?.set(
                    idValue,
                    Env.ANIME_DB_LEVEL_OF_DETAIL === 'required'
                      ? this.minimiseManamiEntry(entry)
                      : entry
                  );
              }
            }
          }
        }
      }
    }
    this.dataStore.manamiById = newManamiById;
    logger.info(
      `[${DATA_SOURCES.manami.name}] Loaded and indexed ${validEntries.length} valid entries in ${getTimeTakenSincePoint(start)}`
    );
  }

  private minimiseManamiEntry(entry: ManamiEntry): MinimisedManamiEntry {
    return {
      title: entry.title,
      animeSeason: entry.animeSeason,
      synonyms: entry.synonyms,
    };
  }

  private async loadKitsuImdbMapping(): Promise<void> {
    const start = Date.now();
    const fileContents = await this.readLocalFile(
      DATA_SOURCES.kitsuImdb.filePath
    );
    if (!fileContents)
      throw new Error(DATA_SOURCES.kitsuImdb.name + ' file not found');

    const data = JSON.parse(fileContents);

    // Validate and store kitsu entries
    this.dataStore.kitsuById = new Map();
    let enrichedCount = 0;

    for (const [kitsuId, kitsuEntry] of Object.entries(data)) {
      const validated = validateKitsuEntry(kitsuEntry);
      if (validated !== null) {
        this.dataStore.kitsuById.set(Number(kitsuId), validated);

        // Enrich Fribb mappings with IMDB ID if available and not already present
        if (validated.imdbId) {
          const kitsuMappings = this.dataStore.fribbMappingsById
            .get('kitsuId')
            ?.get(Number(kitsuId));

          if (kitsuMappings && kitsuMappings.length > 0) {
            for (const mapping of kitsuMappings) {
              if (!mapping.imdbId) {
                mapping.imdbId = validated.imdbId;

                const imdbMap = this.dataStore.fribbMappingsById.get('imdbId');
                if (!imdbMap) continue;
                const existingImdbMappings =
                  imdbMap.get(validated.imdbId) || [];

                if (
                  !existingImdbMappings.some(
                    (m) => m.kitsuId === Number(kitsuId)
                  )
                ) {
                  existingImdbMappings.push(mapping);
                  imdbMap.set(validated.imdbId, existingImdbMappings);
                  this.dataStore.fribbMappingsById.set('imdbId', imdbMap);
                  enrichedCount++;
                }
              }
            }
          }
        }
      } else {
        logger.warn(
          `[${DATA_SOURCES.kitsuImdb.name}] Skipping invalid entry for kitsuId ${kitsuId}`
        );
      }
    }

    logger.info(
      `[${DATA_SOURCES.kitsuImdb.name}] Loaded ${this.dataStore.kitsuById.size} kitsu entries and enriched ${enrichedCount} Fribb mappings with IMDB IDs in ${getTimeTakenSincePoint(start)}`
    );
  }

  private async loadExtendedAnitraktMovies(): Promise<void> {
    const start = Date.now();
    const fileContents = await this.readLocalFile(
      DATA_SOURCES.anitraktMovies.filePath
    );
    if (!fileContents)
      throw new Error(DATA_SOURCES.anitraktMovies.name + ' file not found');

    const data = JSON.parse(fileContents);
    if (!Array.isArray(data))
      throw new Error(
        DATA_SOURCES.anitraktMovies.name + ' data must be an array'
      );

    const validEntries = this.validateEntries(
      data,
      validateExtendedAnitraktMovieEntry
    );

    const newExtendedAnitraktMoviesById: ExtendedAnitraktMoviesIdMap =
      new Map();

    for (const entry of validEntries) {
      newExtendedAnitraktMoviesById.set(entry.myanimelist.id, entry);
    }
    this.dataStore.extendedAnitraktMoviesById = newExtendedAnitraktMoviesById;
    logger.info(
      `[${DATA_SOURCES.anitraktMovies.name}] Loaded and indexed ${validEntries.length} valid entries in ${getTimeTakenSincePoint(start)}`
    );
  }

  private async loadExtendedAnitraktTv(): Promise<void> {
    const start = Date.now();
    const fileContents = await this.readLocalFile(
      DATA_SOURCES.anitraktTv.filePath
    );
    if (!fileContents)
      throw new Error(DATA_SOURCES.anitraktTv.name + ' file not found');

    const data = JSON.parse(fileContents);
    if (!Array.isArray(data))
      throw new Error(DATA_SOURCES.anitraktTv.name + ' data must be an array');

    const validEntries = this.validateEntries(
      data,
      validateExtendedAnitraktTvEntry
    );

    const newExtendedAnitraktTvById: ExtendedAnitraktTvIdMap = new Map();

    for (const entry of validEntries) {
      newExtendedAnitraktTvById.set(entry.myanimelist.id, entry);
    }
    this.dataStore.extendedAnitraktTvById = newExtendedAnitraktTvById;
    logger.info(
      `[${DATA_SOURCES.anitraktTv.name}] Loaded and indexed ${validEntries.length} valid entries in ${getTimeTakenSincePoint(start)}`
    );
  }

  private async loadAnimeList(): Promise<void> {
    const start = Date.now();
    const fileContents = await this.readLocalFile(
      DATA_SOURCES.animeList.filePath
    );
    if (!fileContents)
      throw new Error(DATA_SOURCES.animeList.name + ' file not found');
    const parser = new Parser({
      explicitArray: true,
      async: true,
    });
    const rawParseStart = Date.now();
    const parsed = await parser.parseStringPromise(fileContents);
    logger.info(
      `[${DATA_SOURCES.animeList.name}] Parsed XML in ${getTimeTakenSincePoint(
        rawParseStart
      )}`
    );
    if (!parsed?.['anime-list']?.anime) {
      throw new Error(DATA_SOURCES.animeList.name + ' invalid XML structure');
    }

    const validEntries = this.validateEntries(
      parsed['anime-list'].anime,
      validateAnimeListEntry
    );

    const newAnimeListById: AnimeListIdMap = new Map();
    const newAnimeListByTvdbId: AnimeListByTvdbIdMap = new Map();
    let entriesInTvdbMap = 0;

    for (const entry of validEntries) {
      newAnimeListById.set(entry.anidbId, entry);

      // Index by TVDB ID for reverse lookups
      if (entry.tvdbId) {
        const existing = newAnimeListByTvdbId.get(entry.tvdbId) ?? [];
        existing.push(entry);
        newAnimeListByTvdbId.set(entry.tvdbId, existing);
        entriesInTvdbMap++;
      }
    }

    this.dataStore.animeListById = newAnimeListById;
    this.dataStore.animeListByTvdbId = newAnimeListByTvdbId;

    logger.info(
      `[${DATA_SOURCES.animeList.name}] Loaded ${validEntries.length} entries (${entriesInTvdbMap} with TVDB IDs) in ${getTimeTakenSincePoint(start)}`
    );
  }

  // --- Generic File and Network Helpers ---

  private validateEntries<T>(
    entries: unknown[],
    validator: (data: any) => T | null
  ): T[] {
    const validEntries: T[] = [];
    for (const entry of entries) {
      const validated = validator(entry);
      if (validated !== null) {
        validEntries.push(validated);
      } else {
        logger.warn(
          `Skipping invalid entry for ${validator.name}: ${JSON.stringify(entry, null, 2)}`
        );
      }
    }
    return validEntries;
  }

  private async fetchRemoteEtag(url: string): Promise<string | null> {
    try {
      const response = await makeRequest(url, {
        method: 'HEAD',
        timeout: 15000,
      });
      return response.headers.get('etag');
    } catch (error) {
      logger.warn(`Failed to fetch remote etag for ${url}: ${error}`);
      return null;
    }
  }

  private async readLocalFile(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      return null; // Gracefully handle file not existing
    }
  }

  private async downloadFile(
    url: string,
    filePath: string,
    etagPath: string,
    remoteEtag: string | null
  ): Promise<void> {
    const startTime = Date.now();
    const response = await makeRequest(url, { method: 'GET', timeout: 90000 });

    if (!response.ok) throw new Error(`Download failed: ${response.status}`);

    // Stream the response directly to file for large files
    await fs.mkdir(ANIME_DATABASE_PATH, { recursive: true });

    // Create a write stream for the file
    const fileStream = createWriteStream(filePath);

    // Pipe the response body to the file using Node.js streams
    await new Promise<void>((resolve, reject) => {
      if (!response.body) {
        reject(new Error('No response body to stream'));
        return;
      }

      const reader = response.body.getReader();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });

      // Pipe the stream to the file
      stream
        .pipeTo(
          new WritableStream({
            write(chunk) {
              return new Promise((resolve, reject) => {
                fileStream.write(chunk, (error) => {
                  if (error) reject(error);
                  else resolve();
                });
              });
            },
            close() {
              fileStream.end();
            },
          })
        )
        .then(resolve)
        .catch(reject);

      // Handle stream errors
      fileStream.on('error', reject);
    });

    // Write the etag if present
    const etag = remoteEtag ?? response.headers.get('etag');
    if (etag) {
      await fs.writeFile(etagPath, etag);
    }

    logger.info(
      `Downloaded ${path.basename(filePath)} in ${getTimeTakenSincePoint(startTime)}`
    );
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Extract season number from anime synonyms
 * @param synonyms - Array of anime title synonyms
 * @returns Season number as string, or undefined if not found
 */
export function getSeasonFromSynonyms(synonyms: string[]): string | undefined {
  const seasonRegex = /(?:season|s)\s(\d+)/i;
  for (const synonym of synonyms) {
    const match = synonym.match(seasonRegex);
    if (match) {
      return match[1].toString().trim();
    }
  }
  return undefined;
}

/**
 * Enrich parsed ID with anime database entry information
 * Updates season and episode numbers based on anime database mappings
 * @param parsedId - Parsed ID object to enrich (modified in place)
 * @param animeEntry - Anime database entry
 */
export function enrichParsedIdWithAnimeEntry(
  parsedId: ParsedId,
  animeEntry: AnimeEntry
): void {
  let enriched: boolean = false;
  let original = {
    season: parsedId.season,
    episode: parsedId.episode,
  };
  if (!parsedId.season) {
    parsedId.season =
      animeEntry.imdb?.seasonNumber?.toString() ??
      animeEntry.trakt?.seasonNumber?.toString() ??
      animeEntry.tvdb?.seasonNumber?.toString() ??
      (animeEntry.synonyms
        ? getSeasonFromSynonyms(animeEntry.synonyms)
        : undefined) ??
      animeEntry.tmdb?.seasonNumber?.toString();

    if (parsedId.season) enriched = true;
  }

  if (parsedId.episode && ['malId', 'kitsuId'].includes(parsedId.type)) {
    const fromEpisode =
      animeEntry.imdb?.fromEpisode ?? animeEntry.tvdb?.fromEpisode;
    if (fromEpisode && fromEpisode !== 1) {
      parsedId.episode = (
        fromEpisode +
        Number(parsedId.episode) -
        1
      ).toString();
      enriched = true;
    }
  }

  if (enriched) {
    logger.debug(`Enriched anime ID`, {
      original: `${parsedId.type}:${parsedId.value}${original.season ? `:${original.season}` : ''}${original.episode ? `:${original.episode}` : ''}`,
      enriched: `${parsedId.type}:${parsedId.value}${parsedId.season ? `:${parsedId.season}` : ''}${parsedId.episode ? `:${parsedId.episode}` : ''}`,
    });
  }
}
