import pLimit from 'p-limit';
import { RandomAccess } from '../random-access.js';
import { createLogger } from '../../../../logging/logger.js';
import { ArchiveEntry, DataFragment } from '../types.js';
import {
  RarVolumeError,
  RarParseOptions,
  ParsedFile,
  VolumeParse,
  LazyAbortError,
} from './types.js';
import { walkVolume } from './walk.js';

const logger = createLogger('usenet/rar');

function headerVolumeOrder(
  numbers: Array<number | undefined>
): number[] | null {
  const n = numbers.length;
  if (n === 0) return null;
  const resolved = numbers.map((v) => (v === undefined ? 0 : v));
  const seen = new Set<number>();
  for (const r of resolved) {
    if (!Number.isInteger(r) || r < 0 || r >= n || seen.has(r)) return null;
    seen.add(r);
  }
  return resolved
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.i);
}

/**
 * Minimum volumes the FIRST split file must span for the lazy parse to pay
 * off. The boundary chain is serial (~1 round-trip per inner file), while the
 * full parse walks volumes in parallel; short per-file spans make the parallel
 * full parse faster than chaining boundary hops serially.
 */
const MIN_LAZY_FILE_SPAN_VOLS = 5;

export class RarReader {
  private entries: ArchiveEntry[] = [];
  private byName = new Map<string, ArchiveEntry>();
  /** File currently spanning volumes (awaiting its split-after continuation). */
  private pending: ArchiveEntry | null = null;
  /** Per-volume parse failures from the last {@link parse} run. */
  readonly volumeErrors: RarVolumeError[] = [];

  /**
   * @param ra            backing random-access stream (concatenated volumes).
   * @param ranges        absolute [start,end) of each volume; each begins with
   *                      its own signature. Defaults to a single volume covering
   *                      the whole stream (e.g. a nested inner archive).
   */
  constructor(
    private ra: RandomAccess,
    private ranges?: Array<{ start: number; end: number }>
  ) {}

  async parse(opts: RarParseOptions = {}): Promise<ArchiveEntry[]> {
    const perVolume = !!(this.ranges && this.ranges.length > 0);
    const ranges = perVolume
      ? this.ranges!
      : [{ start: 0, end: this.ra.size() }];
    if (opts.lazy && perVolume && ranges.length >= 3) {
      try {
        return await this.parseLazy(ranges, opts);
      } catch (err) {
        if (!(err instanceof LazyAbortError)) throw err;
        logger.debug(
          { volumes: ranges.length, err: err.message },
          'lazy parse abandoned; falling back to full per-volume parse'
        );
      }
    }
    const limit = pLimit(Math.max(1, opts.concurrency ?? 1));
    this.entries = [];
    this.byName.clear();
    this.pending = null;
    this.volumeErrors.length = 0;

    // Phase 1: walk each volume's block headers independently. Only the
    // split-file continuation linking crosses volumes, and that runs in
    // phase 2 over the ordered results.
    const results: VolumeParse[] = new Array(ranges.length);
    await Promise.all(
      ranges.map((range, vi) =>
        limit(async () => {
          if (opts.signal?.aborted) {
            results[vi] = { blocks: [], error: new Error('parse aborted') };
            return;
          }
          try {
            results[vi] = await walkVolume(
              this.ra,
              {
                range,
                head: opts.heads?.[vi],
                perVolume,
                password: opts.password,
              },
              opts.signal
            );
          } catch (err) {
            results[vi] = { blocks: [], error: err as Error };
          }
        })
      )
    );

    // Phase 2: link split-file continuations in volume order, handling any volume misordering
    // compared to the RAR header volume numbers.
    const order =
      headerVolumeOrder(results.map((r) => r.volumeNumber)) ??
      results.map((_, i) => i);
    let version: 4 | 5 | undefined;
    let blocks = 0;
    let encrypted = false;
    for (const vi of order) {
      const vp = results[vi];
      version ??= vp.version;
      if (vp.encrypted) encrypted = true;
      if (vp.error) {
        this.volumeErrors.push({ volume: vi, error: vp.error });
        // The gap breaks any file spanning this volume: its fragment map is no
        // longer contiguous, so close it out as incomplete.
        this.closePendingIncomplete();
        continue;
      }
      for (const b of vp.blocks) {
        blocks++;
        this.addFile(b.file, b.fragment);
      }
    }
    // A file still awaiting its continuation at the end of the set means the
    // NZB is missing trailing volumes; don't let it stream truncated.
    this.closePendingIncomplete();

    this.finalizeSizes();
    this.validateEncrypted();

    logger.debug(
      {
        version,
        volumes: ranges.length,
        blocks,
        encrypted: encrypted || undefined,
        volumeErrors: this.volumeErrors.length,
        volumeErrorSample: this.volumeErrors.slice(0, 5).map((v) => ({
          volume: v.volume,
          err: v.error.message,
        })),
        incomplete: this.entries.filter((e) => e.incomplete).length,
        entries: this.entries.map((e) => ({
          name: e.name,
          frags: e.fragments.length,
          size: e.size,
          stored: e.stored,
          encrypted: e.encrypted || undefined,
          incomplete: e.incomplete,
        })),
      },
      'parse complete'
    );
    return this.entries;
  }

