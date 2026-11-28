/**
 * Recover an English episode title from narrowly recognizable filenames such as:
 * "1.Название серии (The First Episode) [1080p].mkv".
 *
 * This is evidence for episode title matching, not a general release parser.
 * Unrecognized names deliberately return undefined instead of guessing.
 */
const VIDEO_EXTENSION = /\.(?:mkv|mp4|avi|mov|m4v|webm|ts)$/i;
const TRAILING_TAG =
  /[.\s_-]*(?:\[(?:2160p|1080p|720p|480p|hdr|dv|web[ ._-]?dl|web[ ._-]?rip|blu[ ._-]?ray|x264|x265|hevc)\]|(?:2160p|1080p|720p|480p|hdr|dv|web[ ._-]?dl|web[ ._-]?rip|blu[ ._-]?ray|x264|x265|hevc))$/i;
const NUMBERED_FOREIGN_EPISODE =
  /^\s*\d{1,4}[.\s_-]{1,4}(.{3,125}?)\s+\(([A-Za-z][A-Za-z0-9 ',:!?.\-’]{5,95})\)$/u;
const RELEASE_LABEL =
  /^(?:web[ ._-]?dl|web[ ._-]?rip|blu[ ._-]?ray|remux|bdrip|hevc|h\.?264|x\.?264|x\.?265|2160p|1080p|720p|480p|hdr|dv|sample|fhd|aac|flac|opus|proper|repack)$/i;

export function extractForeignNumberedEpisodeEnglishTitle(
  filename: string | undefined
): string | undefined {
  // A torrent can supply a long parent directory even when the media
  // basename is short. Limit both sizes without confusing them.
  if (!filename || filename.length > 4096) return undefined;
  const basename = filename.split(/[\\/]/).pop();
  if (!basename || basename.length > 250 || !VIDEO_EXTENSION.test(basename)) {
    return undefined;
  }
  let stem = basename.replace(VIDEO_EXTENSION, '');

  // Only known trailing release tags may follow the parenthesized title.
  for (let i = 0; i < 5; i++) {
    const withoutTag = stem.replace(TRAILING_TAG, '');
    if (withoutTag === stem) break;
    stem = withoutTag;
  }

  const match = NUMBERED_FOREIGN_EPISODE.exec(stem);
  if (!match) return undefined;
  const [, foreignTitle, englishTitle] = match;

  // A non-ASCII *letter* is required: a trademark symbol, emoji or
  // superscript digit in an English filename is not foreign-language evidence.
  if (!/(?=[^\x00-\x7f])\p{L}/u.test(foreignTitle)) return undefined;
  if (
    englishTitle.split(/\s+/).length < 2 ||
    RELEASE_LABEL.test(englishTitle)
  ) {
    return undefined;
  }

  return englishTitle.trim();
}
