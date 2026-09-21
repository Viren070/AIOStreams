import { createLogger } from '../../logging/logger.js';
import { appConfig } from '../../utils/index.js';
import {
  UsenetLibraryRepository,
  type UsenetLibraryEntry,
} from '../../db/index.js';
import type { UsenetEngine } from '../index.js';
import { usenetEngineRegistry, getUsenetEngineConfig } from './engine.js';
import { fetchNzb, parseNzbCached } from './library.js';
import {
  applyCensusVerdictToLibrary,
  targetsFromLibraryFiles,
  isCensusShadowLive,
  type CensusOutcome,
} from './census-shadow.js';
import {
  hasRecentStreamActivity,
  shouldSkipDegraded,
} from './damage-policy.js';
import { nextCheckAt, withinRecheckWindow } from './recheck-schedule.js';
import { verifyEntryContentAndMark } from './verify-content.js';
import { enqueueArrRepair, processArrRepairs } from './arr-bridge.js';

const logger = createLogger('usenet/recheck');

/**
 * Periodic re-verification of the library. A release that was fine at import
 * can be taken down later, and nothing else notices: resolve trusts the
 * cached row, so the entry stays playable on paper until someone tries to
 * watch it. This walks entries that are due, censuses them against the
 * providers, and applies the same verdicts the import's census shadow does,
 * so a dead release becomes `failed` without anyone having to hit play.
 */

/** Retry delay after an unusable answer rather than a verdict. */
const INCONCLUSIVE_RETRY_MS = 15 * 60_000;

/**
 * Recheck one entry: re-fetch its NZB, census it, apply the verdict. Returns
 * `inconclusive` without writing anything when the answer cannot be trusted
 * (source content changed, nothing to audit, run cut short).
 */
export async function recheckEntry(
  entry: UsenetLibraryEntry,
  opts: { engine: UsenetEngine; depth: 'sample' | 'full'; signal?: AbortSignal }
): Promise<CensusOutcome> {
  if (!entry.nzbUrl) return 'inconclusive';
  const xml = await fetchNzb(entry.nzbUrl, opts.signal);
  const nzb = await parseNzbCached(entry.nzbHash, xml);
  // The URL now serves different content; this row is not what we fetched.
  if (nzb.hash !== entry.nzbHash) {
    logger.debug(
      { nzbHash: entry.nzbHash, contentHash: nzb.hash },
      'recheck skipped: source nzb no longer matches the entry'
    );
    return 'inconclusive';
  }
  const targets = targetsFromLibraryFiles(nzb, entry.files);
  if (targets.length === 0) return 'inconclusive';

  const sampleSize = appConfig.usenet.recheck.sampleSegments;
  const run = opts.engine.census(nzb, {
    signal: opts.signal,
    maxSamples: opts.depth === 'sample' ? sampleSize : undefined,
  });
  // Shadow width + Low gate priority from the start: a recheck must never
  // compete with playback or an import.
  void run.endBlockingPhase(0);
  let snap = await run.done;
  let mode: 'sample' | 'full' = opts.depth;

  // A sample that found something re-runs in full before any verdict:
  // "a few articles gone" vs "the post is gone" decides degraded or failed,
  // and a slice cannot tell them apart.
  if (mode === 'sample' && snap.missing > 0 && !snap.complete) {
    logger.debug(
      { nzbHash: entry.nzbHash, missing: snap.missing, sampled: snap.sampled },
      'recheck sample found damage; escalating to a full audit'
    );
    snap = await opts.engine.census(nzb, { signal: opts.signal }).done;
    mode = 'full';
  }

  return applyCensusVerdictToLibrary({
    nzbHash: entry.nzbHash,
    name: entry.name,
    snap,
    targets,
    releaseKey: entry.releaseKey,
    mode,
  });
}

export interface RecheckRunResult {
  checked: number;
  failed: number;
  degraded: number;
  clean: number;
  inconclusive: number;
  skipped: number;
}

/**
 * One pass of the recheck task: take the due entries and verify them, a few
 * at a time. Providers being unreachable defers the whole pass: a verdict
 * reached with nothing to ask would condemn every release we own.
 */
