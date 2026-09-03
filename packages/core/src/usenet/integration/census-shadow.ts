import { createLogger } from '../../logging/logger.js';
import { UsenetLibraryRepository } from '../../db/index.js';
import type { UsenetLibraryFile } from '../../db/index.js';
import {
  markReleaseDead,
  retractRelease,
} from '../../release-blocklist/feedback.js';
import { nzbContentKey } from '../../release-blocklist/keys.js';
import {
  classifyHoles,
  serializeHoles,
  deserializeArchiveLayout,
  type HoleRun,
  type UsenetEngine,
  type Nzb,
  type NzbContent,
} from '../index.js';
import type { CensusRun, CensusSnapshot } from '../pool/inspect/index.js';
import { isMediaCategory } from '../pool/file-type.js';

const logger = createLogger('usenet/census-shadow');

/** One playback target of an import: a persisted-file selector + its backing. */
interface Target {
  /** Selector into the persisted `files` blob (inner path wins over index). */
  selector: { path?: string; index?: number };
  /** NZB file index that anchors the backing set (container for inner files). */
  repIndex: number;
}

/** Enumerate the import's playback targets (plain media + archive inners). */
function enumerateTargets(content: NzbContent): Target[] {
  const out: Target[] = [];
  for (const f of content.files) {
    if (f.streamable && !f.error) {
      out.push({ selector: { index: f.index }, repIndex: f.index });
    }
    for (const inner of f.archiveInner ?? []) {
      if (!inner.streamable || !isMediaCategory(inner.category)) continue;
      out.push({ selector: { path: inner.path }, repIndex: f.index });
    }
  }
  return out;
}

/**
 * A playback target ready for a verdict: which persisted file it is, and
 * which NZB files carry its bytes. Built either from a live import's
 * `NzbContent` or, for a later recheck, from the persisted file list.
 */
export interface VerdictTarget {
  /** Selector into the persisted `files` blob (inner path wins over index). */
  selector: { path?: string; index?: number };
  /** NZB file indices whose segments back this target. */
  backing: ReadonlySet<number>;
  backingBytes: number;
  /** Mean encoded bytes per segment, for the byte-based padding caps. */
  segBytes: number;
}

/** Backing size stats for a set of NZB file indices. */
function backingStats(
  nzb: Nzb,
  backing: ReadonlySet<number>
): { backingBytes: number; segBytes: number } {
  let backingSegs = 0;
  let backingBytes = 0;
  for (const i of backing) {
    backingSegs += nzb.files[i]?.segments.length ?? 0;
    backingBytes += nzb.files[i]?.encodedSize ?? 0;
  }
  return {
    backingBytes,
    segBytes: backingSegs > 0 ? backingBytes / backingSegs : 750_000,
  };
}

/** Verdict targets of a live import (plain media + archive inner files). */
export function targetsFromContent(
  engine: UsenetEngine,
  nzb: Nzb,
  content: NzbContent
): VerdictTarget[] {
  return enumerateTargets(content).map((target) => {
    const backing = new Set(
      engine.backingIndices(nzb, content, target.repIndex)
    );
    return {
      selector: target.selector,
      backing,
      ...backingStats(nzb, backing),
    };
  });
}

/**
 * Verdict targets of an already-imported entry, from its persisted files. An
 * archive member's backing set survives in its layout (`memberIndices`); a
 * plain file backs itself. Files whose backing cannot be recovered are
 * skipped rather than guessed at.
 */
export function targetsFromLibraryFiles(
  nzb: Nzb,
  files: UsenetLibraryFile[]
): VerdictTarget[] {
  const out: VerdictTarget[] = [];
  for (const file of files) {
    if (file.streamable === false) continue;
    let backing: Set<number> | undefined;
    if (file.path) {
      const layout = deserializeArchiveLayout(file.layout);
      if (layout?.memberIndices?.length)
        backing = new Set(layout.memberIndices);
    } else if (file.index !== undefined && nzb.files[file.index]) {
      backing = new Set([file.index]);
    }
    if (!backing || backing.size === 0) continue;
    out.push({
      selector: file.path ? { path: file.path } : { index: file.index },
      backing,
      ...backingStats(nzb, backing),
    });
  }
  return out;
}

