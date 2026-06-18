import { NzbContent, NzbContentFile } from './types.js';

/** Share of the whole release below which a sample-named video is ineligible. */
const SAMPLE_MAX_SHARE = 0.05;

/** Whether a video's name/path marks it as a sample/preview/proof clip. */
export function isSampleName(name: string | undefined): boolean {
  if (!name) return false;
  return /(^|[\\/._\-\s])(sample|proof)([\\/._\-\s]|$)/i.test(name);
}

/**
 * A sample video may stand in as the playback target only when it is of
 * meaningful size relative to the WHOLE release (≥ {@link SAMPLE_MAX_SHARE} of
 * the summed file sizes); otherwise selecting it would "successfully" play a
 * 30-second clip in place of a missing/broken main feature. The denominator is
 * deliberately the release total, not the largest single file: split releases
 * (one ~1GB part per file) make any sample look large next to one part.
 */
export function isEligibleVideoTarget(
  name: string | undefined,
  size: number,
  releaseSize: number
): boolean {
  if (!isSampleName(name)) return true;
  return releaseSize > 0 && size >= releaseSize * SAMPLE_MAX_SHARE;
}

/**
 * Total release size: the sum over the NZB's files (errored files keep their
 * encoded-size estimate). Inner archive files are NOT added; their bytes are
 * already counted via the volumes that contain them.
 */
export function contentTotalSize(content: NzbContent): number {
  let total = 0;
  for (const f of content.files) total += f.size > 0 ? f.size : 0;
  return total;
}

/**
 * Pick the best streamable video file: the largest streamable video, including
 * stored videos found inside archives. Sample clips are excluded unless they
 * are the only candidates AND big enough to plausibly be real content.
 * Returns undefined when nothing is streamable.
 */
export function selectBestVideo(
  content: NzbContent
): NzbContentFile | undefined {
  const candidates: NzbContentFile[] = [];
  for (const f of content.files) {
    if (f.streamable && f.category === 'video') candidates.push(f);
    for (const inner of f.archiveInner ?? []) {
      if (inner.streamable && inner.category === 'video') {
        candidates.push({
          index: f.index,
          filename: inner.path,
          size: inner.size,
          category: 'video',
          format: inner.format,
          streamable: true,
          innerPath: inner.path,
        });
      }
    }
  }
  candidates.sort((a, b) => b.size - a.size);
  const real = candidates.filter((c) => !isSampleName(c.filename));
  if (real.length > 0) return real[0];
  const releaseSize = contentTotalSize(content);
  return candidates.find((c) =>
    isEligibleVideoTarget(c.filename, c.size, releaseSize)
  );
}
