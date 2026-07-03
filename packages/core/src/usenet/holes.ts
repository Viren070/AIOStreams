/**
 * Shared model + threshold policy for "holes": segments confirmed missing on
 * every provider (430 everywhere). One table governs both moments the engine
 * meets a hole:
 *
 * - at IMPORT, the census verifier classifies a release's confirmed damage
 *   (fail the import / import as degraded / clean), and
 * - at PLAYBACK, the hole hooks decide per miss whether to zero-fill and keep
 *   streaming or to kill the stream and fail the library entry.
 *
 * This module is imported by both `pool/*` and `integration/*`; it must not
 * import from either (only leaf types) to stay cycle-free.
 */

/** A run of ≤ this many consecutive missing segments is zero-filled. */
export const MAX_PAD_RUN_SEGMENTS = 4;
/**
 * Byte twin of {@link MAX_PAD_RUN_SEGMENTS} for the archive window path,
 * where misses are observed as failed fixed-size windows rather than
 * segments.
 */
export const MAX_PAD_RUN_BYTES = 4 * (1 << 20);
/** Cumulative padded-segment cap per playback target. */
export const MAX_PAD_TOTAL_SEGMENTS = 64;
/** Byte twin of {@link MAX_PAD_TOTAL_SEGMENTS} for the archive window path. */
export const MAX_PAD_TOTAL_BYTES = 64 * 768 * 1024;
/**
 * Cumulative padded-bytes share of the target above which it is unwatchable.
 * The segment-count caps are the primary guards; this ratio only protects
 * small files where the segment caps would be a large share.
 */
export const MAX_PAD_FILE_BYTES_RATIO = 0.02;
/**
 * The census blocking phase may fail an import from a PROJECTION (partial
 * sample) only with at least this many confirmed misses; an observed run
 * beyond {@link MAX_PAD_RUN_SEGMENTS} fails regardless (it is measured, not
 * projected).
 */
export const CENSUS_BLOCKING_MIN_HITS = 8;
/** Projection must exceed the cumulative cap by this factor to fail early. */
export const CENSUS_PROJECTION_MARGIN = 2;

/** A run of consecutive missing segments in one NZB file's segment space. */
export interface HoleRun {
  /** NZB file index (position in `nzb.files`). */
  file: number;
  /** First missing segment index within the file. */
  start: number;
  /** Number of consecutive missing segments. */
  count: number;
}

export type HoleVerdict = 'clean' | 'degraded' | 'failed';

/**
 * Apply the threshold table to a target's confirmed damage. `runs` must cover
 * the target's whole backing set (all volumes of an archive target).
 * `targetBytes` is the target's decoded size when known; `segBytes` an average
 * decoded segment size (encoded sizes are fine; yEnc overhead is negligible
 * for the ratio guard).
 */
export function classifyHoles(
  runs: HoleRun[],
  targetBytes: number | undefined,
  segBytes: number
): HoleVerdict {
  if (runs.length === 0) return 'clean';
  let total = 0;
  let longest = 0;
  for (const r of runs) {
    total += r.count;
    if (r.count > longest) longest = r.count;
  }
  if (longest > MAX_PAD_RUN_SEGMENTS) return 'failed';
  if (total > MAX_PAD_TOTAL_SEGMENTS) return 'failed';
  if (
    targetBytes !== undefined &&
    targetBytes > 0 &&
    total * Math.max(1, segBytes) > MAX_PAD_FILE_BYTES_RATIO * targetBytes
  ) {
    return 'failed';
  }
  return 'degraded';
}

/**
 * Blocking-phase variant: classify from a partial, uniform sample. Never
 * returns `clean`: absence of evidence is `unknown` until the census
 * completes.
 */
export function classifyProjectedHoles(
  hits: number,
  sampled: number,
  totalSegments: number,
  longestObservedRun: number
): HoleVerdict | 'unknown' {
  if (longestObservedRun > MAX_PAD_RUN_SEGMENTS) return 'failed';
  if (hits <= 0) return 'unknown';
  if (hits >= CENSUS_BLOCKING_MIN_HITS && sampled > 0) {
    const projected = (hits / sampled) * totalSegments;
    if (projected > CENSUS_PROJECTION_MARGIN * MAX_PAD_TOTAL_SEGMENTS) {
      return 'failed';
    }
  }
  return 'degraded';
}

/** Serialize runs as compact JSON rows `[file, start, count]`. */
export function serializeHoles(runs: HoleRun[]): number[][] {
  return runs.map((r) => [r.file, r.start, r.count]);
}

