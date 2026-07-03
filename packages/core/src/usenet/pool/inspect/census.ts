import { createLogger } from '../../../logging/logger.js';
import type { MultiProviderPool } from '../multi-provider-pool.js';
import type { PrioritySemaphore } from '../priority-semaphore.js';
import type { Nzb } from '../../nzb/model.js';
import { detectFileType } from '../file-type.js';
import { ArticleNotFoundError } from '../../nntp/errors.js';
import { YencDecodeError } from '../yenc.js';
import { CommandPriority, NzbSegmentRef } from '../../types.js';
import {
  HoleAccumulator,
  CENSUS_BLOCKING_MIN_HITS,
  MAX_PAD_RUN_SEGMENTS,
} from '../../holes.js';

const logger = createLogger('usenet/census');

/**
 * STAT parallelism for a census (clamped to the engine's download ceiling).
 * Also sizes the engine-shared census gate, so ALL live censuses on an engine
 * (blocking + shadows) contend for this many probe slots in total.
 */
export const CENSUS_CONCURRENCY = 40;
/** First segments of this many leading/trailing data files are probed first. */
const ANCHOR_HEAD_FILES = 3;
const ANCHOR_TAIL_FILES = 2;
/** Consecutive unknown STAT outcomes before the census assumes the pool died. */
const UNKNOWN_STORM_LIMIT = 50;
/** Dead-post catastrophic trigger: miss ratio at/above this with enough hits. */
const CATASTROPHIC_MISS_RATIO = 0.9;
/** Cap on densification STATs spent measuring one run's boundaries. */
const DENSIFY_STAT_BUDGET = 64;
/** STAT-present observations gathered before a provider is BODY-calibrated. */
const TRUST_CALIBRATION_SAMPLES = 3;
/** Spread BODY sample size when no provider's STAT can be trusted. */
const BODY_FALLBACK_POINTS = 16;

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
 * Engine-lifetime per-provider STAT trust. A cache/debrid NNTP gateway can
 * answer STAT 223 for articles whose BODY it 430s, silently defeating every
 * STAT-based availability check; the census therefore BODY-calibrates each
 * provider once (on segments that provider claimed present) and excludes
 * proven liars from its evidence.
 */
export class StatTrustCache {
  private states = new Map<string, 'trusted' | 'untrusted' | 'calibrating'>();

  state(providerId: string): 'trusted' | 'untrusted' | 'unknown' {
    const s = this.states.get(providerId);
    if (s === 'trusted' || s === 'untrusted') return s;
    return 'unknown';
  }

  /** Claim the single-flight calibration for a provider. */
  beginCalibration(providerId: string): boolean {
    if (this.states.has(providerId)) return false;
    this.states.set(providerId, 'calibrating');
    return true;
  }

  settleCalibration(providerId: string, trusted: boolean): void {
    this.states.set(providerId, trusted ? 'trusted' : 'untrusted');
  }

  /** Uncalibrated providers count as trusted until proven otherwise. */
  trustedIds(all: readonly string[]): string[] {
    return all.filter((id) => this.state(id) !== 'untrusted');
  }

  untrustedIds(all: readonly string[]): string[] {
    return all.filter((id) => this.state(id) === 'untrusted');
  }
}

export interface CensusOptions {
  /** STAT parallelism (default {@link CENSUS_CONCURRENCY}). Never pipelined. */
  concurrency?: number;
  /** Worker width once the blocking phase ends (default: no reduction). */
  shadowConcurrency?: number;
  /**
   * Engine-shared census probe budget. Every probe (worker STAT, densify
   * STAT, calibration BODY, body-fallback fetch) holds one slot, so N live
   * censuses contend for the same slots instead of multiplying pressure.
   * Blocking-phase probes acquire at High priority, shadow-phase at Low.
   */
  gate?: PrioritySemaphore;
  /** Hard wall-clock cap; the census cancels itself (complete: false) after. */
  maxLifetimeMs?: number;
  /** External abort (import abort / engine close). */
  signal?: AbortSignal;
  /** Engine-lifetime per-provider STAT trust state. */
  trust: StatTrustCache;
}

