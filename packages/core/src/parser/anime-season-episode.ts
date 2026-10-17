import type { ExtendedMetadata } from '../streams/context.js';

interface SeasonEpisodeMapping {
  season: number;
  episodeCount: number;
  offset: number;
}

/** Only infer absolute numbering from a complete, consistent historical season. */
export function getAnimeSeasonEpisodeMapping(
  season: number,
  episode: number,
  metadata: ExtendedMetadata | undefined
): SeasonEpisodeMapping | undefined {
  if (
    !Number.isInteger(season) ||
    season <= 1 ||
    !Number.isInteger(episode) ||
    episode < 1 ||
    !metadata?.seasons ||
    metadata.isDateBased ||
    metadata.resolvedSeasonNumber !== season ||
    metadata.resolvedSeasonFirstEpisode !== 1
  )
    return undefined;

  // A current season's episode count may still be growing. Do not use it to
  // rule out season-relative numbering; require a later populated season.
  // This is a metadata-based safeguard, not verification of episode air dates.
  if (
    !metadata.seasons.some(
      (s) => s.season_number > season && s.episode_count > 0
    )
  ) {
    return undefined;
  }

  let offset = 0;
  let episodeCount = 0;
  for (let number = 1; number <= season; number++) {
    const records = metadata.seasons.filter((s) => s.season_number === number);
    if (records.length !== 1) return undefined;
    const count = records[0].episode_count;
    if (!Number.isInteger(count) || count <= 0) return undefined;
    if (number < season) offset += count;
    else episodeCount = count;
  }

  // Reject incomplete/alternate numbering, including adjusted absolute offsets.
  // This checks consistency with the request's coordinate, not an independent
  // metadata source; both calculations can share the same season counts.
  if (episode > episodeCount || metadata.absoluteEpisode !== offset + episode) {
    return undefined;
  }
  return { season, episodeCount, offset };
}

/**
 * Convert an unambiguous season + absolute episode into season-relative data.
 * Recover wrong episodes too, so the ordinary matcher can reject them.
 * Never mutate the shared filename-parser cache.
 * Runs as normalization before filters/expressions, even when episode matching
 * is disabled. The matching settings still control whether results are rejected.
 */
export function reconcileAnimeSeasonEpisode<
  T extends {
    seasons?: number[];
    episodes?: number[];
    seasonPack?: boolean;
    date?: string;
  },
>(
  parsed: T,
  filename: string | undefined,
  mapping: SeasonEpisodeMapping | undefined
): T {
  if (
    !mapping ||
    parsed.date ||
    parsed.seasons?.length !== 1 ||
    parsed.seasons[0] !== mapping.season ||
    (parsed.episodes?.length ?? 0) > 1
  )
    return parsed;

  const normalizeAbsolute = (absoluteEpisode: number): T => {
    // Conservative tradeoff: real episodes numbered 240, 720, etc. also skip
    // reconciliation (including parsed E notation). Preserve existing behavior
    // rather than risk treating a year/resolution as an episode coordinate.
    if (
      !Number.isInteger(absoluteEpisode) ||
      (absoluteEpisode >= 1900 && absoluteEpisode <= 2099) ||
      [240, 360, 480, 576, 720, 1080, 1440, 2160, 4320].includes(
        absoluteEpisode
      ) ||
      absoluteEpisode <= mapping.episodeCount ||
      absoluteEpisode <= mapping.offset ||
      absoluteEpisode > mapping.offset + mapping.episodeCount
    )
      return parsed;
    return {
      ...parsed,
      episodes: [absoluteEpisode - mapping.offset],
      seasonPack: false,
    };
  };

  const leaf = filename?.split(/[\\/]/).pop();
  // The parser can truncate fractional episodes, so preserve raw continuation
  // evidence even when it has already extracted a single integer episode.
  // After the episode and optional version, reject tails such as ".5"
  // (305.5 or 305v2.5), "-0306-16", "+306" and " E306".
  // Bound numeric continuations so quality suffixes such as "- 1080p"
  // and "- 10bit" are allowed, while "- 306v2" remains a continuation.
  const isContinuation =
    /^(?:\.\d+(?:v\d+)?(?=$|[^\p{L}\p{N}])|[ ._]*(?:[-+&,/]|to\b)[ ._]*(?:e[ ._]*)?\d+(?:v\d+)?(?=$|[^\p{L}\p{N}])|[ ._]+e\d+(?:v\d+)?(?=$|[^\p{L}\p{N}])|[ ._]+\d+(?=$|[ ._-]))/iu;
  if (parsed.episodes?.length === 1) {
    const episode = parsed.episodes[0];
    if (!Number.isInteger(episode)) return parsed;
    if (leaf) {
      const tokens = leaf.matchAll(
        new RegExp(
          `(?:^|[^\\d])0*${episode}(?:v\\d+)?(?=$|[^\\p{L}\\p{N}])`,
          'giu'
        )
      );
      for (const token of tokens) {
        if (isContinuation.test(leaf.slice(token.index! + token[0].length)))
          return parsed;
      }
    }
    // Parsed coordinates are independent of spelling (EP305, 11x305, etc.).
    // Only missing episode numbers require the narrow raw-filename recovery.
    return normalizeAbsolute(episode);
  }
  if (!leaf) return parsed;

  // Inspect the leaf filename only. Preserve multi-season packs and ranges.
  const matches = [
    ...leaf.matchAll(
      /(?:^|[^\p{L}\p{N}])S(\d{1,3})(?:[ ._-]*E[ ._-]*|[ ._]+(?:-[ ._]*)?|-[ ._]*)(\d{1,4})(?:v\d+)?(?=$|[^\p{L}\p{N}])/giu
    ),
  ];
  if (matches.length !== 1) return parsed;
  const match = matches[0];
  const season = Number(match[1]);
  const absoluteEpisode = Number(match[2]);
  const tail = leaf.slice(match.index! + match[0].length);
  if (isContinuation.test(tail) || season !== mapping.season) return parsed;

  // Bare years and resolutions are excluded by the shared numeric safeguards.
  return normalizeAbsolute(absoluteEpisode);
}
