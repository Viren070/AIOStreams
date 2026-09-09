import type { ParsedStream, UserData } from '../db/schemas.js';
import { resolveCrossProviderIds } from '../metadata/id-resolution.js';
import type { StreamContext } from '../streams/context.js';
import {
  createLogger,
  mergeParsedMediaInfos,
  parseMediaInfo,
} from '../utils/index.js';
import { matchEntry, toWireMediaInfo } from './adapter.js';
import { fetchProbeVersions } from './client.js';

const logger = createLogger('remuxdb');

/** Backfills probe data from RemuxDB for streams that don't have any yet. No-op unless the user has opted in. */
export async function resolveRemuxDbMediaInfo(
  streams: ParsedStream[],
  context: StreamContext,
  userData: UserData
): Promise<ParsedStream[]> {
  if (!userData.remuxDb?.enabled) return streams;

  try {
    const imdbId = context.parsedId
      ? resolveCrossProviderIds(
          context.parsedId,
          context.animeEntry,
          context.type === 'movie' ? 'movie' : 'series'
        ).imdbId
      : undefined;
    if (!imdbId) return streams;

    const eligible = streams.filter(
      (s) =>
        (s.torrent?.infoHash || s.nzbUrl) &&
        s.parsedFile?.mediaInfoQuality !== 'probe'
    );
    if (eligible.length === 0) return streams;

    const season = context.parsedId?.season
      ? Number(context.parsedId.season)
      : undefined;
    const episode = context.parsedId?.episode
      ? Number(context.parsedId.episode)
      : undefined;
    const versions = await fetchProbeVersions(imdbId, season, episode);
    logger.debug(
      `imdb ${imdbId}${season ? ` S${season}E${episode}` : ''}: ${eligible.length} eligible streams, ${versions.length} remuxdb versions`
    );
    if (versions.length === 0) return streams;

    let matched = 0;
    for (const stream of eligible) {
      const match = matchEntry(versions, stream);
      if (!match) continue;
      matched++;

      const merged = mergeParsedMediaInfos(
        stream.parsedFile,
        parseMediaInfo(toWireMediaInfo(match))
      );
      if (!merged) continue;

      stream.parsedFile = {
        ...stream.parsedFile,
        ...merged,
        languages: merged.languages?.length
          ? merged.languages
          : (stream.parsedFile?.languages ?? []),
        subtitles: merged.subtitles?.length
          ? merged.subtitles
          : (stream.parsedFile?.subtitles ?? []),
        audioChannels: merged.audioChannels?.length
          ? merged.audioChannels
          : (stream.parsedFile?.audioChannels ?? []),
        visualTags: merged.visualTags?.length
          ? merged.visualTags
          : (stream.parsedFile?.visualTags ?? []),
        audioTags: merged.audioTags?.length
          ? merged.audioTags
          : (stream.parsedFile?.audioTags ?? []),
        hasChapters: merged.hasChapters ?? stream.parsedFile?.hasChapters,
      };
      if (match.duration && !stream.duration) {
        stream.duration = match.duration * 1000;
      }
      if (match.bitrate && !stream.bitrate) {
        stream.bitrate = match.bitrate;
      }
    }
    logger.debug(`matched ${matched}/${eligible.length} eligible streams`);
  } catch (error) {
    logger.debug(`remuxdb wrap failed: ${error}`);
  }

  return streams;
}
