import pLimit from 'p-limit';
import { createLogger } from '../../../logging/logger.js';
import { RandomAccess } from './random-access.js';
import { DataFragment } from './types.js';
import { walkVolume } from './rar/index.js';
import { NotStreamableError } from './errors.js';

const logger = createLogger('usenet/lazy');

/** Fallback resolve parallelism when the caller doesn't thread one through. */
const DEFAULT_RESOLVE_CONCURRENCY = 8;

export interface LazyResolveHooks {
  /**
   * A resolution batch committed; `fragments` is the NEW immutable table.
   * Used to patch the persisted layout so later opens skip the resolve.
   */
  onCommit?: (fragments: DataFragment[]) => void;
  /**
   * Resolution proved the layout structurally wrong (continuation header
   * missing/mismatched): the caller should invalidate the persisted layout
   * so the next open takes the full-parse path. Fired at most once.
   */
  onInvalid?: (err: Error) => void;
}

/**
 * Resolves the PENDING fragments of a lazily-parsed split RAR file on demand.
 *
 * A pending fragment is a middle volume whose continuation header was never
 * read at import: its offset/length are capacity estimates whose per-file sum
 * is forced exact. This resolver reads the volume's header (≈1 segment via the
 * shared {@link walkVolume} path) on first touch, replaces the estimate with
 * the exact fragment, and rebalances the remaining estimate error onto the
 * last still-pending fragment so the file's total size never drifts.
 *
 * Correctness contract (the reason estimates are safe): bytes are only ever
 * served from the EXACT prefix: {@link resolveThrough} resolves every pending
 * fragment overlapping `[0, endOffset)` before the read proceeds, so logical
 * offsets within the served range always map through exact lengths. Estimates
 * only steer which volumes a resolve must cover.
 *
 * Concurrency: volumes resolve in parallel (bounded), per-volume single-flight;
 * commits are synchronous table swaps (in-flight readers hold the old array,
 * whose exact entries are unchanged and whose estimates are never read from).
 */
export class LazyFragmentResolver {
  private table: DataFragment[];
  /** Exact fragments resolved but possibly not yet committed, by volume. */
  private resolvedByVolume = new Map<number, DataFragment>();
  private inflight = new Map<number, Promise<void>>();
  private readonly limit: ReturnType<typeof pLimit>;
  /** Set on structural mismatch; all further resolution throws this. */
  private invalid?: Error;

  constructor(
    private readonly source: RandomAccess,
    private readonly ranges: Array<{ start: number; end: number }>,
    private readonly target: { name: string; size: number },
    fragments: DataFragment[],
    private readonly opts: {
      concurrency?: number;
      hooks?: LazyResolveHooks;
    } = {}
  ) {
    this.table = fragments.slice();
    this.limit = pLimit(
      Math.max(1, opts.concurrency ?? DEFAULT_RESOLVE_CONCURRENCY)
    );
  }

  /** Current immutable fragment table (exact prefix + estimated pendings). */
  fragments(): DataFragment[] {
    return this.table;
  }

  hasPending(): boolean {
    return this.table.some((f) => f.pending !== undefined);
  }

  /**
   * Resolve every pending fragment overlapping logical `[0, endOffset)` and
   * return the updated table. All needed volumes resolve in PARALLEL: a
   * player's open-time end-of-file metadata read otherwise serializes one
   * volume per round-trip. Loops because a commit shifts estimated boundaries
   * slightly; terminates since every iteration resolves ≥1 new volume.
   */
  async resolveThrough(endOffset: number): Promise<DataFragment[]> {
    for (;;) {
      if (this.invalid) throw this.invalid;
      const volumes: number[] = [];
      let logical = 0;
      for (const f of this.table) {
        if (logical >= endOffset) break;
        if (f.pending !== undefined) volumes.push(f.pending);
        logical += f.length;
      }
      if (volumes.length === 0) return this.table;
      await Promise.all(volumes.map((v) => this.resolveVolume(v)));
      this.commit();
    }
  }

  /**
   * Fire-and-forget: pre-resolve the next `count` pending volumes past
   * `endOffset` so sequential playback never blocks at a volume crossing.
   * Errors are swallowed; the first blocking touch surfaces them.
   */
  resolveAhead(endOffset: number, count = 1): void {
    if (this.invalid || count <= 0) return;
    const volumes: number[] = [];
    let logical = 0;
    for (const f of this.table) {
      if (f.pending !== undefined && logical + f.length > endOffset) {
        volumes.push(f.pending);
        if (volumes.length >= count) break;
      }
      logical += f.length;
    }
    for (const v of volumes) {
      this.resolveVolume(v)
        .then(() => this.commit())
        .catch(() => {});
    }
  }

  /** Single-flight exact resolution of one pending volume. */
  private resolveVolume(volume: number): Promise<void> {
    if (this.resolvedByVolume.has(volume)) return Promise.resolve();
    let p = this.inflight.get(volume);
    if (!p) {
      p = this.limit(() => this.doResolve(volume)).then(
        (frag) => {
          this.resolvedByVolume.set(volume, frag);
          this.inflight.delete(volume);
        },
        (err) => {
          // Transient errors (article gone, transport) drop out of the map so
          // a later touch retries; structural errors poisoned us already.
          this.inflight.delete(volume);
          throw err;
        }
      );
      this.inflight.set(volume, p);
    }
    return p;
  }

