/**
 * Some releases label one episode as S17E34-400 (season episode + absolute
 * episode). The title parser expands this to a range. Only disambiguate the
 * wider bare second number when the requested metadata confirms the same
 * offset. Same-width labels (e.g. E01-25) remain ambiguous and stay ranges,
 * as do explicit E34-E400 ranges and names without a known mapping.
 * Keep this request-specific check out of the shared title-parser cache.
 */
export function isSeasonAbsoluteEpisodePairWrong(
  name: string | undefined,
  parsed: { seasons?: number[]; episodes?: number[] },
  metadata?: { season?: number; episode?: number; absoluteEpisode?: number }
): boolean {
  const { season, episode, absoluteEpisode } = metadata ?? {};
  if (
    !name ||
    !Number.isSafeInteger(season) ||
    !Number.isSafeInteger(episode) ||
    !Number.isSafeInteger(absoluteEpisode) ||
    !season ||
    !episode ||
    !absoluteEpisode ||
    absoluteEpisode <= episode ||
    parsed.seasons?.length !== 1 ||
    parsed.seasons[0] !== season
  )
    return false;

  if ((name.match(/(?<![a-z0-9])S\d+[ ._-]*E\d+/gi)?.length ?? 0) !== 1)
    return false;
  const pairs = [
    ...name.matchAll(
      /(?<![a-z0-9])S(\d{1,3})[ ._-]*E(\d{1,4})[ ._]*-[ ._]*(\d{1,5})(?=$|[ ._\[\]()-])/gi
    ),
  ];
  if (pairs.length !== 1) return false;
  const [, seasonText, relativeText, absoluteText] = pairs[0];
  const relative = Number(relativeText);
  const absolute = Number(absoluteText);
  if (
    Number(seasonText) !== season ||
    relative <= 0 ||
    absoluteText.length <= relativeText.length ||
    absolute - relative !== absoluteEpisode - episode
  )
    return false;

  // Do not reinterpret a title containing additional episode coordinates.
  const episodes = parsed.episodes;
  const isExpandedRange =
    episodes?.length === absolute - relative + 1 &&
    episodes.every((value, index) => value === relative + index);
  const isPair =
    episodes?.length === 2 &&
    episodes[0] === relative &&
    episodes[1] === absolute;
  return !!(isExpandedRange || isPair) && relative !== episode;
}
