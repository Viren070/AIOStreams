import { cleanTitle, normaliseTitle } from '../parser/utils.js';
import type { AnimeEntry, AnimeRecord } from './types.js';
import type { ParsedId } from '../utils/id-parser.js';
import { getExternalEntryEpisode } from './episode-coordinates.js';

/** Only translated external episodes need a separate title/numbering scope. */
export function getExternalEpisodeTitles(
  id: ParsedId,
  entry: AnimeEntry | null | undefined,
  absoluteEpisode?: number
): string[] | undefined {
  if (!entry) return undefined;
  const local = getExternalEntryEpisode(id, entry);
  if (local === undefined) return undefined;
  if (
    Number(id.season) === 1 &&
    local === Number(id.episode) &&
    (absoluteEpisode === undefined || local === absoluteEpisode)
  )
    return undefined;
  return entry.localEpisodeTitles ?? [];
}

/** A local number alone does not identify an anime part. Undefined preserves legacy matching. */
export function matchesLocalEpisodeTitle(
  title: string | undefined,
  titles?: string[]
): boolean {
  if (titles === undefined) return true;
  if (!title) return false;
  const key = normaliseTitle(title);
  return !!key && titles.some((candidate) => normaliseTitle(candidate) === key);
}

/** Validate release titles before file selection; inner files may legitimately omit the part title. */
export function isLocalEpisodeWrong(
  parsed: { title?: string; seasons?: number[]; episodes?: number[] },
  metadata?: {
    season?: number;
    episode?: number;
    absoluteEpisode?: number;
    relativeAbsoluteEpisode?: number;
    localEpisodeTitles?: string[];
  },
  release?: { title?: string; seasons?: number[]; episodes?: number[] }
): boolean {
  if (
    !metadata?.relativeAbsoluteEpisode ||
    !parsed.episodes?.includes(metadata.relativeAbsoluteEpisode) ||
    (metadata.episode !== undefined &&
      parsed.episodes.includes(metadata.episode) &&
      (metadata.episode !== metadata.relativeAbsoluteEpisode ||
        (metadata.season !== undefined &&
          parsed.seasons?.includes(metadata.season)))) ||
    (metadata.absoluteEpisode !== undefined &&
      parsed.episodes.includes(metadata.absoluteEpisode))
  )
    return false;
  if (matchesLocalEpisodeTitle(parsed.title, metadata.localEpisodeTitles))
    return false;
  if (
    !release?.title ||
    !matchesLocalEpisodeTitle(release.title, metadata.localEpisodeTitles)
  )
    return true;
  if (
    release.seasons?.some(
      (season) => season !== 1 && season !== metadata.season
    )
  )
    return true;
  if (
    release.episodes?.length &&
    ![
      metadata.episode,
      metadata.absoluteEpisode,
      metadata.relativeAbsoluteEpisode,
    ].some(
      (episode) => episode !== undefined && release.episodes!.includes(episode)
    )
  )
    return true;
  // A verified batch title can qualify a generic inner filename, but must not
  // override an inner file explicitly naming a different part or series.
  const fileTitle = cleanTitle(parsed.title ?? '');
  const releaseTitle = cleanTitle(release.title);
  return (
    !!fileTitle &&
    releaseTitle !== fileTitle &&
    !releaseTitle.startsWith(`${fileTitle} `)
  );
}

/** Titles belonging to one anime entry, excluding aliases used by other parts. */
export function getEntryEpisodeTitles(
  chosen: AnimeRecord,
  candidates: AnimeRecord[]
): string[] {
  const shared = new Set(
    candidates
      .filter((record) => record.rid !== chosen.rid)
      .flatMap((record) => [
        record.title,
        ...(record.synonyms ?? []),
        record.imdb?.title,
        record.trakt?.title,
      ])
      .filter((title): title is string => !!title)
      .map(normaliseTitle)
  );
  const seen = new Set<string>();
  return [
    chosen.title,
    ...(chosen.synonyms ?? []),
    chosen.imdb?.title,
    chosen.trakt?.title,
  ].filter((title): title is string => {
    if (!title) return false;
    const key = normaliseTitle(title);
    if (!key || shared.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
