/**
 * Pick the best canonical record for a (idType, idValue, season?, episode?)
 * lookup:
 *
 *   1. Type-filter the candidate set by movie/special/tv plausibility for the
 *      requested season number.
 *   2. If a season is supplied, score each candidate using the available season
 *      hints (trakt / imdb-cour / tvdb / tmdb / synonym). A season number is
 *      only authoritative in its own coordinate system, so the hint matching
 *      the query's id type wins and cross-system numbers are demoted (split-cour
 *      series number their cours differently per source).
 *   3. Fall back to the first candidate.
 */
import type { IdType } from '../utils/id-parser.js';
import { AnimeType, type AnimeRecord, type IdValue } from './types.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('anime-database:selector');

const SEASON_REGEX_CACHE = new Map<number, RegExp>();
function seasonRegex(season: number): RegExp {
  let r = SEASON_REGEX_CACHE.get(season);
  if (!r) {
    r = new RegExp(`season[\\s_-]*${season}`, 'i');
    SEASON_REGEX_CACHE.set(season, r);
  }
  return r;
}

/** Highest season number this record claims, in any source's coordinates. */
function advertisedSeasonOf(r: AnimeRecord): number {
  return Math.max(
    typeof r.tvdb?.seasonNumber === 'number' ? r.tvdb.seasonNumber : 0,
    typeof r.tmdb?.seasonNumber === 'number' ? r.tmdb.seasonNumber : 0,
    typeof r.trakt?.seasonNumber === 'number' ? r.trakt.seasonNumber : 0
  );
}

/**
 * Filter candidates by type plausibility for the requested season:
 *   - season undefined: prefer movies.
 *   - season 0: prefer specials/OVA/ONA.
 *   - season >= 1: keep TV, plus non-TV cours advertising a season > 1, plus
 *     non-TV cours advertising exactly the requested season as long as no TV
 *     record claims that season too.
 *
 * Returns the original list if filtering would empty it.
 */
export function filterCandidatesBySeasonType(
  candidates: AnimeRecord[],
  season?: number
): AnimeRecord[] {
  if (candidates.length <= 1) return candidates;
  const tvClaimsSeason =
    season !== undefined &&
    candidates.some(
      (r) => r.type === AnimeType.TV && advertisedSeasonOf(r) === season
    );
  const filtered = candidates.filter((r) => {
    if (r.type === AnimeType.UNKNOWN) return true;
    if (season === undefined) return r.type === AnimeType.MOVIE;
    if (season === 0) {
      return [AnimeType.SPECIAL, AnimeType.OVA, AnimeType.ONA].includes(r.type);
    }
    if (r.type !== AnimeType.TV) {
      const advertisedSeason = advertisedSeasonOf(r);
      if (advertisedSeason > 1) return true;
      if (!tvClaimsSeason && advertisedSeason === season) return true;
    }
    return r.type === AnimeType.TV;
  });
  return filtered.length > 0 ? filtered : candidates;
}

/**
 * Pick the best record for a season/episode lookup. Returns `null` if the
 * candidate set is empty.
 */
export function selectBestRecord(
  candidates: AnimeRecord[],
  idType: IdType,
  idValue: IdValue,
  season?: number,
  episode?: number
): AnimeRecord | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  logger.debug({ candidates, season, episode }, 'selecting best record');

  // A season lookup with no concrete episode is treated as a request for the
  // start of that season (episode 1), so the scorer's `episode >= fromEpisode`
  // gates resolve to the season-opening cour rather than its tail.
  if (season !== undefined) {
    const best = scoreBySeasonEpisode(candidates, season, episode ?? 1, idType);
    if (best) return best;

    // Last-resort synonym walk if nothing scored at all.
    const re = seasonRegex(season);
    for (const c of candidates) {
      if (c.synonyms?.some((s) => re.test(s))) {
        logger.debug(
          { id: `${idType}:${idValue}`, season, rid: c.rid },
          'matched season regex on synonym'
        );
        return c;
      }
    }
  }

  return candidates[0];
}

/**
 * Which per-source season hint shares the coordinate system of a given id type.
 * A seasonNumber is only comparable to the requested season when the lookup is
 * by that source's own id: split-cour series number their cours differently
 * across sources (Trakt counts each cour as its own season while IMDb/TVDB/TMDB
 * merge them), so cross-system matches mislead.
 */
type SeasonSource = 'imdb' | 'tvdb' | 'tmdb' | 'trakt';
const NATIVE_SEASON_SOURCE: Partial<Record<IdType, SeasonSource>> = {
  imdbId: 'imdb',
  thetvdbId: 'tvdb',
  themoviedbId: 'tmdb',
  traktId: 'trakt',
};

interface Candidate {
  record: AnimeRecord;
  /** Higher = better match (ranking primary key). */
  priority: number;
  /** Higher fromEpisode wins among equal-priority candidates. */
  fromEpisode: number;
  reason: string;
}

