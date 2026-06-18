/**
 * Build the public-facing {@link AnimeEntry} from a chosen {@link AnimeRecord}.
 */
import {
  AnimeType,
  type AnimeEntry,
  type AnimeEntryMappings,
  type AnimeRecord,
} from './types.js';

const MAPPING_FIELDS: Array<keyof AnimeEntryMappings> = [
  'animePlanetId',
  'animecountdownId',
  'anidbId',
  'anilistId',
  'anisearchId',
  'imdbId',
  'kitsuId',
  'livechartId',
  'malId',
  'notifyMoeId',
  'simklId',
  'themoviedbId',
  'thetvdbId',
  'traktId',
];

export function buildAnimeEntry(record: AnimeRecord): AnimeEntry {
  const mappings: AnimeEntryMappings = {};
  for (const field of MAPPING_FIELDS) {
    const value = record.ids[field];
    if (value !== undefined && value !== null) {
      (mappings as Record<string, unknown>)[field] = value;
    }
  }

  const tvdbSeasonNumber =
    record.tvdb?.seasonNumber === 'a'
      ? null
      : (record.tvdb?.seasonNumber ?? null);
  const tvdbSeasonId = record.tvdb?.seasonId ?? null;
  const tvdbFromEpisode = record.tvdb?.fromEpisode ?? null;

  const tmdbSeasonNumber = record.tmdb?.seasonNumber ?? null;
  const tmdbSeasonId = record.tmdb?.seasonId ?? null;
  const tmdbFromEpisode = record.tmdb?.fromEpisode ?? null;

  const imdbBlock: AnimeEntry['imdb'] =
    record.imdb &&
    (record.imdb.title ||
      record.imdb.fromSeason !== undefined ||
      record.imdb.fromEpisode !== undefined ||
      record.imdb.nonImdbEpisodes)
      ? {
          seasonNumber: record.imdb.fromSeason,
          fromEpisode: record.imdb.fromEpisode,
          nonImdbEpisodes: record.imdb.nonImdbEpisodes,
          title: record.imdb.title,
        }
      : null;

  const fanartBlock: AnimeEntry['fanart'] =
    typeof record.fanart?.logoId === 'number'
      ? { logoId: record.fanart.logoId }
      : null;

  let traktBlock: AnimeEntry['trakt'] = null;
  if (record.trakt?.title && record.trakt.slug) {
    traktBlock = {
      title: record.trakt.title,
      slug: record.trakt.slug,
      isSplitCour: record.trakt.isSplitCour,
      seasonId: record.trakt.seasonId ?? null,
      seasonNumber: record.trakt.seasonNumber ?? null,
    };
  }

  return {
    mappings,
    tmdb: {
      seasonNumber: tmdbSeasonNumber,
      seasonId: tmdbSeasonId,
      fromEpisode: tmdbFromEpisode,
    },
    tvdb: {
      seasonNumber: tvdbSeasonNumber,
      seasonId: tvdbSeasonId,
      fromEpisode: tvdbFromEpisode,
    },
    imdb: imdbBlock,
    fanart: fanartBlock,
    trakt: traktBlock,
    type: record.type ?? AnimeType.UNKNOWN,
    title: record.title,
    animeSeason: record.animeSeason,
    synonyms: record.synonyms,
    episodeMappings: record.tvdb?.episodeMappings,
  };
}
