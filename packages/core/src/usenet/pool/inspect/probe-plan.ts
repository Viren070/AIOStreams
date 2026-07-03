import { createLogger } from '../../../logging/logger.js';
import { MultiProviderPool } from '../multi-provider-pool.js';
import { type Par2Index, par2NameKey } from '../../par2/decode.js';
import { Nzb } from '../../nzb/model.js';
import { isProbablyObfuscated } from '../../nzb/obfuscation.js';
import {
  archiveBaseName,
  groupVolumeSets,
  sevenZipVolumeNumber,
} from '../archive/archive-volume.js';
import { InspectOptions } from './types.js';
import { prefetchPar2Index } from './par2-names.js';

const logger = createLogger('usenet/inspect');

/**
 * Minimum volume count before an archive set is worth lazy-parsing (skipping
 * its middle-volume probes). Below this the probes cost less than the
 * bookkeeping.
 */
const MIN_LAZY_VOLS = 8;
/**
 * After this many probe completions, re-group with the names recovered so far
 * (yEnc headers often carry real `.7z.NNN` names for obfuscated subjects) and
 * skip the remaining middle probes of any split-7z set found.
 */
export const DYNAMIC_REGROUP_PROBES = 32;

/**
 * Encoded-size tolerance for treating a file as a uniform split-7z volume slice
 * (vs a par2 sidecar or the smaller last volume). yEnc overhead is uniform per
 * decoded byte, so genuine equal-size volumes differ only by a hair; par2
 * recovery files are several % off.
 */
const UNIFORM_SIZE_TOLERANCE = 0.01;

/** Median encoded size of the given files (0 when none have a positive size). */
function medianEncodedSize(files: Array<{ encodedSize: number }>): number {
  const sizes = files.map((f) => f.encodedSize).filter((s) => s > 0);
  if (sizes.length === 0) return 0;
  sizes.sort((a, b) => a - b);
  return sizes[sizes.length >> 1];
}

/**
 * Which files to probe and what is already known about the rest; built before
 * the probe pass, refined mid-pass by {@link ProbePlan.dynamicRegroup}.
 */
export interface ProbePlan {
  /** NZB file indices that skip their probe entirely. */
  skipProbe: Set<number>;
  /** PAR2-exact decoded sizes for skipped lazy-RAR volumes, by file index. */
  lazySizes: Map<number, number>;
  /** Names as recovered so far (yEnc header names land here as probes finish). */
  liveNames: (string | undefined)[];
  /** Names INFERRED for files that were never probed (split-7z middles). */
  inferredNames: Map<number, string>;
  /** PAR2 descriptor index, when prefetched for lazy-RAR sizing. */
  par2Index?: Par2Index;
  /** Whether PAR2 filename recovery is worth running after the probes. */
  wantPar2: boolean;
  /** Mid-pass re-grouping over recovered names: see the implementation. */
  dynamicRegroup(): void;
}

