import { DistributedLock } from '../utils/distributed-lock.js';
import {
  deduplicateTitles,
  Metadata,
  MetadataTitle,
  TitleConflict,
} from './utils.js';
import { detectTitleConflicts } from './conflicts.js';
import {
  assembleTitles,
  mergeMetadata,
  SourceContribution,
  SourceContributions,
} from './merge.js';
import { TMDBMetadata } from './tmdb.js';
import { getTraktAliases } from './trakt.js';
import { IMDBMetadata } from './imdb.js';
import { createLogger } from '../logging/logger.js';
import { getTimeTakenSincePoint } from '../utils/time.js';
import { TYPES } from '../utils/constants.js';
import {
  AnimeDatabase,
  IdParser,
  ParsedId,
  appConfig,
} from '../utils/index.js';
import { withRetry } from '../utils/general.js';
import { Meta } from '../db/schemas.js';
import { TVDBMetadata } from './tvdb.js';
import { parseDuration } from '../parser/utils.js';
import {
  resolveEpisodeFacts,
  EpisodeResolution,
  CinemetaVideo,
} from './episode-resolver.js';
import { SceneMappingDataset } from './scene-mappings.js';
import { IdMappingDataset } from './id-mappings.js';
import { SkyhookMetadata } from './skyhook.js';

const logger = createLogger('metadata-service');

export interface MetadataServiceConfig {
  tmdbAccessToken?: string;
  tmdbApiKey?: string;
  tvdbApiKey?: string;
}

export class MetadataService {
  private readonly lock: DistributedLock;
  private readonly config: MetadataServiceConfig;

  public constructor(config: MetadataServiceConfig) {
    this.lock = DistributedLock.getInstance();
    this.config = config;
  }

  private isDateInFuture(dateStr: string): boolean {
    const date = new Date(dateStr);
    return !isNaN(date.getTime()) && date > new Date();
  }

