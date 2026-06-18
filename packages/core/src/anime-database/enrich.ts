/**
 * Helpers that apply anime-database knowledge to a parsed Stremio id, in place.
 */
import type { ParsedId } from '../utils/id-parser.js';
import { createLogger } from '../logging/logger.js';
import type { AnimeEntry } from './types.js';

const logger = createLogger('anime-database:enrich');

/**
 * Extract a season number from any anime synonym matching `Season N` or `S N`.
 * Returns the captured number as a string.
 */
export function getSeasonFromSynonyms(
  synonyms: readonly string[]
): string | undefined {
  const re = /(?:season|s)\s(\d+)/i;
  for (const s of synonyms) {
    const m = s.match(re);
    if (m) return m[1].toString().trim();
  }
  return undefined;
}

/**
 * Mutate `parsedId` so its `season` / `episode` reflect the best available
 * mapping from the anime database for the underlying id system.
 */
export function enrichParsedIdWithAnimeEntry(
  parsedId: ParsedId,
  animeEntry: AnimeEntry
): void {
  const original = { season: parsedId.season, episode: parsedId.episode };
  let enriched = false;

  const imdbId = animeEntry.mappings?.imdbId;
  let episodeOffsetApplied = false;

  // Per-cour episode-range mapping for split-season anime via Anime-Lists XML.
  if (
    parsedId.episode &&
    ['malId', 'kitsuId', 'anilistId'].includes(parsedId.type) &&
    animeEntry.episodeMappings &&
    animeEntry.episodeMappings.length > 0
  ) {
    const episodeNum = Number(parsedId.episode);
    const mapping = animeEntry.episodeMappings.find(
      (m) =>
        m.start !== undefined &&
        m.end !== undefined &&
        episodeNum >= m.start &&
        episodeNum <= m.end
    );

    if (mapping) {
      const mappedSeason = mapping.tvdbSeason;
      const shouldApplyEpisodeOffset = imdbId && ['tt1528406'].includes(imdbId);

      if (
        mappedSeason &&
        shouldApplyEpisodeOffset &&
        mapping.offset !== undefined
      ) {
        parsedId.season = mappedSeason.toString();
        parsedId.episode = (episodeNum + mapping.offset).toString();
        enriched = true;
        episodeOffsetApplied = true;
        logger.debug(
          {
            id: `${parsedId.type}:${parsedId.value}`,
            originalEpisode: episodeNum,
            mappedSeason: parsedId.season,
            mappedEpisode: parsedId.episode,
            ...mapping,
          },
          'applied episode mapping'
        );
      }
    }
  }

  if (!parsedId.season) {
    parsedId.season =
      animeEntry.imdb?.seasonNumber?.toString() ??
      (typeof animeEntry.tvdb?.seasonNumber === 'number'
        ? animeEntry.tvdb.seasonNumber.toString()
        : undefined) ??
      animeEntry.trakt?.seasonNumber?.toString() ??
      getSeasonFromSynonyms(animeEntry.synonyms ?? []) ??
      animeEntry.tmdb?.seasonNumber?.toString();

    if (parsedId.season) enriched = true;
  }

  // Apply MAL/Kitsu fromEpisode offset only if the per-cour episodeMappings
  // pass didn't already shift the episode.
  if (
    parsedId.episode &&
    ['malId', 'kitsuId'].includes(parsedId.type) &&
    !episodeOffsetApplied
  ) {
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
    logger.debug(
      {
        original: `${parsedId.type}:${parsedId.value}${original.season ? `:${original.season}` : ''}${original.episode ? `:${original.episode}` : ''}`,
        enriched: `${parsedId.type}:${parsedId.value}${parsedId.season ? `:${parsedId.season}` : ''}${parsedId.episode ? `:${parsedId.episode}` : ''}`,
      },
      'enriched anime ID'
    );
  }
}