export interface CensusSnapshot {
  /** Data segments in scope (par2-named files excluded). */
  total: number;
  /** Definitive answers so far (incl. run interiors closed by bisection). */
  sampled: number;
  /** Confirmed missing-on-all-trusted-providers segments. */
  missing: number;
  /** STATs no provider could answer (never used as evidence). */
  unknowns: number;
  longestRun: number;
  /** Confirmed damage as maximal runs, in NZB-file segment space. */
  holes: HoleAccumulator;
  trustedProviders: string[];
  untrustedProviders: string[];
  mode: 'stat' | 'body-fallback';
  /** True when every in-scope segment got a definitive answer. */
  complete: boolean;
}

export interface CensusRun {
  /**
   * Fires at most once, when the evidence says the whole release is dead.
   * Callers abort the surrounding inspect; probing a dead post is wasted
   * work.
   */
  onCatastrophic(cb: () => void): void;
  /** True once any confirmed miss exists (disables probe-plan skip adding). */
  hasConfirmedMiss(): boolean;
  /**
   * End the blocking share: resolves with a snapshot after at most `tailMs`
   * more milliseconds (immediately when 0 or the census already finished).
   * Workers keep running afterwards; the remainder is the "shadow".
   */
  endBlockingPhase(tailMs: number): Promise<CensusSnapshot>;
  /** Full completion; never rejects (cancellation → `complete: false`). */
  done: Promise<CensusSnapshot>;
  snapshot(): CensusSnapshot;
  cancel(): void;
}

/**
 * Full-release availability census: STAT every data segment in a
 * low-discrepancy order (anchors first, then a bit-reversal permutation, so
 * ANY prefix approximates a uniform sample), confirm misses on all
 * STAT-trusted providers, and measure each hole's run boundaries the moment
 * it is found (linear walk to the pad cap, then galloping + bisection).
 *
 * Runs concurrently with the import's probe/parse phases and continues after
 * resolve returns (the "shadow", at a reduced worker width); consumes no
 * download budget (STATs ride Low priority behind playback), but every probe
 * holds a slot on the engine-shared census gate, so concurrent censuses share
 * one budget and a blocking phase preempts lingering shadows.
 */
