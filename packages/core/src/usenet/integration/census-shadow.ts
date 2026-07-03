import { createLogger } from '../../logging/logger.js';
import { UsenetLibraryRepository } from '../../db/index.js';
import type { UsenetLibraryFile } from '../../db/index.js';
import {
  classifyHoles,
  serializeHoles,
  type HoleRun,
  type UsenetEngine,
  type Nzb,
  type NzbContent,
} from '../index.js';
import type { CensusSnapshot } from '../pool/inspect/index.js';

const logger = createLogger('usenet/census-shadow');

/** One playback target of an import: a persisted-file selector + its backing. */
interface Target {
  /** Selector into the persisted `files` blob (inner path wins over index). */
  selector: { path?: string; index?: number };
  /** NZB file index that anchors the backing set (container for inner files). */
  repIndex: number;
}

/** Enumerate the import's playback targets (plain videos + archive inners). */
function enumerateTargets(content: NzbContent): Target[] {
  const out: Target[] = [];
  for (const f of content.files) {
    if (f.streamable && !f.error) {
      out.push({ selector: { index: f.index }, repIndex: f.index });
    }
    for (const inner of f.archiveInner ?? []) {
      if (!inner.streamable || inner.category !== 'video') continue;
      out.push({ selector: { path: inner.path }, repIndex: f.index });
    }
  }
  return out;
}

/** Hole runs restricted to one target's backing set + its size/seg stats. */
function targetDamage(
  engine: UsenetEngine,
  nzb: Nzb,
  content: NzbContent,
  target: Target,
  holes: { runsForFiles(files: ReadonlySet<number>): HoleRun[] }
): { runs: HoleRun[]; backingBytes: number; segBytes: number } {
  const backing = new Set(engine.backingIndices(nzb, content, target.repIndex));
  let backingSegs = 0;
  let backingBytes = 0;
  for (const i of backing) {
    backingSegs += nzb.files[i]?.segments.length ?? 0;
    backingBytes += nzb.files[i]?.encodedSize ?? 0;
  }
  return {
    runs: holes.runsForFiles(backing),
    backingBytes,
    segBytes: backingSegs > 0 ? backingBytes / backingSegs : 750_000,
  };
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
const liveShadows = new Map<string, { cancel(): void }>();

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
}): void {
  const { nzbHash, name, nzb, content, engine } = args;
  const census = content.census;
  if (!census) return;
  content.census = undefined;

  liveShadows.get(nzbHash)?.cancel();
  liveShadows.set(nzbHash, census);

  void (async () => {
    const snap: CensusSnapshot = await census.done;
    if (!snap.complete) {
      logger.debug(
        { nzbHash, sampled: snap.sampled, total: snap.total },
        'census shadow ended without completing; leaving entry status as-is'
      );
      return;
    }
    const strict = engine.options.damagePolicy === 'strict';
    const targets = enumerateTargets(content);
    if (targets.length === 0) return;

    let anyHoles = false;
    let allFailed = true;
    const perTarget: Array<{
      target: Target;
      runs: HoleRun[];
      failed: boolean;
    }> = [];
    for (const target of targets) {
      const { runs, backingBytes, segBytes } = targetDamage(
        engine,
        nzb,
        content,
        target,
        snap.holes
      );
      const verdict = classifyHoles(runs, backingBytes, segBytes);
      const failed = strict ? runs.length > 0 : verdict === 'failed';
      if (runs.length > 0) anyHoles = true;
      if (!failed) allFailed = false;
      perTarget.push({ target, runs, failed });
    }

    logger.debug(
      {
        nzbHash,
        missing: snap.missing,
        longestRun: snap.longestRun,
        targets: targets.length,
        damaged: perTarget.filter((t) => t.runs.length > 0).length,
        failedTargets: perTarget.filter((t) => t.failed).length,
        strict,
      },
      'census shadow verdict'
    );

    if (allFailed && anyHoles) {
      await UsenetLibraryRepository.markFailed(
        nzbHash,
        `Missing on providers: ${snap.missing}/${snap.sampled} audited segments unavailable on every provider`,
        name,
        'missing_on_providers'
      );
      return;
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
      return;
    }
    // Fully clean census: promote a provisionally-degraded entry back to
    // available, but never clear a degraded flag that playback padding put
    // there (real holes on the wire beat STAT evidence).
    const entry = await UsenetLibraryRepository.get(nzbHash);
    if (!entry) return;
    const playbackHoles = entry.files.some((f) => (f.holes?.length ?? 0) > 0);
    if (entry.status === 'degraded' && !playbackHoles) {
      await UsenetLibraryRepository.setStatus(nzbHash, 'available', {
        guard: { notIn: ['failed', 'queued', 'inspecting', 'streaming'] },
      });
    }
  })()
    .catch((err) => {
      logger.warn(
        { nzbHash, err: (err as Error)?.message },
        'census shadow failed to apply its verdict'
      );
    })
    .finally(() => {
      if (liveShadows.get(nzbHash) === census) liveShadows.delete(nzbHash);
    });
}
