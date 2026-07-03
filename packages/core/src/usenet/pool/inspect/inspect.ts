import pLimit from 'p-limit';
import { createLogger } from '../../../logging/logger.js';
import { MultiProviderPool } from '../multi-provider-pool.js';
import { detectFileType } from '../file-type.js';
import { Nzb } from '../../nzb/model.js';
import { InspectOptions, InspectResult, NzbContent } from './types.js';
import { buildProbePlan, DYNAMIC_REGROUP_PROBES } from './probe-plan.js';
import { inspectFile } from './probe.js';
import { applyPar2Names } from './par2-names.js';

const logger = createLogger('usenet/inspect');

/**
 * A clearly-dead post (almost every probed file's first article missing on all
 * providers) shouldn't probe all N files one budget-slice at a time; Usenet
 * posts are all-or-nothing when DMCA'd/aged out. Once at least this many files
 * are probed and the miss-rate is at/above the ratio, abort the rest.
 */
const DEAD_ABORT_MIN_PROBE = 16;
const DEAD_ABORT_MISS_RATIO = 0.9;
/**
 * Progress-aware abort: a healthy import keeps completing probes, so only a
 * stretch with ZERO completions indicates a wedged provider; abort then
 * (never a flat deadline, which would truncate large-but-healthy imports).
 */
const INSPECT_IDLE_ABORT_MS = 20_000;
/** Hard wall-clock backstop, generous enough for 1000+-file NZBs. */
const INSPECT_HARD_TIMEOUT_MS = 180_000;

/**
 * Build the file list + streamability verdict for an NZB by fetching the first
 * (and optionally last) segment of each file, then recovering obfuscated
 * filenames from a PAR2 index when present. Archive (RAR/7z) inner-file
 * inspection is layered on top by the engine (it needs FileStream openers).
 *
 * Probes run concurrently (the caller sizes `concurrency` from the idle import
 * budget). Two guards keep a dead/wedged post from probing all N files: an
 * **early-abort** when the probed miss-rate is overwhelming, and a wall-clock
 * **timeout** backstop; both cancel in-flight + remaining probes.
 */
