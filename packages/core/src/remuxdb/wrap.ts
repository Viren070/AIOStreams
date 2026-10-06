import type { ParsedStream, UserData } from '../db/schemas.js';
import { resolveCrossProviderIds } from '../metadata/id-resolution.js';
import type { StreamContext } from '../streams/context.js';
import { appConfig, createLogger, hasTrackLists } from '../utils/index.js';
import { applyMediaInfo } from '../media-info/apply.js';
import { fromRemuxDbVersion, matchEntry } from './adapter.js';
import { fetchProbeVersions } from './client.js';
import { queueRemuxDbMatch } from '../media-info/sources/remuxdb.js';
import type { MediaProbeVersion } from './client.js';

const logger = createLogger('remuxdb');

const lookups = new WeakMap<StreamContext, Promise<MediaProbeVersion[]>>();

async function lookupVersions(
  context: StreamContext
): Promise<MediaProbeVersion[]> {
  const imdbId = context.parsedId
    ? resolveCrossProviderIds(
        context.parsedId,
        context.animeEntry,
        context.type === 'movie' ? 'movie' : 'series'
      ).imdbId
    : undefined;
  if (!imdbId) return [];

  const season = context.parsedId?.season
    ? Number(context.parsedId.season)
    : undefined;
  const episode = context.parsedId?.episode
    ? Number(context.parsedId.episode)
    : undefined;
  // RemuxDB rejects a season or episode on its own.
  if ((season === undefined) !== (episode === undefined)) return [];
  const versions = await fetchProbeVersions(imdbId, season, episode);
  logger.debug(
    `imdb ${imdbId}${season ? ` S${season}E${episode}` : ''}: ${versions.length} remuxdb versions`
  );
  return versions;
}

function versionsFor(context: StreamContext): Promise<MediaProbeVersion[]> {
  let lookup = lookups.get(context);
  if (!lookup) {
    // Started before anything awaits it, so it must never reject.
    lookup = lookupVersions(context).catch((error) => {
      logger.debug(`remuxdb lookup failed: ${error}`);
      return [];
    });
    lookups.set(context, lookup);
  }
  return lookup;
}

export function isRemuxDbEnabled(userData: UserData): boolean {
  return appConfig.remuxdb.enabled && userData.remuxDb?.enabled !== false;
}

export function startRemuxDbLookup(
  context: StreamContext,
  userData: UserData
): void {
  if (isRemuxDbEnabled(userData)) void versionsFor(context);
}

export async function resolveRemuxDbMediaInfo(
  streams: ParsedStream[],
  context: StreamContext,
  userData: UserData
): Promise<void> {
  if (!isRemuxDbEnabled(userData)) return;

  try {
    const eligible = streams.filter(
      (s) => (s.torrent?.infoHash || s.nzbUrl) && !hasTrackLists(s.parsedFile)
    );
    if (eligible.length === 0) return;

    const versions = await versionsFor(context);
    if (versions.length === 0) return;

    let matched = 0;
    for (const stream of eligible) {
      const match = matchEntry(versions, stream);
      if (!match) continue;
      matched++;
      applyMediaInfo(stream, fromRemuxDbVersion(match));
      queueRemuxDbMatch(stream, match);
    }
    logger.debug(`matched ${matched}/${eligible.length} eligible streams`);
  } catch (error) {
    logger.debug(`remuxdb wrap failed: ${error}`);
  }
}