  /**
   * Read the volume's continuation header and return the exact data fragment.
   * Transport errors (incl. ArticleNotFound) propagate as-is; the pending
   * fragment survives and is retried on the next touch/open. Structural
   * mismatches poison the resolver (the layout itself is wrong).
   */
  private async doResolve(volume: number): Promise<DataFragment> {
    const range = this.ranges[volume];
    if (!range) {
      throw this.poison(
        new NotStreamableError(
          'archive_incomplete',
          `lazy resolve: no volume range for pending volume ${volume}`
        )
      );
    }
    const startedAt = Date.now();
    // No password by invariant: encrypted sets never produce pending fragments
    // (the lazy parse bails for header-encrypted AND data-encrypted entries),
    // so a resolvable middle volume always has plaintext headers.
    const vp = await walkVolume(this.source, { range, perVolume: true });
    if (vp.error) {
      // The bytes were read but carry no RAR marker: structural, not transient.
      throw this.poison(
        new NotStreamableError(
          'archive_incomplete',
          `lazy resolve: ${vp.error.message} (volume ${volume})`
        )
      );
    }
    const b = vp.blocks[0];
    // Every pending is a STRICT middle of the target file: its first block
    // must be a continuation (not first), still split-after (not last), of
    // the same name. Anything else means the import's boundary walk and this
    // volume disagree; the layout cannot be trusted.
    if (!b || b.file.first || b.file.last || b.file.name !== this.target.name) {
      throw this.poison(
        new NotStreamableError(
          'archive_incomplete',
          `lazy resolve: volume ${volume} is not a middle of ${this.target.name}`
        )
      );
    }
    const frag = b.fragment;
    if (
      frag.length <= 0 ||
      frag.offset < range.start ||
      frag.offset + frag.length > range.end
    ) {
      throw this.poison(
        new NotStreamableError(
          'archive_incomplete',
          `lazy resolve: implausible fragment in volume ${volume} (${frag.offset}+${frag.length})`
        )
      );
    }
    logger.trace(
      {
        volume,
        offset: frag.offset,
        length: frag.length,
        latency: Date.now() - startedAt,
      },
      'resolved pending volume'
    );
    return { offset: frag.offset, length: frag.length };
  }

  /**
   * Swap in a new table with every resolved volume's exact fragment, then
   * rebalance the residual estimate error onto the LAST still-pending fragment
   * so the total stays exactly `target.size`. Synchronous; concurrent readers
   * hold either the old or the new immutable array.
   */
  private commit(): void {
    if (this.invalid || this.resolvedByVolume.size === 0) return;
    let changed = false;
    const next: DataFragment[] = this.table.map((f) => {
      if (f.pending === undefined) return f;
      const r = this.resolvedByVolume.get(f.pending);
      if (!r) return f;
      changed = true;
      return { offset: r.offset, length: r.length };
    });
    if (!changed) return;

    let sum = 0;
    let lastPending = -1;
    for (let i = 0; i < next.length; i++) {
      sum += next[i].length;
      if (next[i].pending !== undefined) lastPending = i;
    }
    const diff = this.target.size - sum;
    if (diff !== 0) {
      if (lastPending < 0) {
        // Everything exact yet the sum is off: the headers and the import
        // walk disagree about the file. Never serve from this table.
        this.poison(
          new NotStreamableError(
            'archive_incomplete',
            `lazy resolve: exact fragment sum ${sum} != size ${this.target.size}`
          )
        );
        return;
      }
      const f = next[lastPending];
      const newLength = f.length + diff;
      const range = this.ranges[f.pending!];
      if (newLength <= 0 || (range && newLength > range.end - range.start)) {
        this.poison(
          new NotStreamableError(
            'archive_incomplete',
            `lazy resolve: rebalanced estimate implausible (${newLength})`
          )
        );
        return;
      }
      next[lastPending] = { ...f, length: newLength };
    }

    // Committed volumes never get re-consulted (no longer pending in the table).
    for (const [v] of this.resolvedByVolume) {
      if (!next.some((f) => f.pending === v)) this.resolvedByVolume.delete(v);
    }

    this.table = next;
    const remaining = next.filter((f) => f.pending !== undefined).length;
    logger.debug(
      { name: this.target.name, fragments: next.length, pending: remaining },
      'committed resolved fragments'
    );
    try {
      this.opts.hooks?.onCommit?.(next);
    } catch {
      // Persistence hooks must never break serving.
    }
  }

  /** Mark the resolver permanently invalid (first error wins) and return it. */
  private poison(err: Error): Error {
    if (!this.invalid) {
      this.invalid = err;
      logger.warn(
        { name: this.target.name, err: err.message },
        'lazy layout invalidated'
      );
      try {
        this.opts.hooks?.onInvalid?.(err);
      } catch {
        // Hook failures must not mask the original error.
      }
    }
    return this.invalid;
  }
}