export function startCensus(
  nzb: Nzb,
  pool: MultiProviderPool,
  opts: CensusOptions
): CensusRun {
  // ---- scope: data files only (par2 by filename; obfuscated par2 that slips
  // through is harmless: verdicts only consult playback targets' backing sets).
  const dataFiles: number[] = [];
  for (let i = 0; i < nzb.files.length; i++) {
    const f = nzb.files[i];
    const type = detectFileType(Buffer.alloc(0), f.filename);
    if (type.category !== 'par2') dataFiles.push(i);
  }
  // Flattened data-segment space with prefix sums for flat ↔ (file, local).
  const prefix: number[] = new Array(dataFiles.length);
  const dataPosByFile = new Map<number, number>();
  let total = 0;
  for (let i = 0; i < dataFiles.length; i++) {
    prefix[i] = total;
    dataPosByFile.set(dataFiles[i], i);
    total += nzb.files[dataFiles[i]].segments.length;
  }
  interface FlatRef {
    fileIndex: number;
    local: number;
    seg: NzbSegmentRef;
  }
  const refAt = (flat: number): FlatRef => {
    let lo = 0;
    let hi = dataFiles.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (prefix[mid] <= flat) lo = mid;
      else hi = mid - 1;
    }
    const fileIndex = dataFiles[lo];
    const local = flat - prefix[lo];
    return { fileIndex, local, seg: nzb.files[fileIndex].segments[local] };
  };
  const flatOf = (fileIndex: number, local: number): number =>
    prefix[dataPosByFile.get(fileIndex)!] + local;

  const ac = new AbortController();
  const externalAbort = (): void => ac.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort();
    else opts.signal.addEventListener('abort', externalAbort, { once: true });
  }

  const gate = opts.gate;
  /** Blocking-phase probes outrank lingering shadows on the shared gate. */
  let gatePriority: CommandPriority = CommandPriority.High;
  let blockingEnded = false;
  const markBlockingEnded = (): void => {
    blockingEnded = true;
    gatePriority = CommandPriority.Low;
  };
  /** Run one probe under the engine-shared census budget (no-op without a gate). */
  const gated = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (!gate) return fn();
    const release = await gate.acquire(gatePriority, ac.signal);
    try {
      return await fn();
    } finally {
      release();
    }
  };

  const trust = opts.trust;
  const holes = new HoleAccumulator();
  /** 0 = unclaimed/retryable, 1 = claimed for emission (or re-queued). */
  const checked = new Uint8Array(total);
  /** 1 = has a definitive answer (drives `sampled` and `complete`). */
  const answered = new Uint8Array(total);
  let sampled = 0;
  let missing = 0;
  let unknowns = 0;
  let consecutiveUnknowns = 0;
  let mode: 'stat' | 'body-fallback' = 'stat';
  let complete = false;
  let catastrophicCb: (() => void) | undefined;
  let catastrophicFired = false;
  /** Present-evidence attribution for trust-flip re-checks. */
  const soleEvidence = new Map<string, number[]>();
  /** Re-queued flat indices (consumed before the spread). */
  const requeue: number[] = [];
  /** Per-provider STAT-present samples awaiting calibration. */
  const calibrationSamples = new Map<string, NzbSegmentRef[]>();
  /** In-flight trust calibrations (awaited before the census completes). */
  const pendingCalibrations = new Set<Promise<void>>();

  const providerIds = pool.providerIds();

  const snapshot = (): CensusSnapshot => ({
    total,
    sampled,
    missing,
    unknowns,
    longestRun: holes.longestRun,
    holes,
    trustedProviders: trust.trustedIds(providerIds),
    untrustedProviders: trust.untrustedIds(providerIds),
    mode,
    complete,
  });

  // ---- emission order: anchors, then bit-reversal permutation of [0, total).
  const anchors: number[] = [];
  for (let i = 0; i < Math.min(ANCHOR_HEAD_FILES, dataFiles.length); i++) {
    anchors.push(prefix[i]);
  }
  for (
    let i = Math.max(0, dataFiles.length - ANCHOR_TAIL_FILES);
    i < dataFiles.length;
    i++
  ) {
    if (!anchors.includes(prefix[i])) anchors.push(prefix[i]);
  }
  const bits = Math.max(1, Math.ceil(Math.log2(Math.max(2, total))));
  const permSize = 1 << bits;
  let permCursor = 0;
  let anchorCursor = 0;
  const nextIndex = (): number | undefined => {
    const re = requeue.pop();
    if (re !== undefined) return re; // stays marked checked
    while (anchorCursor < anchors.length) {
      const a = anchors[anchorCursor++];
      if (!checked[a]) {
        checked[a] = 1;
        return a;
      }
    }
    while (permCursor < permSize) {
      let v = 0;
      let x = permCursor++;
      for (let b = 0; b < bits; b++) {
        v = (v << 1) | (x & 1);
        x >>= 1;
      }
      if (v < total && !checked[v]) {
        checked[v] = 1;
        return v;
      }
    }
    return undefined;
  };

  // ---- outcome recording -----------------------------------------------------
  const recordMiss = (fileIndex: number, local: number): void => {
    if (!holes.has(fileIndex, local)) {
      holes.add(fileIndex, local);
      missing++;
    }
  };

  const maybeCatastrophic = (): void => {
    if (catastrophicFired || ac.signal.aborted) return;
    if (
      missing >= CENSUS_BLOCKING_MIN_HITS &&
      sampled > 0 &&
      missing / sampled >= CATASTROPHIC_MISS_RATIO
    ) {
      catastrophicFired = true;
      logger.warn(
        { nzbHash: nzb.hash, sampled, missing },
        'census: release appears dead (overwhelming miss ratio)'
      );
      catastrophicCb?.();
    }
  };

  /** One STAT against the trusted provider set. */
  const statOne = async (
    flat: number
  ): Promise<'present' | 'missing' | 'unknown'> => {
    const ref = refAt(flat);
    const trusted = trust.trustedIds(providerIds);
    if (trusted.length === 0) return 'unknown'; // body-fallback takes over
    try {
      const detail = await gated(() =>
        pool.statSegmentDetailed(
          ref.seg.messageId,
          ac.signal,
          nzb.hash,
          trusted
        )
      );
      if (!detail.answered) return 'unknown';
      if (detail.present) {
        if (detail.answeredBy) observePresent(detail.answeredBy, ref.seg, flat);
        return 'present';
      }
      return 'missing';
    } catch {
      return 'unknown';
    }
  };

  /**
   * STAT one segment addressed by (file, local), with full bookkeeping.
   * Returns the outcome; unknown leaves the index retryable by the spread.
   */
  const statAt = async (
    fileIndex: number,
    local: number
  ): Promise<'present' | 'missing' | 'unknown'> => {
    if (holes.has(fileIndex, local)) return 'missing';
    const flat = flatOf(fileIndex, local);
    checked[flat] = 1;
    const r = await statOne(flat);
    if (r === 'unknown') {
      // Unanswered: release the claim so a later round may retry it (the
      // spread cursor has passed, so this only matters for requeues) and
      // `complete` stays honest.
      if (!answered[flat]) checked[flat] = 0;
      return r;
    }
    if (!answered[flat]) {
      answered[flat] = 1;
      sampled++;
    }
    if (r === 'missing') recordMiss(fileIndex, local);
    return r;
  };

  // ---- trust calibration -------------------------------------------------------
  const observePresent = (
    providerId: string,
    seg: NzbSegmentRef,
    flat: number
  ): void => {
    // Attribute sole evidence for a possible re-check on a later trust flip.
    let list = soleEvidence.get(providerId);
    if (!list) soleEvidence.set(providerId, (list = []));
    if (list.length < 4096) list.push(flat);
    if (trust.state(providerId) !== 'unknown') return;
    let samples = calibrationSamples.get(providerId);
    if (!samples) calibrationSamples.set(providerId, (samples = []));
    samples.push(seg);
    if (samples.length < TRUST_CALIBRATION_SAMPLES) return;
    if (!trust.beginCalibration(providerId)) return;
    // Tracked so the main loop can await settlement before declaring the
    // census complete (a flip re-queues that provider's sole-evidence
    // segments, which must be re-checked in another worker round).
    const p = calibrate(
      providerId,
      samples.splice(0, TRUST_CALIBRATION_SAMPLES)
    );
    pendingCalibrations.add(p);
    void p.finally(() => pendingCalibrations.delete(p));
  };

  const calibrate = async (
    providerId: string,
    samples: NzbSegmentRef[]
  ): Promise<void> => {
    let lied = false;
    for (const seg of samples) {
      if (ac.signal.aborted) break;
      const outcome = await gated(() =>
        pool.probeBodyOnProvider(seg, providerId, ac.signal)
      ).catch(() => 'unreachable' as const);
      if (outcome === 'not_found') lied = true;
    }
    // Unreachable-only calibration settles as trusted (never brand a provider
    // a liar over transport trouble); a definitive BODY 430 for a segment it
    // STAT'd present is the lie.
    trust.settleCalibration(providerId, !lied);
    if (lied) {
      logger.warn(
        { providerId },
        'census: provider STAT answers are untrustworthy (BODY 430 for STAT-present); excluding from availability evidence'
      );
      // Every segment whose only present-evidence came from the liar gets
      // re-checked against the remaining trusted providers.
      for (const flat of soleEvidence.get(providerId) ?? []) requeue.push(flat);
      soleEvidence.delete(providerId);
    }
  };

  // ---- run densification --------------------------------------------------------
  /**
   * Measure the run around a confirmed miss: linear walk out to the pad cap
   * (this alone answers pad-vs-fail), then gallop + bisect toward each
   * boundary within a bounded STAT budget. The bisected interior between two
   * confirmed misses is closed as missing (long dead runs are contiguous in
   * practice; takedowns and truncated posts don't alternate).
   */
  const densify = async (fileIndex: number, local: number): Promise<void> => {
    const fileLen = nzb.files[fileIndex].segments.length;
    let budget = DENSIFY_STAT_BUDGET;
    const probe = async (
      l: number
    ): Promise<'present' | 'missing' | 'unknown'> => {
      if (l < 0 || l >= fileLen) return 'present'; // file edge = boundary
      if (holes.has(fileIndex, l)) return 'missing';
      if (budget-- <= 0) return 'unknown';
      return statAt(fileIndex, l);
    };

    for (const dir of [-1, 1] as const) {
      let edge = local;
      let steps = 0;
      while (steps < MAX_PAD_RUN_SEGMENTS + 1) {
        const r = await probe(edge + dir);
        if (r !== 'missing') break;
        edge += dir;
        steps++;
      }
      if (steps < MAX_PAD_RUN_SEGMENTS + 1) continue; // boundary found early
      // Gallop past the run, then bisect between last-missing and first-present.
      let lastMissing = edge;
      let firstPresent: number | undefined;
      let stride = 2;
      while (budget > 0) {
        const at = lastMissing + dir * stride;
        const r = await probe(at);
        if (r === 'missing') {
          lastMissing = at;
          stride *= 2;
        } else {
          firstPresent = Math.max(0, Math.min(fileLen - 1, at));
          break;
        }
      }
      if (firstPresent === undefined) continue;
      let missBound = lastMissing;
      let presBound = firstPresent;
      while (Math.abs(presBound - missBound) > 1 && budget > 0) {
        const mid = (missBound + presBound) >> 1;
        const r = await probe(mid);
        if (r === 'missing') missBound = mid;
        else presBound = mid; // unknown counts as present: stop expanding
      }
      // Close the confirmed span [local..missBound] (or reverse) as missing.
      const runStart = Math.min(local, missBound);
      const runEnd = Math.max(local, missBound);
      for (let l = runStart; l <= runEnd; l++) {
        const flat = flatOf(fileIndex, l);
        checked[flat] = 1;
        if (!answered[flat]) {
          answered[flat] = 1;
          sampled++;
        }
        recordMiss(fileIndex, l);
      }
    }
  };

  // ---- body-fallback (no trusted STAT provider at all) ---------------------------
  const bodyFallback = async (): Promise<void> => {
    logger.warn(
      { nzbHash: nzb.hash },
      'census: no provider has trustworthy STAT; falling back to a spread BODY sample'
    );
    mode = 'body-fallback';
    for (const flat of samplePointIndices(total, BODY_FALLBACK_POINTS)) {
      if (ac.signal.aborted) return;
      const ref = refAt(flat);
      checked[flat] = 1;
      try {
        await gated(() =>
          pool.fetchSegment(ref.seg, nzb.hash, ac.signal, CommandPriority.Low)
        );
        if (!answered[flat]) {
          answered[flat] = 1;
          sampled++;
        }
      } catch (err) {
        if (
          err instanceof ArticleNotFoundError ||
          err instanceof YencDecodeError
        ) {
          if (!answered[flat]) {
            answered[flat] = 1;
            sampled++;
          }
          recordMiss(ref.fileIndex, ref.local);
          maybeCatastrophic();
        }
        // Transient errors: unknown, never evidence.
      }
    }
  };

  // ---- worker loop ------------------------------------------------------------------
  const concurrency = Math.max(1, opts.concurrency ?? CENSUS_CONCURRENCY);
  const shadowConcurrency = Math.max(
    1,
    Math.min(opts.shadowConcurrency ?? concurrency, concurrency)
  );
  let resolveDone!: (s: CensusSnapshot) => void;
  const done = new Promise<CensusSnapshot>((res) => (resolveDone = res));

  const lifetimeMs = opts.maxLifetimeMs ?? 0;
  let lifetimeTimer: NodeJS.Timeout | undefined;
  if (lifetimeMs > 0) {
    lifetimeTimer = setTimeout(() => {
      logger.warn(
        { nzbHash: nzb.hash, lifetimeMs, sampled, total },
        'census: exceeded max lifetime; cancelling'
      );
      ac.abort();
    }, lifetimeMs);
    lifetimeTimer.unref?.();
  }

  const worker = async (index: number): Promise<void> => {
    while (!ac.signal.aborted) {
      if (blockingEnded && index >= shadowConcurrency) return;
      if (mode === 'stat' && trust.trustedIds(providerIds).length === 0) {
        return; // coordinator switches to body-fallback
      }
      const flat = nextIndex();
      if (flat === undefined) return;
      const ref = refAt(flat);
      const r = await statAt(ref.fileIndex, ref.local);
      if (r === 'unknown') {
        unknowns++;
        if (++consecutiveUnknowns >= UNKNOWN_STORM_LIMIT) {
          logger.warn(
            { nzbHash: nzb.hash, unknowns },
            'census: providers unreachable; abandoning census'
          );
          ac.abort();
          return;
        }
        continue;
      }
      consecutiveUnknowns = 0;
      if (r === 'missing') {
        maybeCatastrophic();
        await densify(ref.fileIndex, ref.local);
        maybeCatastrophic();
      }
    }
  };

  const main = (async (): Promise<void> => {
    if (total === 0) {
      complete = true;
      return;
    }
    const startedAt = Date.now();
    // Worker rounds: a trust flip mid-round re-queues that provider's
    // sole-evidence segments, which need a fresh round after calibration
    // settles; a clean round with an empty requeue is the fixpoint.
    do {
      await Promise.all(
        Array.from({ length: concurrency }, (_, i) => worker(i))
      );
      while (pendingCalibrations.size > 0) {
        await Promise.all([...pendingCalibrations]);
      }
    } while (!ac.signal.aborted && requeue.length > 0);
    // Workers bailed because STAT trust collapsed → one bounded BODY sample.
    if (
      !ac.signal.aborted &&
      mode === 'stat' &&
      trust.trustedIds(providerIds).length === 0
    ) {
      await bodyFallback();
    }
    complete =
      !ac.signal.aborted &&
      ((mode as CensusSnapshot['mode']) === 'body-fallback' ||
        answered.every((a) => a === 1));
    logger.debug(
      {
        nzbHash: nzb.hash,
        total,
        sampled,
        missing,
        unknowns,
        longestRun: holes.longestRun,
        mode,
        complete,
        latency: Date.now() - startedAt,
      },
      'census finished'
    );
  })();

  void main
    .catch((err) => {
      logger.error(
        { nzbHash: nzb.hash, err: (err as Error)?.message },
        'census crashed'
      );
    })
    .finally(() => {
      if (lifetimeTimer) clearTimeout(lifetimeTimer);
      if (opts.signal) opts.signal.removeEventListener('abort', externalAbort);
      resolveDone(snapshot());
    });

  return {
    onCatastrophic(cb: () => void): void {
      catastrophicCb = cb;
      if (catastrophicFired) cb();
    },
    hasConfirmedMiss(): boolean {
      return missing > 0;
    },
    endBlockingPhase(tailMs: number): Promise<CensusSnapshot> {
      if (tailMs <= 0) {
        markBlockingEnded();
        return Promise.resolve(snapshot());
      }
      let timer: NodeJS.Timeout | undefined;
      const expiry = new Promise<CensusSnapshot>((res) => {
        timer = setTimeout(() => res(snapshot()), tailMs);
        timer.unref?.();
      });
      return Promise.race([done, expiry]).finally(() => {
        markBlockingEnded();
        if (timer) clearTimeout(timer);
      });
    },
    done,
    snapshot,
    cancel(): void {
      ac.abort();
    },
  };
}