function scoreBySeasonEpisode(
  candidates: AnimeRecord[],
  season: number,
  episode: number,
  idType: IdType
): AnimeRecord | null {
  const scored: Candidate[] = [];

  // Each season hint is authoritative only when the lookup shares its
  // coordinate system. When the query is by a known id type, the matching
  // source's exact match wins (100) and other sources' season numbers drop to a
  // cross-system last resort (30). Otherwise fall back to the source-reliability
  // ordering below.
  const native = NATIVE_SEASON_SOURCE[idType];
  // Source-reliability ordering when the query has no native season source:
  // imdb (kitsu cour mapping) -> tvdb -> trakt -> tmdb.
  const FALLBACK: Record<SeasonSource, number> = {
    imdb: 100,
    tvdb: 90,
    trakt: 80,
    tmdb: 70,
  };
  const prio = (src: SeasonSource): number =>
    native ? (src === native ? 100 : 30) : FALLBACK[src];
  const synonymPriority = native ? 55 : 60;
  // The kitsu IMDb-cour range fallback is an IMDb-coordinate heuristic, so it
  // only applies when the lookup is in that coordinate system.
  const imdbInCoordinate = native === 'imdb' || native === undefined;

  // Pre-pass for the kitsu IMDb-cour "range" rule. The mapping records only
  // where each cour starts (`fromSeason`), and a cour can span several IMDb
  // seasons. `rangeWinner` is the cour with the greatest start <= the requested
  // season; `hasLaterCour` flags whether a cour starts after it, distinguishing
  // interpolation (season sits in a gap between known cours, reliable) from
  // extrapolation (season is past the last cour, unreliable - usually a new
  // season the mapping hasn't covered yet).
  let rangeWinner: AnimeRecord | null = null;
  let rangeFromSeason = -1;
  let hasLaterCour = false;
  for (const r of candidates) {
    const fs = r.imdb?.fromSeason;
    if (typeof fs !== 'number') continue;
    if (fs > season) {
      hasLaterCour = true;
      continue;
    }
    if (fs > rangeFromSeason) {
      rangeFromSeason = fs;
      rangeWinner = r;
    }
  }

  for (const r of candidates) {
    // Trakt season number.
    if (typeof r.trakt?.seasonNumber === 'number') {
      if (r.trakt.seasonNumber === season) {
        scored.push({
          record: r,
          priority: prio('trakt'),
          fromEpisode: 1,
          reason: 'trakt-season',
        });
      }
    }
    // Kitsu IMDb-cour mapping. Exact match.
    if (
      typeof r.imdb?.fromSeason === 'number' &&
      r.imdb.fromSeason === season
    ) {
      const fromEpisode = r.imdb.fromEpisode ?? 1;
      if (episode >= fromEpisode) {
        scored.push({
          record: r,
          priority: prio('imdb'),
          fromEpisode,
          reason: 'kitsu-fromSeason',
        });
      }
    }
    // Kitsu IMDb-cour mapping, range fallback. Ranked *below* the other
    // per-source season signals (tvdb/tmdb/synonym) so that when Kitsu has no
    // exact mapping for the requested season we defer to the next best source.
    // Interpolation (a gap between known cours) is trusted above fuzzy synonym
    // matches; extrapolation past the last cour is a true last resort.
    if (imdbInCoordinate && r === rangeWinner && rangeFromSeason !== season) {
      scored.push({
        record: r,
        priority: hasLaterCour ? 65 : 40,
        fromEpisode: r.imdb?.fromEpisode ?? 1,
        reason: hasLaterCour
          ? 'kitsu-fromSeason-range'
          : 'kitsu-fromSeason-extrapolated',
      });
    }
    // Anime-Lists XML defaultTvdbSeason match. The 'a' (absolute-numbering)
    // variant only applies when the caller itself uses TVDB absolute numbering;
    // for other id types it produces false positives.
    if (
      r.tvdb?.seasonNumber !== undefined &&
      r.tvdb.seasonNumber !== null &&
      (r.tvdb.seasonNumber === season ||
        (r.tvdb.seasonNumber === 'a' && idType === 'thetvdbId'))
    ) {
      const fromEpisode = r.tvdb.fromEpisode ?? 1;
      if (episode >= fromEpisode) {
        scored.push({
          record: r,
          priority: prio('tvdb'),
          fromEpisode,
          reason: 'tvdb-default',
        });
      }
    }
    // Anime-Lists XML tmdbSeason match.
    if (
      typeof r.tmdb?.seasonNumber === 'number' &&
      r.tmdb.seasonNumber === season
    ) {
      const fromEpisode = r.tmdb.fromEpisode ?? 1;
      if (episode >= fromEpisode) {
        scored.push({
          record: r,
          priority: prio('tmdb'),
          fromEpisode,
          reason: 'tmdb-default',
        });
      }
    }
    // Synonym match: title-based, coordinate-system agnostic.
    if (r.synonyms?.some((s) => seasonRegex(season).test(s))) {
      scored.push({
        record: r,
        priority: synonymPriority,
        fromEpisode: 1,
        reason: 'synonym',
      });
    }
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.fromEpisode - a.fromEpisode;
  });

  const best = scored[0];
  logger.debug(
    {
      seasonEpisode: `S${season}E${episode}`,
      rid: best.record.rid,
      reason: best.reason,
      fromEpisode: best.fromEpisode,
    },
    'selector picked candidate'
  );
  return best.record;
}
