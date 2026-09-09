const MEDIA_EXTENSIONS =
  /\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|mpg|mpeg|ts|m2ts|iso)/gi;

/** Residue markers appended by some HTTP providers after the real extension. */
const RESIDUE_MARKER =
  /(?:~\d+(?:\.\d+)?mbps)|(?:(?:mkv|mp4|avi|webm|bluray|web-?dl|x264|x265|hevc|av1|\d{3,4}p)[a-z0-9.+-]*\.pad-)/i;

/**
 * Strip provider-appended media-info residue from a release filename.
 *
 * Some HTTP providers (4KHDHub, VAPlayer, 2Peckle, …) glue a media-info echo
 * onto the real file name, e.g.:
 *   "Movie.2023.mkv4KMKVBluRayHDR10+10BitHEVCDdp5.1~26.2Mbps...pad-4KHDHub"
 *
 * The residue is glued directly to the extension (".mkv4K..."), so a
 * negative-lookahead match can't be used. Instead, take the LAST extension
 * candidate and cut there only when the trailing residue carries a provider
 * marker (a "~N.Mbps" bitrate echo or a ".pad-<tag>" suffix) — legit names
 * are returned unchanged.
 */
export function stripProviderResidue(filename: string): string {
  const extPattern = new RegExp(MEDIA_EXTENSIONS.source, 'gi');
  let last: RegExpExecArray | undefined;
  for (let m = extPattern.exec(filename); m; m = extPattern.exec(filename)) {
    last = m;
  }
  if (last) {
    const end = last.index + last[0].length;
    const residue = filename.slice(end);
    if (!residue || !RESIDUE_MARKER.test(residue)) return filename;
    return filename.slice(0, end);
  }

  // No media extension at all: some providers drop it entirely and glue a
  // hex id plus the residue straight onto the title, e.g.
  //   "Show.2022.<32-hex>1080pMKVWEB-DL...~5.8Mbps....pad-X"
  // Cut at the hex token when a container/bitrate marker follows it.
  const hashGlue =
    /\.[a-f0-9]{16,}(?=[0-9]{3,4}(?:p)?(?:MKV|MP4|WEB|BLURAY)|~\d+(?:\.\d+)?mbps)/i;
  const hashMatch = hashGlue.exec(filename);
  if (hashMatch) return filename.slice(0, hashMatch.index);
  return filename;
}