export async function runLibraryRecheck(
  opts: { signal?: AbortSignal } = {}
): Promise<{
  ok: boolean;
  message: string;
  result?: RecheckRunResult;
}> {
  const settings = appConfig.usenet.recheck;
  if (settings.scope === 'off') return { ok: true, message: 'disabled' };
  if (!withinRecheckWindow()) {
    return {
      ok: true,
      message: `outside the recheck hours (${settings.window})`,
    };
  }

  const { providers, options } = getUsenetEngineConfig();
  if (providers.length === 0) {
    return { ok: true, message: 'no usenet providers configured' };
  }
  const engine = usenetEngineRegistry.get(providers, options);
  if (!engine.providersReachable()) {
    return { ok: true, message: 'providers unreachable; deferred' };
  }

  const now = Date.now();
  const due = await UsenetLibraryRepository.listDueForRecheck({
    scope: settings.scope,
    limit: settings.batchSize,
    now,
  });
  if (due.length === 0) return { ok: true, message: 'nothing due' };

  const result: RecheckRunResult = {
    checked: 0,
    failed: 0,
    degraded: 0,
    clean: 0,
    inconclusive: 0,
    skipped: 0,
  };
  const queue = [...due];
  const workers = Math.max(1, Math.min(settings.concurrency, queue.length));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (queue.length > 0) {
        if (opts.signal?.aborted) return;
        const entry = queue.shift();
        if (!entry) return;
        await checkOne(entry, engine, settings.depth, result, opts.signal);
      }
    })
  );

  // Anything the pass condemned (plus repairs still retrying from before).
  const repairs = await processArrRepairs().catch((err) => {
    logger.warn({ err: (err as Error)?.message }, 'arr repairs failed');
    return { processed: 0, repaired: 0 };
  });

  return {
    ok: true,
    message:
      `checked ${result.checked}` +
      ` (failed ${result.failed}, degraded ${result.degraded},` +
      ` clean ${result.clean}, inconclusive ${result.inconclusive},` +
      ` skipped ${result.skipped})` +
      (repairs.processed > 0
        ? `; arr repairs ${repairs.repaired}/${repairs.processed}`
        : ''),
    result,
  };
}

async function checkOne(
  entry: UsenetLibraryEntry,
  engine: UsenetEngine,
  depth: 'sample' | 'full',
  result: RecheckRunResult,
  signal?: AbortSignal
): Promise<void> {
  const now = Date.now();
  // Playback and the import's own audit are better evidence than a STAT
  // sweep, and both are already running: leave those alone.
  if (
    hasRecentStreamActivity(entry.nzbHash) ||
    isCensusShadowLive(entry.nzbHash)
  ) {
    result.skipped++;
    await reschedule(entry, now, false);
    return;
  }
  try {
    let outcome = await recheckEntry(entry, { engine, depth, signal });
    // The articles are all there; whether they still assemble into the right
    // file is a separate question, and only asked when it is turned on.
    if (outcome === 'clean' || outcome === 'degraded') {
      const content = await verifyEntryContentAndMark(entry.nzbHash, {
        signal,
      }).catch(() => 'inconclusive' as const);
      if (content === 'bad') outcome = 'failed';
    }
    result.checked++;
    result[outcome]++;
    // `failed` clears its own schedule (a dead entry is never rechecked).
    if (outcome !== 'failed') {
      await reschedule(entry, now, outcome !== 'inconclusive');
    }
    if (outcome === 'failed' || outcome === 'degraded') {
      logger.info(
        { nzbHash: entry.nzbHash, name: entry.name, outcome },
        'library recheck changed an entry'
      );
    }
    // A release is only worth replacing when it is really unusable: `failed`
    // always, `degraded` only under the strict damage policy.
    const replaceable =
      outcome === 'failed' ||
      (outcome === 'degraded' &&
        shouldSkipDegraded('degraded', appConfig.usenet.damagePolicy));
    if (replaceable) {
      await enqueueArrRepair(
        entry,
        outcome === 'failed' ? 'failed' : 'degraded'
      );
    }
  } catch (err) {
    result.inconclusive++;
    logger.warn(
      { nzbHash: entry.nzbHash, err: (err as Error)?.message },
      'library recheck failed for an entry'
    );
    await reschedule(entry, now, false);
  }
}

/** Book the next check; an unusable answer retries sooner than the tier. */
async function reschedule(
  entry: UsenetLibraryEntry,
  now: number,
  conclusive: boolean
): Promise<void> {
  const next = conclusive
    ? nextCheckAt(entry, now)
    : now + INCONCLUSIVE_RETRY_MS;
  await UsenetLibraryRepository.setRecheck(entry.nzbHash, {
    lastCheckedAt: now,
    nextCheckAt: next,
    bump: conclusive,
  }).catch(() => {});
}
