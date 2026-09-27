import type { ParsedStream } from '../db/schemas.js';

/** Episode numbers for the request that produced this stream list. */
export interface BingeRequest {
  episode?: number;
  absoluteEpisode?: number;
  relativeAbsoluteEpisode?: number;
}

function positiveEpisode(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return undefined;
  }
  return value;
}

/**
 * Stremio autoplay selects the next episode's stream with an equal bingeGroup.
 * In matchingFile mode a combined file matches the later episode too, so that
 * request is marked `laterEpisode:<n>` and is not selected. The file stays in
 * the list. Matching Index and First File select by position, so they keep
 * the group they already built. Season packs are one episode of a folder and
 * stay unmarked. The first episode is the lowest parsed number.
 */
export function appendLaterEpisodeMarker(
  bingeGroup: string,
  stream: ParsedStream,
  request: BingeRequest | undefined,
  method: string = 'matchingFile'
): string {
  if (method !== 'matchingFile') {
    return bingeGroup;
  }
  const parsed = stream.parsedFile;
  const episodes = parsed?.episodes;
  if (!episodes || episodes.length < 2 || parsed?.seasonPack || !request) {
    return bingeGroup;
  }
  const requested = [
    ...new Set(
      [
        request.episode,
        request.absoluteEpisode,
        request.relativeAbsoluteEpisode,
      ]
        .map(positiveEpisode)
        .filter((episode): episode is number => episode !== undefined)
    ),
  ];
  if (requested.length === 0 || requested.includes(Math.min(...episodes))) {
    return bingeGroup;
  }
  const asked =
    positiveEpisode(request.episode) ??
    positiveEpisode(request.absoluteEpisode) ??
    positiveEpisode(request.relativeAbsoluteEpisode);
  return `${bingeGroup}|laterEpisode:${asked}`;
}
