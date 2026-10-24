import type { AnimeEntry } from '../../anime-database/types.js';
import type { SegmentIdKey } from './types.js';

/** A season/episode pair of a show's video list, as Cinemeta publishes it. */
export interface ShowVideo {
  season?: number | null;
  episode?: number | null;
}

const ANIME_KEYS = new Set<SegmentIdKey>(['mal', 'kitsu', 'anilist', 'anidb']);

interface Start {
  season: number;
  fromEpisode: number;
  /** Entry episodes the stated numbering skips, IMDb's only. */
  skipped: number[];
}

/**
 * Where the entry starts in the stated id space's numbering. IMDb falls back
 * to TVDB's, which it follows for anime when the IMDb mapping has no row. An
 * IMDb row for another show (a spin-off or a sequel listed separately) says
 * nothing about this one's numbering.
 */
function startOf(
  entry: AnimeEntry,
  stated: SegmentIdKey,
  statedId: string
): Start | null {
  const imdb = entry.imdb;
  if (stated === 'imdb' && imdb?.id && imdb.id !== statedId) return null;
  if (stated === 'imdb' && typeof imdb?.seasonNumber === 'number') {
    return {
      season: imdb.seasonNumber,
      fromEpisode: imdb.fromEpisode ?? 1,
      skipped: imdb.nonImdbEpisodes ?? [],
    };
  }
  const hints =
    stated === 'tmdb'
      ? entry.tmdb
      : stated === 'tvdb' || stated === 'imdb'
        ? entry.tvdb
        : undefined;
  if (typeof hints?.seasonNumber !== 'number') return null;
  return {
    season: hints.seasonNumber,
    fromEpisode: hints.fromEpisode ?? 1,
    skipped: [],
  };
}

/** 1-based position of `to` counted from `from` in the show's aired order, both inclusive. */
function position(
  videos: ShowVideo[],
  from: { season: number; episode: number },
  to: { season: number; episode: number }
): number | null {
  const seen = new Set<string>();
  let found = false;
  let count = 0;
  for (const video of videos) {
    const { season, episode } = video;
    if (typeof season !== 'number' || typeof episode !== 'number') continue;
    if (season < 1 || seen.has(`${season}:${episode}`)) continue;
    seen.add(`${season}:${episode}`);
    const afterStart =
      season > from.season ||
      (season === from.season && episode >= from.episode);
    const beforeEnd =
      season < to.season || (season === to.season && episode <= to.episode);
    if (!afterStart || !beforeEnd) continue;
    count++;
    if (season === to.season && episode === to.episode) found = true;
  }
  return found ? count : null;
}

/**
 * The episode's number inside one anime entry (a MAL/AniDB record, typically
 * one cour), which is how AniSkip files its timestamps. `season`/`episode` are
 * in the stated id's numbering; an entry that spans several of its seasons
 * (One Piece on IMDb) needs the show's `videos` to count through them.
 * `null` when it cannot be told: a guessed number names another episode's
 * timestamps, which is worse than none.
 */
export function entryEpisode(
  entry: AnimeEntry,
  stated: SegmentIdKey,
  statedId: string,
  season: number | undefined,
  episode: number | undefined,
  videos?: ShowVideo[]
): number | null {
  if (!episode) return null;
  if (ANIME_KEYS.has(stated)) return episode;
  if (season == null) return null;
  const start = startOf(entry, stated, statedId);
  if (!start) return null;

  let inEntry: number | null;
  if (season === start.season) {
    inEntry = episode - start.fromEpisode + 1;
  } else if (
    season > start.season &&
    stated === 'imdb' &&
    entry.tvdb?.absoluteOrder &&
    videos
  ) {
    inEntry = position(
      videos,
      { season: start.season, episode: start.fromEpisode },
      { season, episode }
    );
  } else {
    // A later season this entry does not cover: the database holds no record for it yet.
    return null;
  }
  if (inEntry === null || inEntry < 1) return null;

  // Episodes the stated numbering never aired still take a number in the entry.
  for (const skipped of [...start.skipped].sort((a, b) => a - b)) {
    if (skipped <= inEntry) inEntry++;
  }
  return inEntry;
}

/** Whether `entryEpisode` will need the show's video list for this entry. */
export function needsVideos(
  entry: AnimeEntry,
  stated: SegmentIdKey,
  statedId: string,
  season: number | undefined
): boolean {
  if (stated !== 'imdb' || season == null || !entry.tvdb?.absoluteOrder)
    return false;
  const start = startOf(entry, stated, statedId);
  return !!start && season > start.season;
}
