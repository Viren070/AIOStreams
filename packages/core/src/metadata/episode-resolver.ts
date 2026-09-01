/**
 * Resolves per-episode facts for a series request: whether the show is
 * date-based, the episode's local air date, and the shape of the
 * requested season.
 *
 * The requested (season, episode) is only meaningful in the numbering scheme
 * of whichever meta addon produced the request (Cinemeta/TVDB year seasons,
 * canonical ordinal renumbers, TMDB partitioning), so resolution is
 * direct-first per source with an ordinal fallback.
 */

const DATE_BASED_GENRES = new Set(['talk show', 'talk', 'news', 'soap']);
const ANIMATION_GENRE = 'animation';

export interface SeasonRecord {
  season_number: number;
  episode_count: number;
}

export interface CinemetaVideo {
  season?: number | null;
  episode?: number | null;
  released?: string | null;
}

export interface EpisodeResolverInput {
  season: number;
  episode: number;
  isAnime: boolean;
  genres?: string[];
  seasons?: SeasonRecord[];
  cinemetaVideos?: CinemetaVideo[];
  /** Returns the episodes of a TVDB season (default order), or undefined when unavailable. */
  fetchTvdbSeasonEpisodes?: (
    seasonNumber: number
  ) => Promise<{ number: number; aired: string | null }[] | undefined>;
  /** Returns TVDB's real official season numbers for the series; only called for year-numbered seasons. */
  fetchTvdbSeriesSeasons?: () => Promise<number[] | undefined>;
  /** Returns TMDB episode details, undefined on 404/unavailable. */
  fetchTmdbEpisode?: (
    seasonNumber: number,
    episodeNumber: number
  ) => Promise<{ airDate?: string } | undefined>;
  config: {
    enabled: boolean;
    episodeCountThreshold: number;
    minSeasons: number;
  };
}

export interface EpisodeResolution {
  isDateBased: boolean;
  episodeAirDates?: string[];
  resolvedSeasonNumber?: number;
  resolvedSeasonFirstEpisode?: number;
  /** The season number under the other (year vs. ordinal) convention, if it differs. */
  alternateSeasonNumber?: number;
}

/**
 * Cinemeta `released` is a UTC instant of the airing; release names use the
 * local air date. Evening shows (US and UK) land on the next UTC day, so
 * shifting back 12 hours recovers the local date. Morning shows can be off by
 * one; TVDB/TMDB take priority when available.
 */
export function cinemetaReleasedToLocalDate(
  released: string
): string | undefined {
  const time = new Date(released).getTime();
  if (Number.isNaN(time)) {
    return undefined;
  }
  return new Date(time - 12 * 3600_000).toISOString().slice(0, 10);
}

