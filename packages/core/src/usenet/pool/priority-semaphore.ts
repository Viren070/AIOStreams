import { CommandPriority } from '../types.js';

interface QueuedWaiter {
  priority: CommandPriority;
  seq: number;
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/**
 * A counting semaphore whose waiters are served by priority (lower enum value
 * first → High before Low), FIFO within a priority. Used as the global download
 * budget (gates BODY/ARTICLE).
 *
 * High-priority playback is strongly favoured but does NOT strictly starve
 * Low-priority background work (health checks / inspect / seek probes): when both
 * classes are waiting, `highShare` of contended grants go to High and the rest to
 * Low, chosen by a deterministic rolling accumulator. `highShare = 1` restores
 * strict priority. With only one class waiting, the share is irrelevant;
 * the head is served.
 *
 * The ceiling is dynamic: {@link throttleTo} temporarily lowers the effective
 * limit (down to ≥1) and {@link restore} returns it to the hard `max`. The
 * per-provider connection pool uses this to back off when a provider reports its
 * account connection limit ("too many connections"): new acquires queue instead
 * of dialing past the ceiling, without ever exceeding the configured maximum.
 */
export class PrioritySemaphore {
  /** Hard ceiling (configured maximum); `limit` never exceeds this. */
  private readonly max: number;
  /** Current effective ceiling (≤ max); lowered while throttled. */
  private limit: number;
  /** Permits currently leased out. */
  private inUseCount = 0;
  private waiters: QueuedWaiter[] = [];
  private seq = 0;
  /** Per-100 odds a contended grant goes to Low (0 = strict priority). */
  private readonly lowOdds: number;
  /** Accumulator driving the deterministic High/Low pick. */
  private lowAcc = 0;

  /**
   * @param permits   hard capacity.
   * @param highShare share (0..1) of contended grants reserved for High; `1`
   *                  (default) = strict priority, never serve Low while High waits.
   */
  constructor(permits: number, highShare = 1) {
    this.max = permits;
    this.limit = permits;
    const clamped = Math.min(1, Math.max(0, highShare));
    this.lowOdds = Math.round((1 - clamped) * 100);
  }

  get inUse(): number {
    return this.inUseCount;
  }

  /** The hard ceiling (configured maximum), unaffected by throttling. */
  get capacity(): number {
    return this.max;
  }

  /** The current effective ceiling (≤ {@link capacity} while throttled). */
  get effectiveLimit(): number {
    return this.limit;
  }

  get waiting(): number {
    return this.waiters.length;
  }

  /**
   * Acquire one permit. Resolves with a release function. The returned release
   * is idempotent. Rejects if the (optional) signal aborts before acquisition.
   */
  acquire(
    priority: CommandPriority = CommandPriority.High,
    signal?: AbortSignal
  ): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(new Error('aborted'));
    }
    if (this.inUseCount < this.limit) {
      this.inUseCount++;
      return Promise.resolve(this.makeRelease());
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: QueuedWaiter = {
        priority,
        seq: this.seq++,
        resolve: (release) => resolve(release),
        reject,
        signal,
      };
      if (signal) {
        waiter.onAbort = () => {
          const idx = this.waiters.indexOf(waiter);
          if (idx !== -1) this.waiters.splice(idx, 1);
          reject(new Error('aborted'));
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      // Insert preserving priority then FIFO order.
      const insertAt = this.waiters.findIndex(
        (w) =>
          w.priority > priority ||
          (w.priority === priority && w.seq > waiter.seq)
      );
      if (insertAt === -1) this.waiters.push(waiter);
      else this.waiters.splice(insertAt, 0, waiter);
    });
  }

  /**
   * Set the effective ceiling to `n` (clamped to [1, max]). Lowering never
   * preempts in-flight permits; it just stops new grants until releases bring
   * `inUse` back under it. Raising immediately wakes queued waiters up to the new
   * limit, so it doubles as the recovery/step-up primitive.
   */
  throttleTo(n: number): void {
    const next = Math.max(1, Math.min(this.max, Math.floor(n)));
    if (next === this.limit) return;
    this.limit = next;
    // Grant any freed headroom to queued waiters (share-weighted High/Low).
    while (this.inUseCount < this.limit && this.waiters.length > 0) {
      this.grantNext();
    }
  }

  /** Restore the effective ceiling to the hard maximum and wake any waiters. */
  restore(): void {
    this.throttleTo(this.max);
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  private release(): void {
    this.inUseCount--;
    // Hand the freed permit to the next waiter, but only while we're within the
    // (possibly throttled) limit, so a lowered ceiling actually holds.
    if (this.inUseCount < this.limit && this.waiters.length > 0) {
      this.grantNext();
    }
  }

  /** Grant one permit to a waiter chosen by the High/Low share, then resolve it. */
  private grantNext(): void {
    const idx = this.pickWaiterIndex();
    if (idx < 0) return;
    const w = this.waiters.splice(idx, 1)[0];
    if (w.signal && w.onAbort) {
      w.signal.removeEventListener('abort', w.onAbort);
    }
    this.inUseCount++;
    w.resolve(this.makeRelease());
  }

  /**
   * Index of the waiter to serve. Waiters are kept sorted High-first then FIFO,
   * so the head is High when any High waits. When BOTH classes wait, the
   * accumulator diverts `1 - highShare` of grants to the first Low waiter so
   * background work makes progress instead of starving; otherwise the head wins.
   */
  private pickWaiterIndex(): number {
    if (this.waiters.length === 0) return -1;
    if (this.lowOdds <= 0) return 0; // strict priority
    if (this.waiters[0].priority !== CommandPriority.High) return 0; // only Low waits
    const firstLow = this.waiters.findIndex(
      (w) => w.priority === CommandPriority.Low
    );
    if (firstLow === -1) return 0; // only High waits
    this.lowAcc += this.lowOdds;
    if (this.lowAcc >= 100) {
      this.lowAcc -= 100;
      return firstLow;
    }
    return 0;
  }
}