  /**
   * Lazy parse: see {@link RarParseOptions.lazy}. Walks a volume only when a
   * file starts or ends inside it; the volumes a split file fully spans get
   * PENDING fragments: capacity-estimated lengths (head/tail overheads
   * measured at the surrounding boundary volumes) with the per-file sum
   * forced exact by adjusting the last middle. Estimates are never served;
   * the {@link LazyFragmentResolver} reads each pending volume's continuation
   * header on first touch and replaces the fragment with exact values.
   */
  private async parseLazy(
    ranges: Array<{ start: number; end: number }>,
    opts: RarParseOptions
  ): Promise<ArchiveEntry[]> {
    const startedAt = Date.now();
    this.entries = [];
    this.byName.clear();
    this.pending = null;
    this.volumeErrors.length = 0;

    let walked = 0;
    const walk = async (vi: number): Promise<VolumeParse> => {
      if (opts.signal?.aborted) throw new LazyAbortError('aborted');
      walked++;
      const vp = await walkVolume(
        this.ra,
        {
          range: ranges[vi],
          head: opts.heads?.[vi],
          perVolume: true,
          password: opts.password,
        },
        opts.signal
      );
      if (vp.error) {
        throw new LazyAbortError(`volume ${vi}: ${vp.error.message}`);
      }
      // Header-encrypted sets are always parsed eagerly: a middle's encrypted
      // continuation header can't be size-estimated reliably, so bail out.
      if (vp.encrypted) {
        throw new LazyAbortError(`volume ${vi}: header-encrypted`);
      }
      if (vp.blocks.length === 0) {
        throw new LazyAbortError(`volume ${vi}: no file blocks`);
      }
      // Lazy estimation assumes filenames are in physical volume order. If a
      // walked volume's RAR header volume number disagrees with its position,
      // bail to the eager parse, which reorders by header number
      if (vp.volumeNumber !== undefined && vp.volumeNumber !== vi) {
        throw new LazyAbortError(
          `volume ${vi}: header volume number ${vp.volumeNumber} != position (scrambled set)`
        );
      }
      return vp;
    };
    // Measured per-volume overheads: leading bytes before the first file
    // block's data (marker + archive header + file/continuation header) and
    // trailing bytes after the last block's data (quick-open copies + endarc).
    // Refined at every walked volume. Middles only need these as ESTIMATES:
    // real sets wobble by tens-to-hundreds of bytes per volume (varint widths,
    // quick-open copies), which the sum-forcing below absorbs.
    let headOverhead = 0;
    let tailOverhead = 0;
    let version: 4 | 5 | undefined;
    const measure = (vi: number, vp: VolumeParse): void => {
      version ??= vp.version;
      const r = ranges[vi];
      const first = vp.blocks[0];
      const last = vp.blocks[vp.blocks.length - 1];
      headOverhead = first.fragment.offset - r.start;
      tailOverhead = r.end - (last.fragment.offset + last.fragment.length);
      if (headOverhead <= 0 || tailOverhead < 0) {
        throw new LazyAbortError(
          `volume ${vi}: implausible overheads (${headOverhead}/${tailOverhead})`
        );
      }
    };

    const v0 = await walk(0);
    measure(0, v0);
    for (const b of v0.blocks) this.addFile(b.file, b.fragment);

    let pendingFragments = 0;
    let spanChecked = false;
    let vi = 1;
    while (vi < ranges.length) {
      // Read via a method: addFile() mutates this.pending, but TS keeps the
      // property narrowed across method calls.
      const file = this.pendingEntry();
      if (!file) {
        // No file spans into this volume: a fresh file must start here.
        const vp = await walk(vi);
        if (!vp.blocks[0].file.first) {
          throw new LazyAbortError(
            `volume ${vi}: unexpected continuation block`
          );
        }
        measure(vi, vp);
        for (const b of vp.blocks) this.addFile(b.file, b.fragment);
        vi++;
        continue;
      }

      // A split file continues into `vi`. Predict the volume V it ends in
      // from the measured per-volume data capacity, then verify by walking V
      // (the prediction is at worst ±1 volume off until overheads settle).
      const have = file.fragments.reduce((a, f) => a + f.length, 0);
      let remaining = file.size - have;
      if (remaining <= 0) {
        throw new LazyAbortError(`${file.name}: non-positive remaining`);
      }
      let V = vi;
      while (V < ranges.length - 1) {
        const cap =
          ranges[V].end - ranges[V].start - headOverhead - tailOverhead;
        if (cap <= 0) {
          throw new LazyAbortError(`volume ${V}: non-positive capacity`);
        }
        if (remaining <= cap) break;
        remaining -= cap;
        V++;
      }
      let boundary: VolumeParse | undefined;
      for (let attempts = 0; attempts < 4; attempts++) {
        const vp = await walk(V);
        const first = vp.blocks[0];
        if (first.file.first || first.file.name !== file.name) {
          // Overshot: the file ended before V.
          if (V - 1 < vi) {
            throw new LazyAbortError(`${file.name}: boundary undershoot`);
          }
          V--;
          continue;
        }
        if (
          vp.blocks.length === 1 &&
          !first.file.last &&
          V < ranges.length - 1
        ) {
          // Undershot: V is still entirely the file's continuation.
          V++;
          continue;
        }
        boundary = vp;
        break;
      }
      if (!boundary) {
        throw new LazyAbortError(`${file.name}: boundary correction failed`);
      }
      measure(V, boundary);
      // The first split file decides whether lazy pays off at all: short
      // spans mean a dense serial boundary chain; bail to the parallel full
      // parse while only 1-2 walks have been spent.
      if (!spanChecked) {
        spanChecked = true;
        const span = V - vi + 2; // continuation volumes + the start volume
        if (span < MIN_LAZY_FILE_SPAN_VOLS) {
          throw new LazyAbortError(
            `${file.name}: spans only ~${span} volumes (< ${MIN_LAZY_FILE_SPAN_VOLS}); dense boundaries favour the parallel parse`
          );
        }
      }

      // PENDING fragments for the fully-spanned middles [vi, V). The data
      // start/length per middle are capacity ESTIMATES (a middle's real
      // header is not read until first touch); the per-file sum is forced
      // exact by spreading the residual so logical offsets in the resolved
      // prefix and the file's total size are always exact.
      const middles = V - vi;
      // The walk stops at a split-after block, so a continuation that does
      // NOT close the file is always the boundary volume's only block, and
      // the correction loop only lets that shape through at the set's last
      // volume (truncated post).
      const boundaryClosesFile = boundary.blocks[0].file.last;
      const finalFrag = boundary.blocks[0].fragment.length;
      const needed = file.size - have - finalFrag;
      if (middles > 0) {
        if (boundaryClosesFile && needed <= 0) {
          throw new LazyAbortError(
            `${file.name}: non-positive middle span (${needed} bytes over ${middles} volumes)`
          );
        }
        if (boundaryClosesFile) {
          // Capacity estimate per middle, then SPREAD the residual across all
          // middles so the file's fragment sum equals its size. Estimates are
          // never served (resolve targeting only), but spreading keeps each
          // one near its true value: boundary-measured tail overheads run a
          // couple hundred bytes high per middle (boundary volumes carry two
          // quick-open header copies, middles carry one), so a last-middle-only
          // dump would absorb the whole set's wobble.
          const estimates: number[] = [];
          let estSum = 0;
          for (let m = vi; m < V; m++) {
            const cap =
              ranges[m].end - ranges[m].start - headOverhead - tailOverhead;
            if (cap <= 0) {
              throw new LazyAbortError(`volume ${m}: non-positive capacity`);
            }
            estimates.push(cap);
            estSum += cap;
          }
          const residual = needed - estSum;
          // Per-volume wobble is ~hundreds of bytes; anything wildly larger
          // means the set doesn't fit the lazy model (e.g. a RAR4 >4GB size
          // wrap) and the full parse should handle it.
          if (Math.abs(residual) > middles * (1 << 20)) {
            throw new LazyAbortError(
              `${file.name}: implausible residual ${residual} over ${middles} middle volumes`
            );
          }
          const per = Math.trunc(residual / middles);
          let rem = residual - per * middles;
          for (let i = 0; i < estimates.length; i++) {
            let adjusted = estimates[i] + per;
            if (rem > 0) {
              adjusted += 1;
              rem -= 1;
            } else if (rem < 0) {
              adjusted -= 1;
              rem += 1;
            }
            if (adjusted <= 0) {
              throw new LazyAbortError(
                `${file.name}: non-positive adjusted estimate at middle ${i}`
              );
            }
            estimates[i] = adjusted;
          }
          for (let m = vi; m < V; m++) {
            file.fragments.push({
              offset: ranges[m].start + headOverhead,
              length: estimates[m - vi],
              pending: m,
            });
            file.packedSize += estimates[m - vi];
            pendingFragments++;
          }
        } else {
          // A still-open file at the LAST volume (truncated set): no exact
          // equation exists; keep plain capacity estimates, the entry is
          // marked incomplete below and never streams (so no pendings).
          const length =
            ranges[vi].end - ranges[vi].start - headOverhead - tailOverhead;
          if (length <= 0) {
            throw new LazyAbortError(`volume ${vi}: non-positive capacity`);
          }
          for (let m = vi; m < V; m++) {
            const r = ranges[m];
            file.fragments.push({ offset: r.start + headOverhead, length });
            file.packedSize += length;
          }
        }
      } else if (boundaryClosesFile && needed !== 0) {
        throw new LazyAbortError(
          `${file.name}: ${needed} bytes unaccounted with no middle volumes`
        );
      }
      for (const b of boundary.blocks) this.addFile(b.file, b.fragment);

      // Hard invariant: a stored file we just closed must account for every
      // byte the header promised. With the sum forced exact above, a mismatch
      // here means the boundary accounting itself is wrong; abandon.
      if (!this.pendingIs(file) && file.stored && !file.incomplete) {
        const total = file.fragments.reduce((a, f) => a + f.length, 0);
        if (total !== file.size) {
          throw new LazyAbortError(
            `${file.name}: fragment sum ${total} != size ${file.size}`
          );
        }
      }
      vi = V + 1;
    }
    // A file still open past the last volume = truncated post.
    this.closePendingIncomplete();

    for (const e of this.entries) {
      const fragTotal = e.fragments.reduce((a, f) => a + f.length, 0);
      // Estimated (pending) fragments must never overwrite header sizes.
      const hasPending = e.fragments.some((f) => f.pending !== undefined);
      // Data-encrypted (`-p`) entries can reach here with plaintext headers,
      // but the serving path never lazy-resolves through an AES source (and
      // the persisted layout would be rejected on every reopen); only the
      // eager parse may produce streamable encrypted entries.
      if (e.crypt && hasPending) {
        throw new LazyAbortError(`${e.name}: encrypted entry needs full parse`);
      }
      if (e.stored && fragTotal > e.size && !hasPending && !e.crypt)
        e.size = fragTotal;
      e.packedSize = fragTotal;
    }
    logger.debug(
      {
        version,
        volumes: ranges.length,
        walked,
        pendingFragments,
        incomplete: this.entries.filter((e) => e.incomplete).length,
        entries: this.entries.map((e) => ({
          name: e.name,
          frags: e.fragments.length,
          pending: e.fragments.filter((f) => f.pending !== undefined).length,
          size: e.size,
          stored: e.stored,
          incomplete: e.incomplete,
        })),
        latency: Date.now() - startedAt,
      },
      'lazy parse complete'
    );
    return this.entries;
  }

