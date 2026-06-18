import { createLogger } from '../../../logging/logger.js';
import { MultiProviderPool } from '../multi-provider-pool.js';
import { Nzb, NzbFile } from '../../nzb/model.js';
import { groupArchiveSets } from '../archive/open/index.js';
import { NzbContent } from './types.js';
import { selectBestVideo } from './select.js';

const logger = createLogger('usenet/inspect');

/** Evenly-spaced indices across [0, n); begin/middle/end for `points === 3`. */
export function samplePointIndices(n: number, points: number): number[] {
  if (n <= 0) return [];
  const p = Math.max(1, Math.min(points, n));
  if (p === 1) return [0];
  const out = new Set<number>();
  for (let k = 0; k < p; k++) out.add(Math.round((k * (n - 1)) / (p - 1)));
  return [...out].sort((a, b) => a - b);
}

/**
 * STAT a few evenly-spaced points (begin..end) of the best video's backing
 * segments to catch incomplete/removed posts BEFORE playback: the cheap
 * insurance against a stream that starts then dies mid-file. Records the result
 * on `content.availability`; the caller decides whether to fail the import.
 *
 * For an archive inner video the "backing" segments are the archive set's
 * volumes (sampling their tail catches a truncated post). STATs are Low-priority
 * and bypass the download budget, and check every provider incl. backups; a STAT
 * error (vs a definitive miss) is treated as "present" so a transient blip never
 * wrongly fails an import.
 */
export async function sampleTargetAvailability(
  nzb: Nzb,
  pool: MultiProviderPool,
  content: NzbContent,
  points: number,
  signal?: AbortSignal
): Promise<void> {
  if (points <= 0) return;
  const target = selectBestVideo(content);
  if (!target) return;

  let backing: NzbFile[];
  if (target.innerPath) {
    const refs = content.files.map((f) => ({
      index: f.index,
      filename: f.filename,
      segments: nzb.files[f.index]?.segments.length,
      firstSegmentNumber: nzb.files[f.index]?.segments[0]?.number,
    }));
    const set = groupArchiveSets(refs).find(
      (s) => s.memberIndices.includes(target.index) || s.index === target.index
    );
    backing = (set?.memberIndices ?? [target.index])
      .map((i) => nzb.files[i])
      .filter((f): f is NzbFile => !!f);
  } else {
    const f = nzb.files[target.index];
    backing = f ? [f] : [];
  }

  const flat: Array<{ messageId: string; groups: string[] }> = [];
  for (const f of backing)
    for (const seg of f.segments)
      flat.push({ messageId: seg.messageId, groups: f.groups });
  if (flat.length === 0) return;

  const startedAt = Date.now();
  const idxs = samplePointIndices(flat.length, points);
  const results = await Promise.all(
    idxs.map((i) =>
      pool
        .statSegment(flat[i].messageId, flat[i].groups, signal, nzb.hash)
        .catch(() => true)
    )
  );
  const missing = results.filter((ok) => !ok).length;
  content.availability = { sampled: idxs.length, missing };
  logger.debug(
    {
      nzbHash: nzb.hash,
      target: target.innerPath ?? target.filename,
      sampled: idxs.length,
      missing,
      latency: Date.now() - startedAt,
    },
    'sampled target availability'
  );
}
