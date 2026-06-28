import { createLogger } from '../../../logging/logger.js';
import { MultiProviderPool } from '../multi-provider-pool.js';
import { Nzb, NzbFile } from '../../nzb/model.js';
import { groupArchiveSets } from '../archive/open/index.js';
import { NzbContent } from './types.js';
import { selectBestVideo } from './select.js';
import { CommandPriority, NzbSegmentRef } from '../../types.js';
import { ArticleNotFoundError } from '../../nntp/errors.js';
import { YencDecodeError } from '../yenc.js';

const logger = createLogger('usenet/inspect');

/** Target-availability verification method (see {@link sampleTargetAvailability}). */
export type VerifyMode = 'stat' | 'body';

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
 * Verify a few evenly-spaced points (begin..end) of the best video's backing
 * segments BEFORE playback to catch incomplete/removed posts: the cheap
 * insurance against a stream that starts then dies mid-file. Records the result
 * on `content.availability`; the caller decides whether to fail the import.
 *
 * For an archive inner video the "backing" segments are the archive set's
 * volumes (sampling their tail catches a truncated post). Probes are Low-priority
 * and check every provider incl. backups (a body fetch fails over, so it answers
 * "retrievable from SOME provider?"); a probe error that is NOT a definitive miss
 * is treated as "present" so a transient blip never wrongly fails an import.
 */
export async function sampleTargetAvailability(
  nzb: Nzb,
  pool: MultiProviderPool,
  content: NzbContent,
  points: number,
  mode: VerifyMode,
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

  const flat: Array<{ seg: NzbSegmentRef; groups: string[] }> = [];
  for (const f of backing)
    for (const seg of f.segments) flat.push({ seg, groups: f.groups });
  if (flat.length === 0) return;

  // Returns true = present/unknown, false = definitively missing.
  const probe = async (ref: {
    seg: NzbSegmentRef;
    groups: string[];
  }): Promise<boolean> => {
    if (mode === 'body') {
      try {
        // A real retrieval (cached for prefetch). A 430 transfers nothing.
        await pool.fetchSegment(
          ref.seg,
          nzb.hash,
          signal,
          CommandPriority.Low
        );
        return true;
      } catch (err) {
        // Only a definitive "missing on all providers" / undecodable body counts
        // as missing; transient/unreachable errors are treated as present so a
        // blip never fails a good release.
        return !(
          err instanceof ArticleNotFoundError || err instanceof YencDecodeError
        );
      }
    }
    return pool
      .statSegment(ref.seg.messageId, signal, nzb.hash)
      .catch(() => true);
  };

  const startedAt = Date.now();
  const idxs = samplePointIndices(flat.length, points);
  const results = await Promise.all(idxs.map((i) => probe(flat[i])));
  const missing = results.filter((ok) => !ok).length;
  content.availability = { sampled: idxs.length, missing };
  logger.debug(
    {
      nzbHash: nzb.hash,
      target: target.innerPath ?? target.filename,
      mode,
      sampled: idxs.length,
      missing,
      latency: Date.now() - startedAt,
    },
    'sampled target availability'
  );
}
