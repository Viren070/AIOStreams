import path from 'path';
import fs from 'fs/promises';
import { z, ZodError } from 'zod';
import { getDataFolder } from './general';
import { makeRequest } from './http';
import { createLogger, getTimeTakenSincePoint } from './logger';
import { IdParser, IdType, ID_TYPES } from './id-parser';
import { formatZodError } from './config';
import { DistributedLock, Env } from '.';
import { createWriteStream } from 'fs';

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

// --- Zod Schemas and Types ---

const AnimeType = z.enum(['TV', 'SPECIAL', 'OVA', 'MOVIE', 'ONA', 'UNKNOWN']);
const AnimeStatus = z.enum([
  'CURRENT',
  'FINISHED',
  'UPCOMING',
  'UNKNOWN',
  'ONGOING',
]);
const AnimeSeason = z.enum(['WINTER', 'SPRING', 'SUMMER', 'FALL', 'UNDEFINED']);
// Schema for Fribb's Mappings
const MappingEntrySchema = z
  .object({
    'anime-planet_id': z.union([z.string(), z.number()]).optional(),
    animecountdown_id: z.number().optional(),
    anidb_id: z.number().optional(),
    anilist_id: z.number().optional(),
    anisearch_id: z.number().optional(),
    imdb_id: z.string().optional().nullable(),
    kitsu_id: z.number().optional(),
    livechart_id: z.number().optional(),
    mal_id: z.number().optional(),
    'notify.moe_id': z.string().optional(),
    simkl_id: z.number().optional(),
    themoviedb_id: z.coerce.number().optional(),
    thetvdb_id: z.number().optional().nullable(),
    trakt_id: z.number().optional(),
    type: AnimeType,
  })
  .transform((data) => ({
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
    themoviedbId: data['themoviedb_id'],
    thetvdbId: data['thetvdb_id'],
    traktId: data['trakt_id'],
    type: data['type'],
  }));
type MappingEntry = z.infer<typeof MappingEntrySchema>;

// Schema for Manami's Database
const ManamiEntrySchema = z.object({
  sources: z.array(z.url()),
  title: z.string(),
  type: AnimeType,
  episodes: z.number(),
  status: AnimeStatus,
  animeSeason: z.object({
    season: AnimeSeason,
    year: z.number().nullable(),
  }),
  picture: z.url().nullable(),
  thumbnail: z.url().nullable(),
  duration: z
    .object({
      value: z.number(),
      unit: z.enum(['SECONDS']),
    })
    .nullable(),
  score: z
    .object({
      arithmeticGeometricMean: z.number(),
      arithmeticMean: z.number(),
      median: z.number(),
    })
    .nullable(),
  synonyms: z.array(z.string()),
  studios: z.array(z.string()),
  producers: z.array(z.string()),
  relatedAnime: z.array(z.url()),
  tags: z.array(z.string()),
});
type ManamiEntry = z.infer<typeof ManamiEntrySchema>;

const MinimisedManamiEntrySchema = ManamiEntrySchema.pick({
  title: true,
  animeSeason: true,
  synonyms: true,
});
type MinimisedManamiEntry = z.infer<typeof MinimisedManamiEntrySchema>;

const KitsuEntrySchema = z
  .object({
    fanartLogoId: z.coerce.number().optional(),
    tvdb_id: z.coerce.number().optional(),
    imdb_id: z.string().optional(),
    title: z.string().optional(),
    fromSeason: z.number().optional(),
    fromEpisode: z.number().optional(),
  })
  .transform((data) => ({
    fanartLogoId: data.fanartLogoId,
    tvdbId: data.tvdb_id,
    imdbId: data.imdb_id,
    title: data.title,
    fromSeason: data.fromSeason,
    fromEpisode: data.fromEpisode,
  }));
type KitsuEntry = z.infer<typeof KitsuEntrySchema>;

const ExtendedAnitraktMovieEntrySchema = z
  .object({
    myanimelist: z.object({
      title: z.string(),
      id: z.number(),
    }),
    trakt: z.object({
      title: z.string(),
      id: z.number(),
      slug: z.string(),
      type: z.literal('movies'),
    }),
    release_year: z.number(),
    externals: z.object({
      tmdb: z.number().optional().nullable(),
      imdb: z.string().optional().nullable(),
      letterboxd: z
        .object({
          slug: z.string().nullable(),
          lid: z.string().nullable(),
          uid: z.number().nullable(),
        })
        .nullable(),
    }),
  })
  .transform((data) => ({
    myanimelist: data.myanimelist,
    trakt: data.trakt,
    releaseYear: data.release_year,
    externals: data.externals,
  }));
type ExtendedAnitraktMovieEntry = z.infer<
  typeof ExtendedAnitraktMovieEntrySchema
>;

