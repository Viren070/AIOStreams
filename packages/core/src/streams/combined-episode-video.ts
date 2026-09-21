import type { ParsedStream } from '../db/schemas.js';
import { parseTorrentTitleCached } from '../parser/title.js';

/** Identify combined videos without treating a release/folder range as a file. */
export function isCombinedEpisodeVideo(
  stream: ParsedStream,
  request?: { season?: number; episode?: number; absoluteEpisode?: number }
): boolean {
  if (!stream.filename) return false;
  const basename = stream.filename.split(/[\\/]/).pop()!.trim();
  // An unresolved NZB/torrent title is not proof of a combined video. Easynews
  // playback resolves a single video, but can supply an extensionless filename.
  const videoFilename =
    /\.(?:mkv|mp4|avi|mov|wmv|flv|webm|m4v|mpg|mpeg|3gp|3g2|m2ts|ts|vob|ogv|ogm|divx|rm|rmvb|asf|mxf|mk3d)$/i;
  if (!videoFilename.test(basename) && stream.service?.id !== 'easynews') {
    return false;
  }
  // Never use parsedFile here: its episodes may have come from the folder.
  const parsed = parseTorrentTitleCached(basename);
  const episodes = parsed.episodes ?? [];
  // A verified S17E47-413 label can describe one episode in two numbering
  // systems. Require both requested coordinates, a wider bare absolute number,
  // and no additional episode coordinates. Explicit E47-E413 stays a range.
  const pair = basename.match(
    /(?<![a-z0-9])S(\d{1,3})[ ._-]*E(\d{1,4})[ ._]*-[ ._]*(\d{1,5})(?=$|[ ._\[\]()-])/i
  );
  if (
    pair &&
    (basename.match(/(?<![a-z0-9])S\d+[ ._-]*E\d+/gi)?.length ?? 0) === 1 &&
    parsed.seasons?.length === 1 &&
    parsed.seasons[0] === request?.season &&
    Number(pair[1]) === request?.season &&
    Number(pair[2]) === request?.episode &&
    Number(pair[3]) === request?.absoluteEpisode &&
    pair[3].length > pair[2].length &&
    Number(pair[3]) > Number(pair[2]) &&
    !/^[ ._-]*(?:e[ ._]*)?\d+(?:v\d+)?(?=$|[ ._\[\]()-])/i.test(
      basename.slice(pair.index! + pair[0].length)
    ) &&
    ((episodes.length === 2 &&
      episodes[0] === request.episode &&
      episodes[1] === request.absoluteEpisode) ||
      (episodes.length === request.absoluteEpisode! - request.episode! + 1 &&
        episodes.every(
          (episode, index) => episode === request.episode! + index
        )))
  ) {
    return false;
  }
  return (
    new Set(
      episodes.filter((episode) => Number.isInteger(episode) && episode > 0)
    ).size > 1
  );
}