export async function inspectNzb(
  nzb: Nzb,
  pool: MultiProviderPool,
  opts: InspectOptions = {}
): Promise<NzbContent> {
  const startedAt = Date.now();
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const limit = pLimit(concurrency);

  // Live census evidence (the census runs concurrently with this whole pass):
  // once it confirms a miss, evidence-reducing probe skips must not be added.
  const confirmedMiss = (): boolean => opts.hasConfirmedMiss?.() ?? false;

  const plan = await buildProbePlan(nzb, pool, opts, confirmedMiss());
  const { skipProbe, lazySizes, liveNames, inferredNames } = plan;

  // Merge the caller's signal into an internal controller we can trip ourselves
  // (early-abort / stall / hard timeout). Probes use this combined signal.
  const ac = new AbortController();
  const onExternalAbort = () => ac.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort();
    else opts.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  let probed = 0;
  let missing = 0;
  let deadAbort: { sampled: number; missing: number } | undefined;
  let lastProgressAt = Date.now();
  // Abort only when probing STOPS making progress (or the generous hard cap
  // fires), not on a flat deadline that truncates large-but-healthy imports.
  const watchdog = setInterval(() => {
    if (ac.signal.aborted) return;
    const now = Date.now();
    const idleMs = now - lastProgressAt;
    const totalMs = now - startedAt;
    if (idleMs >= INSPECT_IDLE_ABORT_MS || totalMs >= INSPECT_HARD_TIMEOUT_MS) {
      logger.warn(
        { nzbHash: nzb.hash, probed, files: nzb.files.length, idleMs, totalMs },
        'aborting inspect: probe progress stalled or hard timeout reached'
      );
      ac.abort();
    }
  }, 1_000);
  watchdog.unref?.();
  const fileOpts: InspectOptions = { ...opts, signal: ac.signal };

  let results: InspectResult[];
  try {
    results = await Promise.all(
      nzb.files.map((file, index) =>
        limit(async (): Promise<InspectResult> => {
          // Skipped probe (split-7z middle / lazy RAR middle / par2): classify
          // by name, take the par2-exact size when recorded; no fetch at all.
          // Re-checked after the task was queued: the dynamic regroup below may
          // have added this index mid-flight.
          if (skipProbe.has(index)) {
            const filename = inferredNames.get(index) ?? file.filename;
            const type = detectFileType(Buffer.alloc(0), filename);
            const exact = lazySizes.get(index);
            return {
              file: {
                index,
                filename,
                size: exact ?? file.encodedSize,
                sizeExact: exact !== undefined,
                category: type.category,
                format: type.format,
                streamable: type.streamable,
              },
            };
          }
          // Already aborted (dead/stalled/caller): don't probe; return a skipped
          // placeholder so the file list stays positionally complete.
          if (ac.signal.aborted) {
            return {
              file: {
                index,
                filename: file.filename,
                size: file.encodedSize,
                category: 'other',
                streamable: false,
              },
            };
          }
          const r = await inspectFile(
            file,
            index,
            pool,
            nzb.hash,
            fileOpts,
            lazySizes.get(index)
          );
          probed++;
          lastProgressAt = Date.now();
          if (r.file.filename) liveNames[index] = r.file.filename;
          // Re-checked at trigger time: the census may have confirmed a miss
          // since the plan was built, in which case adding positional-inference
          // skips would reduce exactly the evidence that maps the damage.
          if (
            probed === DYNAMIC_REGROUP_PROBES &&
            !ac.signal.aborted &&
            !confirmedMiss()
          ) {
            plan.dynamicRegroup();
          }
          if (r.file.error === 'article_not_found') missing++;
          if (
            !deadAbort &&
            probed >= DEAD_ABORT_MIN_PROBE &&
            missing / probed >= DEAD_ABORT_MISS_RATIO
          ) {
            deadAbort = { sampled: probed, missing };
            logger.warn(
              { nzbHash: nzb.hash, sampled: probed, missing },
              'aborting inspect early: post appears dead (most articles missing on all providers)'
            );
            ac.abort();
          }
          return r;
        })
      )
    );
  } finally {
    // Always release the watchdog + external-abort listener, including when a
    // probe propagates a provider-unavailable error (retryable inspect failure).
    clearInterval(watchdog);
    if (opts.signal) opts.signal.removeEventListener('abort', onExternalAbort);
  }

  // Skip PAR2 filename recovery on a dead post (its par2 is missing too) and
  // when no file needed renaming in the first place.
  if (!deadAbort && plan.wantPar2) {
    await applyPar2Names(nzb, pool, results, opts, plan.par2Index);
  }

  const files = results.map((r) => r.file);
  const streamable = files.some((f) => f.streamable);

  // Per-file classification (trace) for diagnosing streamability decisions.
  for (const f of files) {
    logger.trace(
      {
        nzbHash: nzb.hash,
        index: f.index,
        filename: f.filename,
        category: f.category,
        format: f.format,
        streamable: f.streamable,
        error: f.error,
        size: f.size,
      },
      'inspected file'
    );
  }

  // Category breakdown so a `streamable:false` verdict is explainable at a glance.
  const byCategory: Record<string, number> = {};
  for (const f of files)
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;

  logger.debug(
    {
      nzbHash: nzb.hash,
      mode: opts.mode ?? 'quick',
      fileCount: files.length,
      streamable,
      byCategory,
      streamableCount: files.filter((f) => f.streamable).length,
      archiveCount: files.filter((f) => f.category === 'archive').length,
      par2Count: files.filter((f) => f.category === 'par2').length,
      missing: files.filter((f) => f.error === 'article_not_found').length,
      openFailed: files.filter((f) => f.error === 'open_failed').length,
      deadAbort: !!deadAbort,
      latency: Date.now() - startedAt,
    },
    'inspected nzb'
  );
  const content: NzbContent = { files, streamable };
  // Hand the aligned probe heads to the archive parse (per-volume headers live
  // in them). ~16KB per probed file, freed by the engine after that phase.
  const heads = new Map<number, Buffer>();
  for (const r of results) {
    if (r.head && r.headAligned && !r.file.error)
      heads.set(r.file.index, r.head);
  }
  if (heads.size > 0) content.heads = heads;
  // Surface an early dead-abort as availability so the caller fails the import
  // with `missing_on_providers` (same path as begin/middle/end sampling) rather
  // than the generic "no streamable files".
  if (deadAbort) content.availability = deadAbort;
  return content;
}