export async function resolveEpisodeFacts(
  input: EpisodeResolverInput
): Promise<EpisodeResolution> {
  const { season, episode, config } = input;

  let nonSpecialSeasons = (input.seasons ?? [])
    .filter((s) => s.season_number > 0)
    .sort((a, b) => a.season_number - b.season_number);

  const hasYearSeasons = nonSpecialSeasons.some((s) => s.season_number > 1900);
  if (hasYearSeasons && input.fetchTvdbSeriesSeasons) {
    const seasonNumbers = await input.fetchTvdbSeriesSeasons();
    const known = new Set(nonSpecialSeasons.map((s) => s.season_number));
    const missing = (seasonNumbers ?? [])
      .filter((n) => !known.has(n))
      .map((season_number) => ({ season_number, episode_count: 0 }));
    if (missing.length) {
      nonSpecialSeasons = [...nonSpecialSeasons, ...missing].sort(
        (a, b) => a.season_number - b.season_number
      );
    }
  }

  const directSeason = nonSpecialSeasons.find(
    (s) => s.season_number === season
  );
  // Ordinal candidate: the S-th aired season. Only meaningful when the request
  // uses a scheme whose season labels differ (canonical renumbers of year
  // seasons); for 1..n-numbered shows it equals the direct match.
  const ordinalSeason =
    !directSeason &&
    season >= 1 &&
    season <= nonSpecialSeasons.length &&
    nonSpecialSeasons[season - 1].episode_count >= episode
      ? nonSpecialSeasons[season - 1]
      : undefined;
  const resolvedSeason = directSeason ?? ordinalSeason;

  let alternateSeasonNumber: number | undefined;
  if (hasYearSeasons && resolvedSeason) {
    const ordinalPosition = nonSpecialSeasons.indexOf(resolvedSeason) + 1;
    const realNumber = resolvedSeason.season_number;
    if (realNumber !== ordinalPosition) {
      alternateSeasonNumber =
        season === realNumber ? ordinalPosition : realNumber;
    }
  }

  let resolvedSeasonFirstEpisode: number | undefined;
  if (resolvedSeason && input.cinemetaVideos?.length) {
    for (const v of input.cinemetaVideos) {
      if (v.season !== resolvedSeason.season_number) continue;
      const ep = v.episode ?? undefined;
      if (ep === undefined) continue;
      if (
        resolvedSeasonFirstEpisode === undefined ||
        ep < resolvedSeasonFirstEpisode
      ) {
        resolvedSeasonFirstEpisode = ep;
      }
    }
  }

  const genres = (input.genres ?? []).map((g) => g.toLowerCase());
  // an unresolvable season with a huge episode number is a foreign numbering
  // scheme over a daily-sized season (e.g. a TMDB-scheme S42E220 request
  // against a TVDB year-season list)
  const largeSeasonSignal = resolvedSeason
    ? resolvedSeason.episode_count >= config.episodeCountThreshold
    : episode >= config.episodeCountThreshold;
  const isDateBased =
    config.enabled &&
    !input.isAnime &&
    (resolvedSeasonFirstEpisode ?? 1) <= 1 &&
    (((resolvedSeason?.season_number ?? season) >= 1900 && largeSeasonSignal) ||
      genres.some((g) => DATE_BASED_GENRES.has(g)) ||
      (largeSeasonSignal &&
        nonSpecialSeasons.length >= config.minSeasons &&
        !genres.includes(ANIMATION_GENRE)));

  const resolution: EpisodeResolution = {
    isDateBased,
    resolvedSeasonNumber: resolvedSeason?.season_number,
    resolvedSeasonFirstEpisode,
    alternateSeasonNumber,
  };

  if (!isDateBased) {
    return resolution;
  }

  // Direct (S,E) lookups, highest-priority source that hits wins. Ordinal is
  // never applied when any direct hit exists: a TMDB-scheme request (S42E220)
  // ordinally mapped onto year seasons validates against the wrong year.
  const findCinemetaDate = (s: number, e: number): string | undefined => {
    const video = input.cinemetaVideos?.find(
      (v) => v.season === s && v.episode === e
    );
    return video?.released
      ? cinemetaReleasedToLocalDate(video.released)
      : undefined;
  };

  let airDate: string | undefined;
  let directHit = false;

  if (input.fetchTvdbSeasonEpisodes) {
    const episodes = await input.fetchTvdbSeasonEpisodes(season);
    const match = episodes?.find((e) => e.number === episode);
    if (match) {
      directHit = true;
      airDate = match.aired ?? undefined;
    }
  }
  if (!directHit && input.fetchTmdbEpisode) {
    const details = await input.fetchTmdbEpisode(season, episode);
    if (details) {
      directHit = true;
      airDate = details.airDate;
    }
  }
  if (!directHit) {
    const date = findCinemetaDate(season, episode);
    if (date) {
      directHit = true;
      airDate = date;
    }
  }

  if (!directHit && ordinalSeason) {
    if (input.fetchTvdbSeasonEpisodes) {
      const episodes = await input.fetchTvdbSeasonEpisodes(
        ordinalSeason.season_number
      );
      airDate = episodes?.find((e) => e.number === episode)?.aired ?? undefined;
    }
    airDate ??= findCinemetaDate(ordinalSeason.season_number, episode);
  }

  if (airDate) {
    resolution.episodeAirDates = [airDate];
  }
  return resolution;
}