  public async getMetadata(
    id: ParsedId,
    type: (typeof TYPES)[number]
  ): Promise<Metadata> {
    return withRetry(
      async () => {
        const { result } = await this.lock.withLock(
          `metadata:${id.mediaType}:${id.type}:${id.value}:${id.season ?? ''}:${id.episode ?? ''}${this.config.tmdbAccessToken || this.config.tmdbApiKey ? ':tmdb' : ''}${this.config.tvdbApiKey ? ':tvdb' : ''}`,
          async () => {
            const start = Date.now();
            // fill order is irrelevant; merge.ts decides what wins
            const contributions: SourceContributions = {};
            let cinemetaVideos: CinemetaVideo[] | undefined;

            // Check anime database first
            const animeEntry = await AnimeDatabase.getInstance().getEntryById(
              id.type,
              id.value,
              id.season ? Number(id.season) : undefined,
              id.episode ? Number(id.episode) : undefined
            );

            let tmdbId: number | null =
              id.type === 'themoviedbId'
                ? Number(id.value)
                : animeEntry?.mappings?.themoviedbId
                  ? Number(animeEntry.mappings.themoviedbId)
                  : null;
            let imdbId: string | null =
              id.type === 'imdbId'
                ? id.value.toString()
                : (animeEntry?.mappings?.imdbId?.toString() ?? null);
            let tvdbId: number | null =
              id.type === 'thetvdbId'
                ? Number(id.value)
                : animeEntry?.mappings?.thetvdbId && type === 'series'
                  ? Number(animeEntry.mappings.thetvdbId)
                  : null;

            // Fill any missing ids from the keyless cross-provider map
            if (
              appConfig.metadata.idMappings.enabled &&
              (!imdbId || !tvdbId || !tmdbId)
            ) {
              try {
                const mapped = IdMappingDataset.getInstance().resolve(
                  type === 'movie' ? 'movie' : 'series',
                  {
                    imdbId: imdbId ?? undefined,
                    tvdbId: tvdbId ?? undefined,
                    tmdbId: tmdbId ?? undefined,
                  }
                );
                imdbId = imdbId ?? mapped.imdbId ?? null;
                tvdbId = tvdbId ?? mapped.tvdbId ?? null;
                tmdbId = tmdbId ?? mapped.tmdbId ?? null;
              } catch (error) {
                logger.debug(
                  `ID mapping lookup failed for ${id.fullId}: ${error}`
                );
              }
            }

            if (animeEntry) {
              const aliases: MetadataTitle[] = [];
              if (animeEntry.imdb?.title)
                aliases.push({ title: animeEntry.imdb.title });
              if (animeEntry.trakt?.title)
                aliases.push({ title: animeEntry.trakt.title });
              if (animeEntry.title) aliases.push({ title: animeEntry.title });
              if (animeEntry.synonyms)
                aliases.push(...animeEntry.synonyms.map((s) => ({ title: s })));
              contributions.anime = {
                aliases,
                year: animeEntry.animeSeason?.year ?? undefined,
              };
            }

            // ids already known without asking a provider
            contributions.request = { tmdbId, tvdbId };

            // Setup parallel API requests
            const promises = [];

            // TMDB metadata
            const idForTmdb = tmdbId
              ? `tmdb:${tmdbId}`
              : (imdbId ?? (tvdbId ? `tvdb:${tvdbId}` : null));
            const parsedIdForTmdb = idForTmdb
              ? IdParser.parse(idForTmdb, type)
              : null;
            if (parsedIdForTmdb) {
              promises.push(
                (async () => {
                  return new TMDBMetadata({
                    accessToken: this.config.tmdbAccessToken,
                    apiKey: this.config.tmdbApiKey,
                  }).getMetadata(parsedIdForTmdb);
                })()
              );
            } else {
              promises.push(Promise.resolve(undefined));
            }

            // TVDB metadata
            const idForTvdb = tvdbId
              ? `tvdb:${tvdbId}`
              : (imdbId ?? (tmdbId ? `tmdb:${tmdbId}` : null));
            const parsedIdForTvdb = idForTvdb
              ? IdParser.parse(idForTvdb, type)
              : null;
            if (parsedIdForTvdb) {
              promises.push(
                (async () => {
                  return new TVDBMetadata({
                    apiKey: this.config.tvdbApiKey,
                  }).getMetadata(parsedIdForTvdb);
                })()
              );
            } else {
              promises.push(Promise.resolve(undefined));
            }

            // Trakt aliases
            if (imdbId && appConfig.metadata.trakt.fetchAliases) {
              promises.push(getTraktAliases(id));
            } else {
              promises.push(Promise.resolve(undefined));
            }

            // IMDb metadata
            if (imdbId) {
              const imdbMetadata = new IMDBMetadata();
              promises.push(imdbMetadata.getCinemetaData(imdbId, type));
              promises.push(imdbMetadata.getImdbSuggestionData(imdbId, type));
            } else {
              promises.push(Promise.resolve(undefined));
              promises.push(Promise.resolve(undefined));
            }

            if (tvdbId && type !== 'movie') {
              promises.push(new SkyhookMetadata().getMetadata(tvdbId));
            } else {
              promises.push(Promise.resolve(undefined));
            }

            // Execute all promises in parallel
            const [
              tmdbResult,
              tvdbResult,
              traktResult,
              imdbResult,
              imdbSuggestionResult,
              skyhookResult,
            ] = (await Promise.allSettled(promises)) as [
              PromiseSettledResult<(Metadata & { tmdbId: string }) | undefined>,
              PromiseSettledResult<(Metadata & { tvdbId: number }) | undefined>,
              PromiseSettledResult<MetadataTitle[] | undefined>,
              PromiseSettledResult<Meta | undefined>,
              PromiseSettledResult<Metadata | undefined>,
              PromiseSettledResult<Metadata | undefined>,
            ];

            // Process TMDB results
            if (tmdbResult.status === 'fulfilled' && tmdbResult.value) {
              const tmdbMetadata = tmdbResult.value;
              contributions.tmdb = {
                primaryTitle: tmdbMetadata.title,
                // Mark TMDB titles as trusted so their language tags are preserved
                // during deduplication even when lower-quality sources (TVDB, Trakt,
                // IMDb) return the same title without a language tag.
                aliases: tmdbMetadata.titles?.map((t) => ({
                  ...t,
                  trusted: true as const,
                })),
                year: tmdbMetadata.year,
                yearEnd: tmdbMetadata.yearEnd,
                originalLanguage: tmdbMetadata.originalLanguage,
                country: tmdbMetadata.country,
                releaseDate: tmdbMetadata.releaseDate,
                seasons: tmdbMetadata.seasons
                  ? [...tmdbMetadata.seasons].sort(
                      (a, b) => a.season_number - b.season_number
                    )
                  : undefined,
                runtime: tmdbMetadata.runtime,
                genres: tmdbMetadata.genres,
                firstAiredDate: tmdbMetadata.firstAiredDate,
                lastAiredDate: tmdbMetadata.lastAiredDate,
                tmdbId: tmdbMetadata.tmdbId,
              };
            } else if (tmdbResult.status === 'rejected') {
              logger.warn(
                `Failed to fetch TMDB metadata for ${id.fullId}: ${tmdbResult.reason}`
              );
            }

            // Process TVDB results
            if (tvdbResult.status === 'fulfilled' && tvdbResult.value) {
              const tvdbMetadata = tvdbResult.value;
              contributions.tvdb = {
                primaryTitle: tvdbMetadata.title,
                aliases: tvdbMetadata.titles,
                year: tvdbMetadata.year,
                yearEnd: tvdbMetadata.yearEnd,
                runtime: tvdbMetadata.runtime,
                nextAirDate:
                  tvdbMetadata.nextAirDate &&
                  this.isDateInFuture(tvdbMetadata.nextAirDate)
                    ? tvdbMetadata.nextAirDate
                    : undefined,
                lastAiredDate: tvdbMetadata.lastAiredDate,
                firstAiredDate: tvdbMetadata.firstAiredDate,
                originalLanguage: tvdbMetadata.originalLanguage,
                country: tvdbMetadata.country,
                tvdbId: tvdbMetadata.tvdbId,
              };
            } else if (tvdbResult.status === 'rejected') {
              logger.warn(
                `Failed to fetch TVDB metadata for ${id.fullId}: ${tvdbResult.reason}`
              );
            }

            let skyhookValue: Metadata | undefined;
            if (skyhookResult.status === 'fulfilled') {
              skyhookValue = skyhookResult.value;
            } else {
              logger.debug(
                `Failed to fetch skyhook metadata for ${id.fullId}: ${skyhookResult.reason}`
              );
            }

            if (skyhookValue) {
              const sky = skyhookValue;
              contributions.skyhook = {
                primaryTitle: sky.title,
                aliases: sky.title
                  ? [{ title: sky.title, language: 'en' }]
                  : undefined,
                year: sky.year,
                originalLanguage: sky.originalLanguage,
                country: sky.country,
                seasons: sky.seasons,
                genres: sky.genres,
                runtime: sky.runtime,
                firstAiredDate: sky.firstAiredDate,
                lastAiredDate: sky.lastAiredDate,
                tmdbId: sky.tmdbId,
                tvdbId: sky.tvdbId,
              };
            }

            // Process Trakt results
            if (traktResult.status === 'fulfilled' && traktResult.value) {
              contributions.trakt = { aliases: traktResult.value };
            } else if (traktResult.status === 'rejected') {
              logger.warn(
                `Failed to fetch Trakt aliases for ${id.fullId}: ${traktResult.reason}`
              );
            }

            // Process IMDb results
            if (imdbResult.status === 'fulfilled' && imdbResult.value) {
              const cinemetaData = imdbResult.value;
              const cinemeta: SourceContribution = {
                primaryTitle: cinemetaData.name ?? undefined,
                genres: cinemetaData.genres ?? undefined,
              };

              if (cinemetaData.releaseInfo) {
                // IMDb writes ranges with an en dash: '2004–2010'
                const parts = cinemetaData.releaseInfo
                  .toString()
                  .split(/[-–—]/);
                const start = parts[0]?.trim();
                const end = parts[1]?.trim();
                if (start && Number.isFinite(Number(start)))
                  cinemeta.year = Number(start);
                if (end && Number.isFinite(Number(end))) {
                  // 'YYYY-YYYY'
                  cinemeta.yearEnd = Number(end);
                } else if (parts.length > 1) {
                  // 'YYYY-' (ongoing series)
                  cinemeta.yearEnd = new Date().getFullYear();
                }
              }

              if (cinemetaData.videos) {
                const episodeIndex = (video: {
                  episode?: number | null;
                }): number | undefined => {
                  if (typeof video.episode === 'number') return video.episode;
                  const n = (video as { number?: unknown }).number;
                  return typeof n === 'number' ? n : undefined;
                };
                cinemetaVideos = cinemetaData.videos.map((video) => ({
                  season: video.season,
                  episode: episodeIndex(video),
                  released: video.released,
                }));
                const seasonMap = new Map<number, Set<number>>();
                for (const video of cinemetaData.videos) {
                  const episode = episodeIndex(video);
                  if (
                    typeof video.season === 'number' &&
                    episode !== undefined
                  ) {
                    if (!seasonMap.has(video.season)) {
                      seasonMap.set(video.season, new Set());
                    }
                    seasonMap.get(video.season)!.add(episode);
                  }
                }
                const imdbSeasons = Array.from(seasonMap.entries()).map(
                  ([season_number, episodes]) => ({
                    season_number,
                    episode_count: episodes.size,
                  })
                );
                if (imdbSeasons.length) {
                  cinemeta.seasons = imdbSeasons.sort(
                    (a, b) => a.season_number - b.season_number
                  );
                }
              }

              if (
                cinemetaData.released &&
                typeof cinemetaData.released === 'string'
              ) {
                const parsedReleaseDate = new Date(cinemetaData.released);
                if (!isNaN(parsedReleaseDate.getTime())) {
                  cinemeta.releaseDate = parsedReleaseDate
                    .toISOString()
                    .split('T')[0];
                }
              }

              if (cinemetaData.runtime) {
                const parsed = parseDuration(
                  cinemetaData.runtime
                    .replace('min', 'm')
                    .replace('hr', 'h')
                    .replace(' ', '')
                    .trim()
                );
                const minutes = parsed ? Math.round(parsed / 60000) : undefined;
                // a sub-minute runtime is a parse artefact, not a real duration
                cinemeta.runtime =
                  minutes !== undefined && minutes <= 1 ? undefined : minutes;
              }

              contributions.cinemeta = cinemeta;
            } else if (imdbResult.status === 'rejected') {
              logger.warn(
                `Failed to fetch IMDb metadata for ${imdbId}: ${imdbResult.reason}`
              );
            }

            if (
              imdbSuggestionResult.status === 'fulfilled' &&
              imdbSuggestionResult.value
            ) {
              const imdbSuggestionData = imdbSuggestionResult.value;
              contributions.imdbSuggestion = {
                primaryTitle: imdbSuggestionData.title,
                year: imdbSuggestionData.year,
                yearEnd: imdbSuggestionData.yearEnd,
              };
            } else {
              logger.warn(
                `Failed to fetch IMDb suggestion data for ${imdbId}: ${imdbSuggestionResult.status === 'rejected' ? imdbSuggestionResult.reason : 'no data'}`
              );
            }

            const mediaType = type === 'movie' ? 'movie' : 'series';
            let merged = mergeMetadata(contributions, mediaType);

            // series only: movie results carry a year already
            let titleConflictsPromise: Promise<TitleConflict[]> | undefined;
            if (
              type === 'series' &&
              appConfig.metadata.titleConflicts.enabled &&
              merged.title
            ) {
              titleConflictsPromise = detectTitleConflicts({
                title: merged.title,
                year: merged.year,
                country: merged.country,
                tmdbId: merged.tmdbId,
                tvdbId: merged.tvdbId,
                tmdbAuth: {
                  accessToken: this.config.tmdbAccessToken,
                  apiKey: this.config.tmdbApiKey,
                },
                tvdbApiKey: this.config.tvdbApiKey,
              }).catch((error) => {
                logger.debug(
                  `Title conflict detection failed for ${id.fullId}: ${error}`
                );
                return [];
              });
            }

            // anime entries partition and renumber seasons
            const mapEpisodeForTmdb = () => {
              let seasonNumber = Number(id.season);
              let episodeNumber = Number(id.episode);
              if (animeEntry) {
                const originalSeason = seasonNumber;
                seasonNumber = animeEntry.tmdb?.seasonNumber ?? seasonNumber;
                if (animeEntry.tmdb?.fromEpisode) {
                  const fromEpisode = Number(animeEntry.tmdb.fromEpisode);
                  if (
                    seasonNumber !== originalSeason ||
                    episodeNumber < fromEpisode
                  ) {
                    episodeNumber = fromEpisode + episodeNumber - 1;
                  }
                }
              }
              return { seasonNumber, episodeNumber };
            };

            const tvdbAvailable = !!(
              this.config.tvdbApiKey || appConfig.metadata.tvdb.apiKey
            );
            const tmdbAvailable = !!(
              this.config.tmdbAccessToken ||
              this.config.tmdbApiKey ||
              appConfig.metadata.tmdb.accessToken ||
              appConfig.metadata.tmdb.apiKey
            );

            if (
              !merged.nextAirDate &&
              type === 'series' &&
              id.season &&
              id.episode
            ) {
              try {
                const tmdb = new TMDBMetadata({
                  accessToken: this.config.tmdbAccessToken,
                  apiKey: this.config.tmdbApiKey,
                });
                const { seasonNumber, episodeNumber } = mapEpisodeForTmdb();
                if (merged.tmdbId && merged.seasons) {
                  const tmdbNextAirDate = await tmdb.getNextEpisodeAirDate(
                    Number(merged.tmdbId),
                    seasonNumber,
                    episodeNumber,
                    merged.seasons
                  );
                  if (tmdbNextAirDate && this.isDateInFuture(tmdbNextAirDate)) {
                    contributions.tmdbEpisode = {
                      nextAirDate: tmdbNextAirDate,
                    };
                  }
                }
              } catch (error) {
                logger.debug(
                  `Failed to get next episode air date from TMDB for ${id.fullId}: ${error}`
                );
              }
            }

            let episodeFacts: EpisodeResolution | undefined;
            if (type === 'series' && id.season && id.episode) {
              try {
                const resolvedTvdbId = merged.tvdbId;
                const resolvedTmdbId = merged.tmdbId;
                episodeFacts = await resolveEpisodeFacts({
                  season: Number(id.season),
                  episode: Number(id.episode),
                  isAnime: !!animeEntry,
                  genres: merged.genres,
                  seasons: merged.seasons,
                  cinemetaVideos,
                  // skyhook also covers a keyed TVDB that errored or has no
                  // record of the season
                  fetchTvdbSeasonEpisodes: resolvedTvdbId
                    ? async (seasonNumber) => {
                        if (tvdbAvailable) {
                          const episodes = await new TVDBMetadata({
                            apiKey: this.config.tvdbApiKey,
                          }).getSeasonEpisodes(
                            Number(resolvedTvdbId),
                            seasonNumber
                          );
                          if (episodes?.length) return episodes;
                        }
                        return new SkyhookMetadata().getSeasonEpisodes(
                          Number(resolvedTvdbId),
                          seasonNumber
                        );
                      }
                    : undefined,
                  fetchTmdbEpisode:
                    tmdbAvailable && resolvedTmdbId
                      ? async (seasonNumber, episodeNumber) => {
                          try {
                            return await new TMDBMetadata({
                              accessToken: this.config.tmdbAccessToken,
                              apiKey: this.config.tmdbApiKey,
                            }).getEpisodeDetails(
                              Number(resolvedTmdbId),
                              seasonNumber,
                              episodeNumber
                            );
                          } catch (error) {
                            logger.debug(
                              `Failed to fetch TMDB episode details for ${id.fullId}: ${error}`
                            );
                            return undefined;
                          }
                        }
                      : undefined,
                  config: appConfig.builtins.scrape.dateBased,
                });
              } catch (error) {
                logger.warn(
                  `Failed to resolve episode facts for ${id.fullId}: ${error}`
                );
              }
            }

            // Sources name episodes differently (TMDB and Skyhook carry rival
            // English translations, keyed TVDB the original language for
            // anime) and release groups follow all of them, so collect all
            // that agree on which episode the request points at.
            let episodeTitles: MetadataTitle[] | undefined;
            let episodeYear: number | undefined;
            let seasonYear: number | undefined;
            if (type === 'series' && id.season && id.episode) {
              const seasonNumber =
                episodeFacts?.resolvedSeasonNumber ?? Number(id.season);
              const episodeNumber = Number(id.episode);
              const yearOf = (date?: string | null) => {
                if (!date) return undefined;
                const year = new Date(date).getFullYear();
                return Number.isNaN(year) ? undefined : year;
              };

              const [tmdbEpisode, tvdbEpisodes, skyhookShow] =
                await Promise.allSettled([
                  tmdbAvailable && merged.tmdbId
                    ? (() => {
                        const mapped = mapEpisodeForTmdb();
                        return new TMDBMetadata({
                          accessToken: this.config.tmdbAccessToken,
                          apiKey: this.config.tmdbApiKey,
                        }).getEpisodeDetails(
                          Number(merged.tmdbId),
                          mapped.seasonNumber,
                          mapped.episodeNumber
                        );
                      })()
                    : Promise.resolve(undefined),
                  tvdbAvailable && merged.tvdbId
                    ? new TVDBMetadata({
                        apiKey: this.config.tvdbApiKey,
                      }).getSeasonEpisodes(Number(merged.tvdbId), seasonNumber)
                    : Promise.resolve(undefined),
                  merged.tvdbId
                    ? new SkyhookMetadata().getShow(Number(merged.tvdbId))
                    : Promise.resolve(null),
                ]);

              // The requested episode as each source numbers it, kept with its
              // air date so numbering-scheme disagreements can be caught below.
              const tmdbEp =
                tmdbEpisode.status === 'fulfilled' && tmdbEpisode.value
                  ? {
                      airDate: tmdbEpisode.value.airDate,
                      titles: tmdbEpisode.value.titles ?? [],
                    }
                  : undefined;
              let tvdbEp:
                | { airDate?: string; titles: MetadataTitle[] }
                | undefined;
              if (tvdbEpisodes.status === 'fulfilled' && tvdbEpisodes.value) {
                const match = tvdbEpisodes.value.find(
                  (e) => e.number === episodeNumber
                );
                if (match) {
                  tvdbEp = {
                    airDate: match.aired ?? undefined,
                    titles: match.name ? [{ title: match.name }] : [],
                  };
                }
                for (const episode of tvdbEpisodes.value) {
                  const year = yearOf(episode.aired);
                  if (year && (seasonYear === undefined || year < seasonYear)) {
                    seasonYear = year;
                  }
                }
              }
              let skyhookEp:
                | { airDate?: string; titles: MetadataTitle[] }
                | undefined;
              if (skyhookShow.status === 'fulfilled' && skyhookShow.value) {
                for (const episode of skyhookShow.value.episodes ?? []) {
                  if (episode.seasonNumber !== seasonNumber) continue;
                  const year = yearOf(episode.airDate);
                  if (year && (seasonYear === undefined || year < seasonYear)) {
                    seasonYear = year;
                  }
                  if (episode.episodeNumber !== episodeNumber) continue;
                  skyhookEp = {
                    airDate: episode.airDate ?? undefined,
                    titles: episode.title
                      ? [{ title: episode.title, language: 'en' }]
                      : [],
                  };
                }
              }
              if (!seasonYear && cinemetaVideos?.length) {
                for (const video of cinemetaVideos) {
                  if (video.season !== seasonNumber || !video.released)
                    continue;
                  const year = yearOf(video.released);
                  if (year && (seasonYear === undefined || year < seasonYear)) {
                    seasonYear = year;
                  }
                }
              }
              episodeYear ??= yearOf(
                tmdbEp?.airDate ?? tvdbEp?.airDate ?? skyhookEp?.airDate
              );

              // (season, episode) numbers mean whatever the provider the
              // request was made in says they mean.
              const cinemetaReleased = cinemetaVideos?.find(
                (v) =>
                  v.season === Number(id.season) && v.episode === episodeNumber
              )?.released;
              const referenceAirDate =
                // the request's own provider is authoritative
                (id.type === 'themoviedbId' ? tmdbEp?.airDate : undefined) ??
                (id.type === 'thetvdbId' ? tvdbEp?.airDate : undefined) ??
                // imdb requests are numbered by cinemeta
                cinemetaReleased ??
                // always fallback to tvdb/skyhook first, then tmdb.
                tvdbEp?.airDate ??
                skyhookEp?.airDate ??
                tmdbEp?.airDate;
              const agreesWithRequest = (airDate?: string) => {
                if (!referenceAirDate || !airDate) return true;
                const ref = new Date(referenceAirDate).getTime();
                const value = new Date(airDate).getTime();
                if (Number.isNaN(ref) || Number.isNaN(value)) return true;
                return Math.abs(ref - value) <= 2 * 24 * 60 * 60 * 1000;
              };

              // TMDB first so its language tags survive dedup; skyhook (en)
              // before TVDB (untagged) so the English tag is kept when present.
              const names: MetadataTitle[] = [];
              for (const ep of [tmdbEp, skyhookEp, tvdbEp]) {
                if (!ep || !agreesWithRequest(ep.airDate)) continue;
                for (const title of ep.titles) {
                  if (
                    !names.some(
                      (name) =>
                        name.title.toLowerCase() === title.title.toLowerCase()
                    )
                  ) {
                    names.push(title);
                  }
                }
              }
              if (names.length) episodeTitles = deduplicateTitles(names);
            }

            // Left empty unless a season or episode year resolved: the
            // first-aired year alone cannot tell a mistagged release from a
            // correctly tagged later season.
            const releaseYears =
              seasonYear !== undefined || episodeYear !== undefined
                ? [
                    ...new Set(
                      [merged.year, seasonYear, episodeYear].filter(
                        (year): year is number => year !== undefined
                      )
                    ),
                  ]
                : [];

            let sceneTitles: string[] | undefined;
            if (
              type === 'series' &&
              merged.tvdbId &&
              appConfig.metadata.sceneMappings.enabled
            ) {
              try {
                const aliases =
                  SceneMappingDataset.getInstance().getSearchTitles(
                    Number(merged.tvdbId),
                    {
                      seasons: [
                        id.season ? Number(id.season) : undefined,
                        episodeFacts?.resolvedSeasonNumber,
                      ],
                      // the most canonical title known before the primary is picked
                      canonicalTitle: assembleTitles(contributions)[0]?.title,
                    }
                  );
                if (aliases.length) {
                  sceneTitles = aliases;
                  contributions.scene = {
                    aliases: aliases.map((title) => ({ title })),
                  };
                }
              } catch (error) {
                logger.debug(
                  `Failed to get scene mappings for ${id.fullId}: ${error}`
                );
              }
            }

            // re-merge: the episode and scene steps added contributions
            merged = mergeMetadata(contributions, mediaType);

            if (
              !merged.titles.length ||
              (merged.year === undefined && id.mediaType === 'movie')
            ) {
              throw new Error(`Could not find metadata for ${id.fullId}`);
            }

            const titleConflicts = titleConflictsPromise
              ? await titleConflictsPromise
              : undefined;

            const metadata = {
              title: merged.title,
              titles: merged.titles,
              year: merged.year,
              yearEnd: merged.yearEnd,
              originalLanguage: merged.originalLanguage,
              country: merged.country,
              titleConflicts: titleConflicts?.length
                ? titleConflicts
                : undefined,
              episodeTitles,
              releaseYears: releaseYears.length ? releaseYears : undefined,
              seasons: merged.seasons,
              releaseDate: merged.releaseDate,
              tmdbId: merged.tmdbId,
              tvdbId: merged.tvdbId,
              runtime: merged.runtime,
              genres: merged.genres,
              nextAirDate: merged.nextAirDate,
              firstAiredDate: merged.firstAiredDate,
              lastAiredDate: merged.lastAiredDate,
              isDateBased: episodeFacts?.isDateBased || undefined,
              episodeAirDates: episodeFacts?.episodeAirDates,
              episodeAirDate: episodeFacts?.episodeAirDates?.[0],
              resolvedSeasonNumber: episodeFacts?.resolvedSeasonNumber,
              resolvedSeasonFirstEpisode:
                episodeFacts?.resolvedSeasonFirstEpisode,
              sceneTitles,
            };
            logger.debug(
              `Found metadata for ${id.fullId} in ${getTimeTakenSincePoint(start)}`,
              {
                ...metadata,
                titles: metadata.titles.map(
                  (t) => `${t.title}${t.language ? ` (${t.language})` : ''}`
                ),
                seasons: metadata.seasons?.map(
                  (s) => `{s:${s.season_number},e:${s.episode_count}}`
                ),
                titleConflicts: metadata.titleConflicts?.map(
                  (c) =>
                    `${c.title} (${c.year ?? '?'}${c.country ? `, ${c.country}` : ''})`
                ),
                titleCount: merged.titleCandidateCount,
              }
            );
            return metadata;
          },
          {
            timeout: 10000,
            ttl: 12000,
            retryInterval: 100,
            type: 'memory',
          }
        );

        return result;
      },
      {
        getContext: () => `metadata ${id.fullId}`,
      }
    );
  }
}
