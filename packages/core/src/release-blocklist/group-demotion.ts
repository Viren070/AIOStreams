import { config } from '../config/index.js';
import { createLogger } from '../logging/logger.js';
import { ReleaseFailuresRepository } from '../db/repositories/release-failures.js';
import FileParser from '../parser/file.js';

const logger = createLogger('release-blocklist');

const DAY_SECONDS = 86_400;

/** The title a release belongs to: the show for series, the movie for movies. */
export interface ReleaseTitle {
  kind?: 'series' | 'movie';
  imdbId?: string | null;
  tmdbId?: number | string | null;
  tvdbId?: number | string | null;
  season?: number | string | null;
  episode?: number | string | null;
}

/** A stream as the demotion pass needs it. */
export interface GroupDemotableStream {
  parsedFile?: { releaseGroup?: string | null } | null;
}

/** Lowercased release group parsed from a filename, or null. */
export function releaseGroupOf(
  filename: string | null | undefined
): string | null {
  if (!filename) return null;
  try {
    return normaliseGroup(FileParser.parse(filename).releaseGroup);
  } catch {
    return null;
  }
}

function normaliseGroup(group: string | null | undefined): string | null {
  const g = group?.trim().toLowerCase();
  return g ? g : null;
}

function idPart(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().toLowerCase();
  return s && s !== '0' ? s : null;
}

/**
 * Every key the title is known by (`series:imdb:tt…`, `movie:tmdb:…`). A
 * series is keyed by its show ids, never by season or episode. Empty when no
 * id is known.
 */
export function titleKeysFor(title: ReleaseTitle | null | undefined): string[] {
  if (!title) return [];
  const kind =
    title.kind ??
    (title.season != null || title.episode != null ? 'series' : 'movie');
  const keys: string[] = [];
  const imdb = idPart(title.imdbId);
  const tmdb = idPart(title.tmdbId);
  const tvdb = idPart(title.tvdbId);
  if (imdb) keys.push(`${kind}:imdb:${imdb}`);
  if (tmdb) keys.push(`${kind}:tmdb:${tmdb}`);
  if (tvdb) keys.push(`${kind}:tvdb:${tvdb}`);
  return keys;
}

/** Layer 2 settings, or null when demotion is off. */
export function groupDemotionSettings(): {
  threshold: number;
  windowSeconds: number;
} | null {
  const rb = config.releaseBlocklist;
  if (!rb.enabled || rb.groupDemotionThreshold <= 0) return null;
  return {
    threshold: rb.groupDemotionThreshold,
    windowSeconds: rb.groupDemotionWindowDays * DAY_SECONDS,
  };
}

/**
 * Move the streams of every release group with too many dead releases for
 * this title to the end of the list, keeping the order inside both parts.
 * Nothing is removed. Any store error leaves the order as it was.
 */
export async function demoteFailingGroups<T extends GroupDemotableStream>(
  streams: T[],
  title: ReleaseTitle | null | undefined
): Promise<T[]> {
  const settings = groupDemotionSettings();
  if (!settings || streams.length === 0) return streams;
  const titleKeys = titleKeysFor(title);
  if (titleKeys.length === 0) return streams;
  let demoted: Map<string, number>;
  try {
    demoted = await ReleaseFailuresRepository.demotedGroups(
      titleKeys,
      settings.threshold,
      settings.windowSeconds
    );
  } catch (err) {
    logger.warn(`group demotion skipped (store error): ${err}`);
    return streams;
  }
  if (demoted.size === 0) return streams;

  const kept: T[] = [];
  const moved: T[] = [];
  const movedPerGroup = new Map<string, number>();
  for (const stream of streams) {
    const group = normaliseGroup(stream.parsedFile?.releaseGroup);
    if (group && demoted.has(group)) {
      moved.push(stream);
      movedPerGroup.set(group, (movedPerGroup.get(group) ?? 0) + 1);
    } else {
      kept.push(stream);
    }
  }
  for (const [group, count] of movedPerGroup) {
    logger.info(
      `demoting release group ${group} for ${titleKeys[0]}: ` +
        `${demoted.get(group)} dead releases in ${settings.windowSeconds / DAY_SECONDS} days, ` +
        `${count} stream(s) moved last`
    );
  }
  return moved.length ? [...kept, ...moved] : streams;
}

/**
 * The title of a stream request, from its parsed id and its (cached)
 * metadata. Null while demotion is off or no title id is known.
 */
export async function releaseTitleOfContext(context: {
  type: string;
  parsedId: {
    type: string;
    value: string | number;
    season?: string;
    episode?: string;
  } | null;
  getMetadata(): Promise<
    { tmdbId?: number | null; tvdbId?: number | null } | undefined
  >;
}): Promise<ReleaseTitle | null> {
  const parsed = context.parsedId;
  // Nothing to look up (no metadata wait) while demotion is off.
  if (!parsed || !groupDemotionSettings()) return null;
  const kind =
    context.type === 'movie'
      ? 'movie'
      : context.type === 'series'
        ? 'series'
        : undefined;
  if (!kind) return null;
  const title: ReleaseTitle = { kind };
  if (parsed.type === 'imdbId') title.imdbId = String(parsed.value);
  if (parsed.type === 'themoviedbId') title.tmdbId = parsed.value;
  if (parsed.type === 'thetvdbId') title.tvdbId = parsed.value;
  try {
    const meta = await context.getMetadata();
    title.tmdbId ??= meta?.tmdbId ?? null;
    title.tvdbId ??= meta?.tvdbId ?? null;
  } catch {
    // ids from the request alone
  }
  return titleKeysFor(title).length ? title : null;
}
