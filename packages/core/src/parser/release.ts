import type { ParsedResult } from '@viren070/parse-torrent-title';
import {
  recoverAnimeRelease,
  type AnimeReleaseMetadata,
} from './anime-release.js';

export interface ReleaseMetadata extends AnimeReleaseMetadata {
  mediaType?: string;
}

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const aliasKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[ ._:-]+/g, ' ');

/**
 * Recover an entire known movie title, including numbers the parser called
 * episodes. The full name must be an exact alias with only release-group,
 * resolution, year and checksum decorations; extra episode labels never fit.
 * The caller explicitly identifies a movie request. Years/countries and the
 * shared parser result are left intact for the normal validation paths.
 */
export function recoverMovieRelease(
  name: string,
  parsed: ParsedResult,
  metadata?: ReleaseMetadata
): ParsedResult {
  if (
    metadata?.mediaType !== 'movie' ||
    !metadata.titles?.length ||
    parsed.seasons?.length ||
    parsed.volumes?.length ||
    parsed.date ||
    (parsed.episodes?.length ?? 0) > 1
  )
    return parsed;

  const stem = (name.split(/[\\/]/).pop() ?? name)
    .replace(/\.(?:mkv|mp4|avi|webm|m4v|ogm)$/i, '')
    .trim();
  // A naked group must identify subs/raws, rather than arbitrary leading words.
  const prefix =
    '(?:\\[([A-Za-z][A-Za-z0-9_-]{0,39})\\][ ._-]*|((?:[A-Za-z][A-Za-z0-9_-]{1,35}(?:Subs|Raws?)|(?:Subs|Raws?)[A-Za-z0-9_-]{2,35}))[ ._-]+)?';
  const resolution = '(?:360|480|540|576|720|1080|1440|2160)p';
  const suffix = `(?:(?:[ ._-]+|(?<=[\\]\\)]))(?:${resolution}|\\(${resolution}\\)|\\[${resolution}\\]|\\[[a-fA-F0-9]{8}\\]|(?:19|20)\\d{2}))*`;
  const candidates: { title: string; group?: string }[] = [];
  for (const title of new Set(metadata.titles)) {
    if (title.trim().length < 4) continue;
    const pattern = title
      .trim()
      .split(/[ ._:-]+/)
      .map(escapeRegex)
      .join('[ ._:-]+');
    const match = stem.match(new RegExp(`^${prefix}${pattern}${suffix}$`, 'i'));
    if (!match) continue;
    // Only clear an episode number that appears inside the exact movie title.
    if (
      parsed.episodes?.length &&
      !title
        .match(/\d+/g)
        ?.some((number) => Number(number) === parsed.episodes![0])
    )
      continue;
    candidates.push({ title, group: match[1] || match[2] || parsed.group });
  }
  const first = candidates[0];
  if (
    !first ||
    candidates.some(
      (candidate) => aliasKey(candidate.title) !== aliasKey(first.title)
    )
  )
    return parsed;
  return {
    ...parsed,
    title: first.title,
    episodes: [],
    episodeTitle: undefined,
    group: first.group,
  };
}

/** NZB discovery, filtering and playback use the same interpretation. */
export function recoverNzbRelease(
  name: string,
  parsed: ParsedResult,
  metadata?: ReleaseMetadata
): ParsedResult {
  return metadata?.mediaType === 'movie'
    ? recoverMovieRelease(name, parsed, metadata)
    : recoverAnimeRelease(name, parsed, metadata);
}
