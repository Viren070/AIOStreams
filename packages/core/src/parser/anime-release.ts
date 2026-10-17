import type { ParsedResult } from '@viren070/parse-torrent-title';

/** Metadata is used to identify the title, never to invent an episode number. */
export interface AnimeReleaseMetadata {
  isAnime?: boolean;
  titles?: string[];
  episode?: number;
  absoluteEpisode?: number;
  relativeAbsoluteEpisode?: number;
}

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Recover a bare absolute episode after an exact anime title. This deliberately
 * accepts only a small release grammar, not arbitrary text before/after a title.
 * Bracketed groups are generic; unbracketed groups must use a Subs/Raw(s) label.
 * Never modify the shared parser cache or override conflicting numbering/date data.
 */
export function recoverAnimeRelease(
  name: string,
  parsed: ParsedResult,
  metadata?: AnimeReleaseMetadata
): ParsedResult {
  if (
    !metadata?.isAnime ||
    !metadata.titles?.length ||
    !(metadata.episode || metadata.absoluteEpisode) ||
    parsed.seasons?.length ||
    parsed.volumes?.length ||
    parsed.year ||
    parsed.date
  )
    return parsed;

  const basename = name.split(/[\\/]/).pop() ?? name;
  // A non-video extension, range, movie label, volume or subtitle cannot match.
  const stem = basename.replace(/\.(?:mkv|mp4|avi|webm|m4v|ogm)$/i, '');
  const prefix =
    '(?:\\[([A-Za-z][A-Za-z0-9_-]{0,39})\\][ ._]*|([A-Za-z][A-Za-z0-9_-]{1,35}(?:Subs|Raws?))[ ._]+)?';
  const suffix =
    '(?:(?:[ ._]+|(?<=\\]))(?:\\[?(?:360|480|540|576|720|1080|1440|2160)p\\]?|\\[[a-fA-F0-9]{8}\\]))*';
  const candidates: ParsedResult[] = [];
  for (const title of new Set(metadata.titles)) {
    if (title.trim().length < 4) continue;
    const titlePattern = title
      .trim()
      .split(/[ ._:-]+/)
      .map(escapeRegex)
      .join('[ ._:-]+');
    const match = stem.match(
      new RegExp(
        `^${prefix}${titlePattern}[ ._]+(\\d{1,4})(?:v[1-9]\\d?)?${suffix}$`,
        'i'
      )
    );
    if (!match) continue;
    const episode = Number(match[3]);
    if (
      parsed.episodes?.length &&
      (parsed.episodes.length !== 1 || parsed.episodes[0] !== episode)
    )
      continue;
    // Year-shaped numbers remain ambiguous even when the base parser missed one.
    if (episode < 1 || (episode >= 1900 && episode <= 2099)) continue;
    candidates.push({
      ...parsed,
      title,
      episodes: [episode],
      group: match[1] || match[2] || parsed.group,
    });
  }
  if (!candidates.length) return parsed;
  const first = candidates[0];
  const normaliseAlias = (value?: string) =>
    value?.trim().toLowerCase().replace(/[ ._:-]+/g, ' ');
  // Separator-only alias differences are the same metadata identity.
  if (
    candidates.some(
      (candidate) =>
        normaliseAlias(candidate.title) !== normaliseAlias(first.title) ||
        candidate.episodes?.[0] !== first.episodes?.[0]
    )
  )
    return parsed;
  return first;
}

/** Bare recovered numbers are absolute/entry-relative, not TV season-relative. */
export function isRecoveredAnimeEpisodeWrong(
  parsed: ParsedResult,
  metadata: AnimeReleaseMetadata
): boolean {
  const absolute = [
    metadata.absoluteEpisode,
    metadata.relativeAbsoluteEpisode,
  ].filter((value): value is number => !!value);
  const expected = absolute.length ? absolute : [metadata.episode];
  return (
    !!parsed.episodes?.length &&
    !parsed.episodes.some((episode) => expected.includes(episode))
  );
}