const ExtendedAnitraktTvEntrySchema = z
  .object({
    myanimelist: z.object({
      title: z.string(),
      id: z.number(),
    }),
    trakt: z.object({
      title: z.string(),
      id: z.number(),
      slug: z.string(),
      type: z.literal('shows'),
      is_split_cour: z.boolean(),
      season: z
        .object({
          id: z.number(),
          number: z.number(),
          externals: z.object({
            tvdb: z.number().nullable(),
            tmdb: z.number().nullable(),
            imdb: z.string().optional().nullable(),
          }),
        })
        .nullable(),
    }),
    release_year: z.number(),
    externals: z.object({
      tvdb: z.number().optional().nullable(),
      tmdb: z.number().optional().nullable(),
      imdb: z.string().optional().nullable(),
    }),
  })
  .transform((data) => ({
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
  }));

type ExtendedAnitraktTvEntry = z.infer<typeof ExtendedAnitraktTvEntrySchema>;

const AnimeEntrySchema = z
  .object({
    mappings: z
      .record(
        z.string(),
        z.union([z.string(), z.number(), z.null(), z.undefined()])
      )
      .optional(),
    imdb: z
      .object({
        fromImdbSeason: z.number().optional(),
        fromImdbEpisode: z.number().optional(),
        title: z.string().optional(),
      })
      .nullable(),
    fanart: z
      .object({
        logoId: z.number(),
      })
      .nullable(),
    trakt: z
      .object({
        title: z.string(),
        slug: z.string(),
        isSplitCour: z.boolean().optional(),
        season: z
          .object({
            id: z.number(),
            number: z.number(),
            externals: z.object({
              tvdb: z.number().nullable(),
              tmdb: z.number().nullable(),
              imdb: z.string().nullable().optional(),
            }),
          })
          .nullable()
          .optional(),
      })
      .nullable(),
    title: z.string().optional(),
    animeSeason: z
      .object({
        season: AnimeSeason,
        year: z.number().nullable(),
      })
      .optional(),
    synonyms: z.array(z.string()).optional(),
  })
  .nullable();

type AnimeEntry = z.infer<typeof AnimeEntrySchema>;

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
    // Perform initial fetch for all datasets concurrently
    const refreshPromises = Object.values(DATA_SOURCES).map((dataSource) =>
      this.refreshDataSource(dataSource)
    );
    await Promise.all(refreshPromises);

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

  public getEntryById(idType: IdType, idValue: string | number): AnimeEntry {
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
    const lockKey = `anime-datasource-refresh-${source.dataKey}`;
    const lockOptions = { timeout: 10000, ttl: 12000 };

    let lockAcquired = false;
    let firstError: any = null;

    for (let attempt = 0; attempt < 2 && !lockAcquired; attempt++) {
      try {
        await DistributedLock.getInstance().withLock(
          lockKey,
          async () => {
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
            } catch (error) {
              logger.error(
                `[${source.name}] Failed to refresh: ${error}. Will retry on next cycle.`
              );
            }
          },
          lockOptions
        );
        lockAcquired = true;
        // Dynamically call the correct loader
        // the lock is only needed to avoid multiple instances trying to download files at the same time.
        // since the loader needs to be called per instance as its in memory, it needs to be called outside of the lock.
        await this[source.loader]();
      } catch (error) {
        if (attempt === 0) {
          // First attempt failed, wait for ttl before retrying
          logger.error(`[${source.name}] Failed to refresh: ${error}`);
          firstError = error;
          logger.warn(
            `[${source.name}] Lock acquisition failed, will retry after ${lockOptions.ttl}ms`
          );
          await new Promise((resolve) => setTimeout(resolve, lockOptions.ttl));
        } else {
          // Second attempt failed, log and exit
          logger.error(`[${source.name}] Will retry on next cycle.`);
        }
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

    const validEntries = this.validateEntries(data, MappingEntrySchema);

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

    const validEntries = this.validateEntries(data.data, ManamiEntrySchema);

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

    // Validate each entry using the schema
    this.dataStore.kitsuById = new Map();
    for (const [kitsuId, kitsuEntry] of Object.entries(data)) {
      const parsed = KitsuEntrySchema.safeParse(kitsuEntry);
      if (parsed.success) {
        this.dataStore.kitsuById.set(Number(kitsuId), parsed.data);
      } else {
        logger.warn(
          `[${DATA_SOURCES.kitsuImdb.name}] Skipping invalid entry for kitsuId ${kitsuId}: ${formatZodError(parsed.error)}`
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
      ExtendedAnitraktMovieEntrySchema
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
      ExtendedAnitraktTvEntrySchema
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

  private validateEntries<T extends z.ZodTypeAny>(
    entries: unknown[],
    schema: T
  ): z.infer<T>[] {
    const validEntries: z.infer<T>[] = [];
    for (const entry of entries) {
      const parsed = schema.safeParse(entry);
      if (parsed.success) {
        validEntries.push(parsed.data);
      } else {
        logger.warn(`Skipping invalid entry: ${formatZodError(parsed.error)}`);
        logger.verbose(`Invalid entry: ${JSON.stringify(entry, null, 2)}`);
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