/**
 * Seed the to-be-persisted library files with the blocking phase's confirmed
 * (within-caps) damage, so the entry lands as `degraded` with its hole map
 * already attached. Returns whether any file was seeded.
 */
export function attachProvisionalHoles(
  engine: UsenetEngine,
  nzb: Nzb,
  content: NzbContent,
  files: UsenetLibraryFile[]
): boolean {
  const provisional = content.provisionalHoles;
  if (!provisional || provisional.length === 0) return false;
  const damagedFiles = new Set(provisional.map((r) => r.file));
  let attached = false;
  for (const file of files) {
    const target: Target = {
      selector: file.path ? { path: file.path } : { index: file.index ?? -1 },
      repIndex: file.path
        ? (content.files.find((f) =>
            f.archiveInner?.some((i) => i.path === file.path)
          )?.index ?? -1)
        : (file.index ?? -1),
    };
    if (target.repIndex < 0) continue;
    const backing = new Set(
      engine.backingIndices(nzb, content, target.repIndex)
    );
    if (![...damagedFiles].some((d) => backing.has(d))) continue;
    const runs = provisional.filter((r) => backing.has(r.file));
    file.holes = serializeHoles(runs);
    attached = true;
  }
  return attached;
}

/** Live shadows by nzb hash (singleflight; a re-import cancels the old run). */
const liveShadows = new Map<string, { run: CensusRun; startedAt: number }>();

/** Whether an import's census tail is still auditing this entry. */
export function isCensusShadowLive(nzbHash: string): boolean {
  return liveShadows.has(nzbHash);
}

/** How long this entry's shadow has been running, for the arr hold timeout. */
export function censusShadowAgeMs(nzbHash: string): number | undefined {
  const live = liveShadows.get(nzbHash);
  return live && Date.now() - live.startedAt;
}

/** Audit progress of a live shadow, for clients that wait on it. */
export function censusShadowProgress(
  nzbHash: string
): { sampled: number; total: number } | undefined {
  const live = liveShadows.get(nzbHash);
  if (!live) return undefined;
  const snap = live.run.snapshot();
  return { sampled: snap.sampled, total: snap.total };
}

/**
 * What a census said about an entry:
 * - `failed`: every playback target is damaged beyond the padding caps;
 * - `degraded`: some confirmed damage, still playable (holes zero-filled);
 * - `clean`: no damage found;
 * - `inconclusive`: the evidence was too thin to say (cancelled run, no
 *   recoverable targets), so nothing was written.
 */
export type CensusOutcome = 'failed' | 'degraded' | 'clean' | 'inconclusive';

/**
 * Apply a census verdict to a library entry. Shared by the import's shadow
 * (`full`) and the periodic recheck (`sample`, where only part of the
 * release was audited). A `full` run that did not complete applies nothing:
 * the existing status stands and the playback hole hooks remain the
 * backstop.
 */