/** Build the probe plan: split-7z skips, lazy-RAR sizing, PAR2 decisions. */
export async function buildProbePlan(
  nzb: Nzb,
  pool: MultiProviderPool,
  opts: InspectOptions,
  confirmedMiss: boolean
): Promise<ProbePlan> {
  // Split 7z volumes are fixed-size slices of ONE container: every volume but
  // the last has the first volume's exact size, and only the signature header
  // (vol 1) and end header (last vol) are ever parsed. Probing the middles
  // (a full segment each) is therefore pure waste. Skip them: classification
  // comes from the filename, the engine infers their sizes from volume 1, and
  // the archive parse re-probes for real if the inference turns out wrong.
  const skipProbe = new Set<number>();
  for (const set of groupVolumeSets(
    nzb.files.map((f, index) => ({
      index,
      filename: f.filename,
      segments: f.segments.length,
      firstSegmentNumber: f.segments[0]?.number,
    }))
  )) {
    if (set.kind !== '7z' || set.members.length < 4) continue;
    for (const m of set.members.slice(1, -1)) skipProbe.add(m.index);
  }

  // PAR2 exists (for us) to recover real names for obfuscated/unnamed files.
  // Archive VOLUMES never need that: grouping keys off the `.7z.NNN`/`.rNN`
  // suffix (even with an obfuscated stem) and display names come from the
  // inner-file listing. So par2 is only worth fetching when some plain,
  // non-volume file is unnamed or looks obfuscated; otherwise the par2 probes
  // and the descriptor fetch are pure waste; skip them (classified by ext).
  const isPar2Name = (n?: string) => !!n && /\.par2$/i.test(n);
  const wantPar2 = nzb.files.some(
    (f) =>
      !isPar2Name(f.filename) &&
      (!f.filename ||
        (archiveBaseName(f.filename) === undefined &&
          isProbablyObfuscated(f.filename)))
  );

  // Lazy RAR: for NAMED RAR sets big enough to matter, the PAR2 descriptors
  // give every volume's EXACT size by filename; no content fetch needed. The
  // middle volumes then skip probing entirely; the archive parse walks only
  // the volumes where a file starts/ends (middles become pending fragments
  // resolved on first touch) and per-set STAT sampling restores the
  // availability evidence. Skipped middles record their exact size here so
  // volume offset maps stay correct. A lazy resolve later reads the volume's
  // leading bytes, so a set whose members lack their first segment (deduped
  // fill posts) keeps full probes.
  const lazySizes = new Map<number, number>();
  let par2Index: Par2Index | undefined;
  if (opts.lazyArchives && !confirmedMiss && !opts.signal?.aborted) {
    const rarSets = groupVolumeSets(
      nzb.files.map((f, index) => ({
        index,
        filename: f.filename,
        segments: f.segments.length,
        firstSegmentNumber: f.segments[0]?.number,
      }))
    ).filter(
      (s) =>
        s.kind === 'rar' &&
        s.members.length >= MIN_LAZY_VOLS &&
        s.members.every((m) => nzb.files[m.index]?.segments[0]?.number === 1)
    );
    if (rarSets.length > 0) {
      par2Index = await prefetchPar2Index(nzb, pool, opts.signal);
      if (par2Index) {
        // Fill/repost NZBs carry duplicate copies of set members that dedup
        // removed from `members`; left alone they'd each still pay a probe.
        // The survivors carry all the evidence; skip the copies wholesale.
        const lazyBases = new Set<string>();
        const survivors = new Set<number>();
        for (const set of rarSets) {
          const sizes = set.members.map(
            (m) => par2Index!.byName.get(par2NameKey(m.filename))?.length
          );
          // Every member needs an exact size, or offsets would be corrupt.
          if (sizes.some((s) => !s || s <= 0)) continue;
          set.members.forEach((m, i) => lazySizes.set(m.index, sizes[i]!));
          for (const m of set.members.slice(1, -1)) skipProbe.add(m.index);
          lazyBases.add(`${set.baseName} rar`);
          for (const m of set.members) survivors.add(m.index);
          logger.debug(
            {
              nzbHash: nzb.hash,
              base: set.baseName,
              volumes: set.members.length,
              skipped: set.members.length - 2,
            },
            'lazy: par2 sizes cover the set; skipping middle-volume probes'
          );
        }
        if (lazyBases.size > 0) {
          let dupSkipped = 0;
          nzb.files.forEach((f, index) => {
            if (skipProbe.has(index) || survivors.has(index)) return;
            const b = f.filename ? archiveBaseName(f.filename) : undefined;
            if (b && lazyBases.has(`${b.base} ${b.kind}`)) {
              skipProbe.add(index);
              dupSkipped++;
            }
          });
          if (dupSkipped > 0) {
            logger.debug(
              { nzbHash: nzb.hash, dupSkipped },
              'lazy: skipping duplicate/fill copies of covered volume sets'
            );
          }
        }
      }
    }
  }

  // PAR2 probes are pure waste when the descriptor index is already fetched
  // (chase) or no file needs name recovery in the first place.
  if (!wantPar2 || par2Index) {
    nzb.files.forEach((f, index) => {
      if (isPar2Name(f.filename)) skipProbe.add(index);
    });
  }

  // Names as recovered so far + names INFERRED for files that were never
  // probed; see dynamicRegroup.
  const liveNames: (string | undefined)[] = nzb.files.map((f) => f.filename);
  const inferredNames = new Map<number, string>();

  /**
   * Obfuscated split-7z sets (md5 subjects, real `.7z.NNN` names only in the
   * yEnc headers) can't be grouped before probing. Once enough probes have
   * completed, look for a strict file-order ↔ volume-number correlation in the
   * recovered names and infer the remaining members' names from it, then skip
   * their probes exactly like a pre-grouped split-7z set. Strictness: every
   * probed file inside the inferred window must fit `volume = index - offset`;
   * any violation abandons the inference (mixed releases keep full probes).
   */
  const dynamicRegroup = (): void => {
    // Strict membership: never infer obfuscated split-7z volume names by
    // position.
    if (opts.strictArchiveMembership) return;
    type Hit = { index: number; volume: number; base: string };
    const byBase = new Map<string, Hit[]>();
    for (let i = 0; i < liveNames.length; i++) {
      const name = liveNames[i];
      if (!name || skipProbe.has(i)) continue;
      const b = archiveBaseName(name);
      if (!b || b.kind !== '7z') continue;
      const volume = sevenZipVolumeNumber(name);
      if (volume < 0) continue;
      let hits = byBase.get(b.base);
      if (!hits) {
        hits = [];
        byBase.set(b.base, hits);
      }
      hits.push({ index: i, volume, base: b.base });
    }
    const obfuscatedShaped = (i: number): boolean => {
      const subject = nzb.files[i].filename;
      return (
        !subject ||
        (archiveBaseName(subject) === undefined &&
          !/\.par2$/i.test(subject) &&
          isProbablyObfuscated(subject))
      );
    };
    for (const [base, hits] of byBase) {
      if (hits.length < MIN_LAZY_VOLS) continue;
      // Inference is only safe when the poster uploaded strictly in volume
      // order. Real releases DO shuffle; those keep full probes. The per-file
      // yEnc name is the only truth for an unprobed file and we don't have it
      // by definition.
      const offset = hits[0].index - hits[0].volume;
      if (!hits.every((h) => h.index - h.volume === offset)) {
        logger.trace(
          {
            nzbHash: nzb.hash,
            offset,
            violators: hits
              .filter((h) => h.index - h.volume !== offset)
              .slice(0, 6)
              .map((h) => ({ i: h.index, v: h.volume })),
          },
          'dynamic regroup: index↔volume correlation broken; keeping probes'
        );
        continue;
      }
      // Uniform-slice gate: a split-7z's volumes are fixed-size slices, so an
      // inferable middle MUST have the same encoded size as the probed volumes.
      const refEnc = medianEncodedSize(hits.map((h) => nzb.files[h.index]));
      const sizeUniform = (i: number): boolean => {
        if (refEnc <= 0) return true; // no usable reference: don't regress
        const e = nzb.files[i].encodedSize;
        return e > 0 && Math.abs(e - refEnc) <= refEnc * UNIFORM_SIZE_TOLERANCE;
      };
      // Width of the numeric suffix (e.g. `.7z.001` → 3) from a sample name.
      const sample = liveNames[hits[0].index]!;
      const width = sample.match(/\.7z\.(\d+)$/i)?.[1].length ?? 3;
      // The probed hits only span the files probed SO FAR; extend the window
      // across the contiguous obfuscated-shaped block they sit in (volume
      // numbers start at 1, so the low edge is bounded by the offset). The
      // size gate stops the walk at the first non-uniform file (par2 / last vol).
      let lo = Math.min(...hits.map((h) => h.index));
      let hi = Math.max(...hits.map((h) => h.index));
      while (
        lo - 1 >= 0 &&
        lo - 1 - offset >= 1 &&
        obfuscatedShaped(lo - 1) &&
        sizeUniform(lo - 1)
      ) {
        lo--;
      }
      while (
        hi + 1 < nzb.files.length &&
        obfuscatedShaped(hi + 1) &&
        sizeUniform(hi + 1)
      )
        hi++;
      let added = 0;
      // `hi` itself stays probed: its recovered yEnc name verifies the set's
      // tail (the 7z end header lives there) instead of trusting inference.
      for (let i = lo; i < hi; i++) {
        if (liveNames[i] !== nzb.files[i].filename) continue; // probed/renamed
        if (skipProbe.has(i)) continue;
        if (!sizeUniform(i)) continue;
        const inferred = `${base}.7z.${String(i - offset).padStart(width, '0')}`;
        inferredNames.set(i, inferred);
        liveNames[i] = inferred;
        skipProbe.add(i);
        added++;
      }
      if (added > 0) {
        logger.debug(
          {
            nzbHash: nzb.hash,
            base: base.slice(-24),
            matched: hits.length,
            offset,
            refEnc,
            lo,
            hi,
            inferred: added,
          },
          'dynamic probe skip: yEnc names revealed an obfuscated split-7z set'
        );
      }
    }
  };

  return {
    skipProbe,
    lazySizes,
    liveNames,
    inferredNames,
    par2Index,
    wantPar2,
    dynamicRegroup,
  };
}