  // ---- entry assembly -------------------------------------------------------

  /** Recompute stored sizes from fragment sums (skips encrypted/pending). */
  private finalizeSizes(): void {
    for (const e of this.entries) {
      const fragTotal = e.fragments.reduce((a, f) => a + f.length, 0);
      // A stored plaintext file's unpacked size equals its fragment sum; trust
      // that if the header looked truncated. Encrypted entries' fragments carry
      // up to 15 trailing AES pad bytes, so never overwrite their header size.
      if (e.stored && fragTotal > e.size && !e.crypt) e.size = fragTotal;
      e.packedSize = fragTotal;
    }
  }

  /**
   * A stored encrypted RAR5 file decrypts as one continuous AES-CBC stream over
   * its concatenated fragments, so per-fragment boundaries need not be 16-byte
   * aligned. The concatenated total must form a valid CBC ciphertext: a
   * multiple of 16, equal to the plaintext size rounded up to the next 16-byte
   * boundary. A total that breaks this invariant means the fragment map is
   * wrong, so drop the crypt info and let the entry report `archive_encrypted`
   * rather than stream garbage.
   */
  private validateEncrypted(): void {
    for (const e of this.entries) {
      if (e.crypt?.v !== 5) continue;
      const total = e.fragments.reduce((a, f) => a + f.length, 0);
      const validCbc =
        total % 16 === 0 && total >= e.size && total - e.size < 16;
      if (!validCbc) {
        logger.debug(
          {
            name: e.name,
            total,
            size: e.size,
            fragments: e.fragments.length,
          },
          'encrypted entry fragment sum is not a valid CBC ciphertext; cannot stream-decrypt'
        );
        e.crypt = undefined;
      }
    }
  }