export async function applyCensusVerdictToLibrary(args: {
  nzbHash: string;
  name?: string;
  snap: CensusSnapshot;
  targets: VerdictTarget[];
  releaseKey?: string;
  mode: 'full' | 'sample';
}): Promise<CensusOutcome> {
  const { nzbHash, name, snap, targets, releaseKey, mode } = args;
  if (mode === 'full' && !snap.complete) {
    logger.debug(
      { nzbHash, sampled: snap.sampled, total: snap.total },
      'census ended without completing; leaving entry status as-is'
    );
    return 'inconclusive';
  }
  // A sample that answered nothing says nothing (providers down mid-run).
  if (snap.sampled === 0 || targets.length === 0) return 'inconclusive';

  let anyHoles = false;
  let allFailed = true;
  const perTarget: Array<{
    target: VerdictTarget;
    runs: HoleRun[];
    failed: boolean;
  }> = [];
  for (const target of targets) {
    const runs = snap.holes.runsForFiles(target.backing);
    const failed =
      classifyHoles(runs, target.backingBytes, target.segBytes) === 'failed';
    if (runs.length > 0) anyHoles = true;
    if (!failed) allFailed = false;
    perTarget.push({ target, runs, failed });
  }

  logger.debug(
    {
      nzbHash,
      mode,
      missing: snap.missing,
      sampled: snap.sampled,
      total: snap.total,
      longestRun: snap.longestRun,
      targets: targets.length,
      damaged: perTarget.filter((t) => t.runs.length > 0).length,
      failedTargets: perTarget.filter((t) => t.failed).length,
    },
    'census verdict'
  );

  if (allFailed && anyHoles) {
    await UsenetLibraryRepository.markFailed(
      nzbHash,
      `Missing on providers: ${snap.missing}/${snap.sampled} audited segments unavailable on every provider`,
      name,
      'missing_on_providers'
    );
    markReleaseDead(releaseKey, nzbContentKey(nzbHash));
    return 'failed';
  }

  for (const { target, runs, failed } of perTarget) {
    if (runs.length > 0) {
      await UsenetLibraryRepository.updateFileHoles(
        nzbHash,
        target.selector,
        serializeHoles(runs)
      );
    }
    if (failed) {
      await UsenetLibraryRepository.updateFileStreamable(
        nzbHash,
        target.selector,
        false
      );
    }
  }
  if (anyHoles) {
    await UsenetLibraryRepository.setStatus(nzbHash, 'degraded', {
      guard: { notIn: ['failed'] },
    });
    return 'degraded';
  }
  // A sample proves nothing about the segments it skipped, so it never
  // promotes; only a complete audit can clear a degraded flag.
  if (mode === 'sample') return 'clean';
  // Fully clean census: promote a provisionally-degraded entry back to
  // available, but never clear a degraded flag that playback padding put
  // there (real holes on the wire beat STAT evidence).
  const entry = await UsenetLibraryRepository.get(nzbHash);
  if (!entry) return 'clean';
  const playbackHoles = entry.files.some((f) => (f.holes?.length ?? 0) > 0);
  if (entry.status === 'degraded' && !playbackHoles) {
    await UsenetLibraryRepository.setStatus(nzbHash, 'available', {
      guard: { notIn: ['failed', 'queued', 'inspecting', 'streaming'] },
    });
    retractRelease(releaseKey, nzbContentKey(nzbHash));
  }
  return 'clean';
}

/**
 * Adopt an import's still-running census and apply its final verdict to the
 * library entry in the background: the import already returned (and playback
 * may have started); this is the tail that finishes auditing what the
 * blocking window didn't cover.
 *
 * Verdicts per playback target (exact, the census is complete):
 * - every target failed → the entry is `failed` (`missing_on_providers`);
 * - some damage → entry `degraded`, per-file hole maps persisted, targets
 *   damaged beyond the padding caps flip `streamable: false`;
 * - clean → promote a provisionally-degraded entry back to `available`
 *   (unless playback padding has meanwhile recorded real holes).
 *
 * A cancelled/incomplete census (engine closed, provider change, unreachable
 * providers) applies nothing: the blocking-phase status stands and the
 * playback hole hooks remain the backstop.
 */
export function spawnCensusShadow(args: {
  nzbHash: string;
  name?: string;
  nzb: Nzb;
  content: NzbContent;
  engine: UsenetEngine;
  releaseKey?: string;
  /**
   * Runs once the verdict has been applied. Supplied by the caller: reaching
   * for the follow-up work here would import the library layer that imports
   * this one.
   */
  onSettled?: (outcome: CensusOutcome) => void | Promise<void>;
}): void {
  const { nzbHash, name, nzb, content, engine, releaseKey, onSettled } = args;
  const census = content.census;
  if (!census) return;
  content.census = undefined;

  liveShadows.get(nzbHash)?.run.cancel();
  liveShadows.set(nzbHash, { run: census, startedAt: Date.now() });

  void (async () => {
    const snap: CensusSnapshot = await census.done;
    const outcome = await applyCensusVerdictToLibrary({
      nzbHash,
      name,
      snap,
      targets: targetsFromContent(engine, nzb, content),
      releaseKey,
      mode: 'full',
    });
    await onSettled?.(outcome);
  })()
    .catch((err) => {
      logger.warn(
        { nzbHash, err: (err as Error)?.message },
        'census shadow failed to apply its verdict'
      );
    })
    .finally(() => {
      if (liveShadows.get(nzbHash)?.run === census) liveShadows.delete(nzbHash);
    });
}
