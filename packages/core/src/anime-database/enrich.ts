/**
 * Helpers that apply anime-database knowledge to a parsed Stremio id, in place.
 */
import type { ParsedId } from '../utils/id-parser.js';
import { createLogger } from '../logging/logger.js';
import type { AnimeEntry } from './types.js';

const logger = createLogger('anime-database:enrich');

/** Id types whose episode numbers count within the anime entry. */
const ENTRY_EPISODE_ID_TYPES = ['malId', 'kitsuId', 'anilistId', 'anidbId'];

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
    ENTRY_EPISODE_ID_TYPES.includes(parsedId.type) &&
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

  // Apply the fromEpisode offset only if the per-cour episodeMappings pass
  // didn't already shift the episode.
  if (
    parsedId.episode &&
    ENTRY_EPISODE_ID_TYPES.includes(parsedId.type) &&
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

/** The IMDb show an id's enriched season and episode are numbered in. */
export function getEnrichedImdbId(
  parsedId: ParsedId,
  entry: AnimeEntry | null
): string | undefined {
  if (ENTRY_EPISODE_ID_TYPES.includes(parsedId.type) && entry?.imdb?.id) {
    return entry.imdb.id;
  }
  return entry?.mappings?.imdbId?.toString();
}

type SeasonCounts = { season_number: number; episode_count: number }[];

/** An IMDb-numbered or enriched episode counted from the entry's first. */
function getEntryEpisode(
  parsedId: ParsedId,
  entry: AnimeEntry,
  seasons: SeasonCounts
): number | undefined {
  const start =
    entry.imdb?.seasonNumber ??
    entry.tvdb?.seasonNumber ??
    entry.trakt?.seasonNumber ??
    entry.tmdb?.seasonNumber;
  if (!start || !parsedId.season || !parsedId.episode) return undefined;
  const season = Number(parsedId.season);
  const episode = Number(parsedId.episode);

  let before = 0;
  for (const s of seasons) {
    if (s.season_number === 0 || s.season_number < start) continue;
    if (String(s.season_number) === parsedId.season) break;
    before += s.episode_count;
  }
  const from =
    (parsedId.type === 'imdbId'
      ? entry.imdb?.seasonNumber != null
        ? entry.imdb.fromEpisode
        : undefined
      : (entry.imdb?.fromEpisode ?? entry.tvdb?.fromEpisode)) ?? 1;
  const offset =
    from > 1 && (season > start || (season === start && episode >= from))
      ? from - 1
      : 0;
  return before + episode - offset;
}

export function getTmdbEpisode(
  parsedId: ParsedId,
  entry: AnimeEntry | null,
  seasons: SeasonCounts
): { seasonNumber: number; episodeNumber: number } {
  const season = Number(parsedId.season);
  let episodeNumber = Number(parsedId.episode);
  if (!entry) return { seasonNumber: season, episodeNumber };
  const seasonNumber = entry.tmdb?.seasonNumber ?? season;
  const fromEpisode = entry.tmdb?.fromEpisode ?? undefined;
  if (seasonNumber !== season) {
    const local =
      parsedId.type === 'imdbId' ||
      ENTRY_EPISODE_ID_TYPES.includes(parsedId.type)
        ? (getEntryEpisode(parsedId, entry, seasons) ?? episodeNumber)
        : episodeNumber;
    episodeNumber = (fromEpisode ?? 1) + local - 1;
  } else if (fromEpisode && episodeNumber < fromEpisode) {
    episodeNumber = fromEpisode + episodeNumber - 1;
  }
  return { seasonNumber, episodeNumber };
}