  /**
   * Whether `e` is still the open split file. A method (not an inline
   * comparison) on purpose: TS keeps property narrowing across intervening
   * method calls, so `this.pending !== e` after addFile() narrows `e` to
   * `never` despite the mutation.
   */
  private pendingIs(e: ArchiveEntry): boolean {
    return this.pending === e;
  }

  /** Un-narrowed read of the open split file (see {@link pendingIs}). */
  private pendingEntry(): ArchiveEntry | null {
    return this.pending;
  }

  /** Close a split file whose continuation can no longer arrive. */
  private closePendingIncomplete(): void {
    if (this.pending) {
      this.pending.incomplete = true;
      this.pending = null;
    }
  }

  private addFile(file: ParsedFile, fragment: DataFragment): void {
    if (file.isDir) {
      this.pending = null;
      return;
    }
    if (!file.first) {
      if (this.pending && this.pending.name === file.name) {
        // Continuation of a split file from the previous volume.
        this.pending.fragments.push(fragment);
        this.pending.packedSize += fragment.length;
        if (file.last) this.pending = null;
        return;
      }
      // Orphan continuation: its first block sat in a failed/skipped volume.
      // Never link it (the fragment chain has a hole); flag the entry if known.
      const known = this.byName.get(file.name);
      if (known) known.incomplete = true;
      return;
    }
    if (this.pending) {
      // A new first-block while a split file is still open means the open
      // file's continuation never arrived; close it out as incomplete.
      this.pending.incomplete = true;
      this.pending = null;
    }
    const existing = this.byName.get(file.name);
    if (existing) {
      // Re-stored file with the same name: keep the newer header without
      // parsing version records.
      const idx = this.entries.indexOf(existing);
      if (idx >= 0) this.entries.splice(idx, 1);
    }
    const entry: ArchiveEntry = {
      name: file.name,
      size: file.unpSize,
      packedSize: fragment.length,
      isDir: false,
      stored: file.stored,
      solid: file.solid,
      encrypted: file.encrypted,
      // The first block's crypt record drives decryption of the whole (single
      // continuous CBC) file; continuation records repeat the same key/salt.
      crypt: file.encrypted && file.stored ? file.crypt : undefined,
      fragments: [fragment],
    };
    this.entries.push(entry);
    this.byName.set(file.name, entry);
    this.pending = file.last ? null : entry;
  }
}
