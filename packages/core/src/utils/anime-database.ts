import path from 'path';
import fs from 'fs/promises';
import {
  getDataFolder,
  makeRequest,
  getTimeTakenSincePoint,
  IdParser,
  IdType,
  ID_TYPES,
  DistributedLock,
  Env,
} from './index.js';
import { createWriteStream } from 'fs';
import { createLogger } from './logger.js';

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
    url: 'https://github.com/manami-project/anime-offline-database/releases/download/latest/anime-offline-database.json',
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
        imdb?: string | null;
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

interface AnimeEntry {
  mappings?: Record<string, string | number | null | undefined>;
  imdb?: {
    fromImdbSeason?: number;
    fromImdbEpisode?: number;
    title?: string;
  } | null;
  fanart?: {
    logoId: number;
  } | null;
  trakt?: {
    title: string;
    slug: string;
    isSplitCour?: boolean;
    season?: {
      id: number;
      number: number;
      externals: {
        tvdb: number | null;
        tmdb: number | null;
        imdb?: string | null;
      };
    } | null;
  } | null;
  title?: string;
  animeSeason?: {
    season: AnimeSeason;
    year: number | null;
  };
  synonyms?: string[];
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
    thetvdbId: data['thetvdb_id'],
    traktId: data['trakt_id'],
    type: data['type'],
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

type MappingIdMap = Map<IdType, Map<string | number, MappingEntry>>;
type ManamiIdMap = Map<
  IdType,
  Map<string | number, ManamiEntry | MinimisedManamiEntry>
>;
type KitsuIdMap = Map<number, KitsuEntry>;
type ExtendedAnitraktMoviesIdMap = Map<number, ExtendedAnitraktMovieEntry>;
type ExtendedAnitraktTvIdMap = Map<number, ExtendedAnitraktTvEntry>;

export class AnimeDatabase {
  private static instance: AnimeDatabase;
  private isInitialised = false;

  // Data storage
  // private mappingsById: MappingIdMap = new Map();
  // private manamiById: ManamiIdMap = new Map();
  // private kitsuById: KitsuIdMap = new Map();
  // private extendedAnitraktMoviesById: ExtendedAnitraktMoviesIdMap = new Map();
  // private extendedAnitraktTvById: ExtendedAnitraktTvIdMap = new Map();

  private dataStore: {
    fribbMappingsById: MappingIdMap;
    manamiById: ManamiIdMap;
    kitsuById: KitsuIdMap;
    extendedAnitraktMoviesById: ExtendedAnitraktMoviesIdMap;
    extendedAnitraktTvById: ExtendedAnitraktTvIdMap;
  } = {
    fribbMappingsById: new Map(),
    manamiById: new Map(),
    kitsuById: new Map(),
    extendedAnitraktMoviesById: new Map(),
    extendedAnitraktTvById: new Map(),
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
      await this.refreshDataSource(dataSource);
    }

    this.setupAllRefreshIntervals();
    this.isInitialised = true;
    logger.info('AnimeDatabase initialised successfully.');
  }

  // --- Public Methods for Data Access ---

  public isAnime(id: string): boolean {
    const parsedId = IdParser.parse(id, 'unknown');
    if (parsedId && this.getEntryById(parsedId.type, parsedId.value) !== null) {
      return true;
    }
    return false;
  }