/** Parse + validate persisted hole rows; malformed rows are dropped. */
export function deserializeHoles(raw: unknown): HoleRun[] {
  if (!Array.isArray(raw)) return [];
  const out: HoleRun[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const [file, start, count] = row;
    if (
      typeof file === 'number' &&
      typeof start === 'number' &&
      typeof count === 'number' &&
      Number.isInteger(file) &&
      Number.isInteger(start) &&
      Number.isInteger(count) &&
      file >= 0 &&
      start >= 0 &&
      count > 0
    ) {
      out.push({ file, start, count });
    }
  }
  return out;
}

/**
 * Incrementally accumulates missing segments into maximal runs. Used by the
 * census (spread hits + densified runs) and by the playback session (pads as
 * they happen, including out-of-order discovery via seeks).
 */
export class HoleAccumulator {
  /** Per file: runs sorted by start, non-overlapping, non-adjacent. */
  private byFile = new Map<number, HoleRun[]>();
  private _total = 0;
  private _longest = 0;

  get total(): number {
    return this._total;
  }

  get longestRun(): number {
    return this._longest;
  }

  /** All runs, ordered by (file, start). */
  runs(): HoleRun[] {
    const out: HoleRun[] = [];
    for (const [, runs] of [...this.byFile].sort((a, b) => a[0] - b[0])) {
      out.push(...runs);
    }
    return out;
  }

  /** Runs restricted to a set of files (a target's backing set). */
  runsForFiles(files: ReadonlySet<number>): HoleRun[] {
    const out: HoleRun[] = [];
    for (const [file, runs] of this.byFile) {
      if (files.has(file)) out.push(...runs);
    }
    return out.sort((a, b) => a.file - b.file || a.start - b.start);
  }

  /** Missing segment indices for one file (for replay pre-pad sets). */
  indicesForFile(file: number): Set<number> {
    const out = new Set<number>();
    for (const r of this.byFile.get(file) ?? []) {
      for (let i = 0; i < r.count; i++) out.add(r.start + i);
    }
    return out;
  }

  has(file: number, index: number): boolean {
    return this.runAt(file, index) !== undefined;
  }

  /** The maximal run containing (file, index), if that segment is missing. */
  runAt(file: number, index: number): HoleRun | undefined {
    const runs = this.byFile.get(file);
    // Runs per file are few; linear scan is fine.
    return runs?.find((r) => index >= r.start && index < r.start + r.count);
  }

  /** Record one missing segment; merges into adjacent runs. */
  add(file: number, index: number): void {
    this.addRun(file, index, 1);
  }

  /** Record a measured run; merges with any overlapping/adjacent runs. */
  addRun(file: number, start: number, count: number): void {
    if (count <= 0) return;
    let runs = this.byFile.get(file);
    if (!runs) {
      runs = [];
      this.byFile.set(file, runs);
    }
    let newStart = start;
    let newEnd = start + count; // exclusive
    // Merge every existing run that overlaps or touches [newStart, newEnd).
    const kept: HoleRun[] = [];
    for (const r of runs) {
      const rEnd = r.start + r.count;
      if (rEnd < newStart || r.start > newEnd) {
        kept.push(r);
      } else {
        this._total -= r.count;
        newStart = Math.min(newStart, r.start);
        newEnd = Math.max(newEnd, rEnd);
      }
    }
    const merged: HoleRun = { file, start: newStart, count: newEnd - newStart };
    kept.push(merged);
    kept.sort((a, b) => a.start - b.start);
    this.byFile.set(file, kept);
    this._total += merged.count;
    if (merged.count > this._longest) this._longest = merged.count;
  }

  /** Seed from persisted rows. */
  load(runs: HoleRun[]): void {
    for (const r of runs) this.addRun(r.file, r.start, r.count);
  }
}

/** Where a playback hole was met (one of the two serve paths). */
export interface HoleInfo {
  /** Backing NZB file index (segment space owner). */
  nzbFileIndex: number;
  /** Segment index within the file (plain SegmentsStream path). */
  segmentIndex?: number;
  /** Archive-logical byte offset of the failed window (archive path). */
  windowOffset?: number;
  /** Exact decoded bytes that will be zero-filled. */
  bytes: number;
}

export type HoleDecision = 'pad' | 'fail';

/**
 * Integration-owned decision channel for playback holes (pattern:
 * `LazyResolveHooks`). The stream stays dumb: it asks, the owner accounts,
 * persists and transitions library status.
 */
export interface HoleHooks {
  /** Synchronous verdict for a definitive all-providers miss. */
  onHole(info: HoleInfo): HoleDecision;
  /**
   * Persisted missing segment indices for a backing file (replay pre-pad):
   * tasks covering these zero-fill immediately without a failover round-trip.
   */
  knownHoles?(nzbFileIndex: number): ReadonlySet<number> | undefined;
}