  public getEntryById(
    idType: IdType,
    idValue: string | number
  ): AnimeEntry | null {
    const getFromMap = <T>(map: Map<any, T> | undefined, key: any) =>
      map?.get(key) || map?.get(key.toString()) || map?.get(Number(key));

    let mappings = getFromMap(
      this.dataStore.fribbMappingsById.get(idType),
      idValue
    );
    let details = getFromMap(this.dataStore.manamiById.get(idType), idValue);

    // If no direct match for details, try finding via mappings
    if (!details && mappings) {
      logger.debug('No direct match for details, searching via mappings...');
      for (const [type, id] of Object.entries(mappings)) {
        if (id && type !== idType) {
          details = getFromMap(
            this.dataStore.manamiById.get(type as IdType),
            id
          );
          if (details) break;
        }
      }
    }

    const malId =
      mappings?.malId ?? (idType === 'malId' ? Number(idValue) : null);
    const kitsuId =
      mappings?.kitsuId ?? (idType === 'kitsuId' ? Number(idValue) : null);

    const kitsuEntry = kitsuId ? this.dataStore.kitsuById.get(kitsuId) : null;
    const tvAnitraktEntry = malId
      ? this.dataStore.extendedAnitraktTvById.get(malId)
      : null;
    const movieAnitraktEntry = malId
      ? this.dataStore.extendedAnitraktMoviesById.get(malId)
      : null;

    if (
      !details &&
      !mappings &&
      !kitsuEntry &&
      !tvAnitraktEntry &&
      !movieAnitraktEntry
    ) {
      return null;
    }

    // Merge data from all sources
    const finalMappings = {
      ...mappings,
      imdbId:
        mappings?.imdbId ??
        kitsuEntry?.imdbId ??
        movieAnitraktEntry?.externals?.imdb ??
        tvAnitraktEntry?.externals?.imdb,
      kitsuId: mappings?.kitsuId ?? kitsuId,
      malId: mappings?.malId ?? malId,
      themoviedbId:
        mappings?.themoviedbId ??
        movieAnitraktEntry?.externals?.tmdb ??
        tvAnitraktEntry?.externals?.tmdb,
      thetvdbId:
        kitsuEntry?.tvdbId ??
        mappings?.thetvdbId ??
        tvAnitraktEntry?.externals?.tvdb,
      traktId:
        mappings?.traktId ??
        tvAnitraktEntry?.trakt?.id ??
        movieAnitraktEntry?.trakt?.id,
    };

    return {
      mappings: finalMappings,
      imdb: kitsuEntry
        ? {
            fromImdbSeason: kitsuEntry.fromSeason,
            fromImdbEpisode: kitsuEntry.fromEpisode,
            title: kitsuEntry.title,
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
            season: tvAnitraktEntry.trakt.season ?? null,
          }
        : movieAnitraktEntry?.trakt
          ? {
              title: movieAnitraktEntry.trakt.title,
              slug: movieAnitraktEntry.trakt.slug,
            }
          : null,
      ...details,
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
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const remoteEtag = await this.fetchRemoteEtag(source.url);
        const localEtag = await this.readLocalFile(source.etagPath);

        const isDbMissing = !(await this.fileExists(source.filePath));
        const isOutOfDate =
          !remoteEtag || !localEtag || remoteEtag !== localEtag;

        if (isDbMissing || isOutOfDate) {
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
        await this[source.loader]();
        break;
      } catch (error) {
        logger.error(
          `[${source.name}] Failed to refresh: ${error}. Will retry ${attempt === 0 ? '1 more time' : 'on next refresh interval'}.`
        );
      }
    }
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
            newMappingsById.get(idType)?.set(idValue, entry);
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

    // Validate each entry
    this.dataStore.kitsuById = new Map();
    for (const [kitsuId, kitsuEntry] of Object.entries(data)) {
      const validated = validateKitsuEntry(kitsuEntry);
      if (validated !== null) {
        this.dataStore.kitsuById.set(Number(kitsuId), validated);
      } else {
        logger.warn(
          `[${DATA_SOURCES.kitsuImdb.name}] Skipping invalid entry for kitsuId ${kitsuId}`
        );
      }
    }
    logger.info(
      `[${DATA_SOURCES.kitsuImdb.name}] Loaded and indexed ${this.dataStore.kitsuById.size} valid entries in ${getTimeTakenSincePoint(start)}`
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
          `Skipping invalid entry: ${JSON.stringify(entry, null, 2)}`
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
