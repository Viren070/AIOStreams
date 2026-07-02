import { createLogger } from '../../logging/logger.js';
import { SegmentData } from '../types.js';

const logger = createLogger('usenet/segment-arena');

/**
 * A leased arena slot reserved for one in-flight decode. Never evictable until
 * committed (becomes a resident entry) or abandoned (returns to the free list).
 */
export interface ArenaLease {
  readonly slot: Buffer;
}

/**
 * A pinned view of a cached segment. `data.body` is valid only until
 * {@link SharedSegment.release}; the scalar fields of `data` stay valid after
 * release, so metadata-only callers may release immediately. `owned: true`
 * marks a non-arena fallback body: `release` is a no-op and the body is safe
 * to retain.
 */
export interface SharedSegment {
  readonly data: SegmentData;
  readonly owned: boolean;
  release(): void;
}

export interface ArenaStats {
  /** Allocated slot bytes (free + leased + resident + dropped-pinned). */
  bytes: number;
  /** Free-list slot count. */
  freeSlots: number;
  /** Resident entries. */
  entries: number;
  /** Entries currently pinned (refs > 0). */
  pinned: number;
  hits: number;
  misses: number;
  evictions: number;
  /** checkout() exhaustions (degraded to owned allocation). */
  exhaustions: number;
  /** Entries pinned longer than the leak threshold (should always be 0). */
  longPins: number;
}

interface Entry {
  id: string;
  /** The full allocated slot backing this entry. */
  slot: Buffer;
  /** Decoded body view into `slot` (offset 0, length = data length). */
  body: Buffer;
  meta: Omit<SegmentData, 'body'>;
  refs: number;
  /** Epoch ms when refs went 0 → 1 (leak tripwire). */
  pinnedAt: number;
  /**
   * Set by clear()/replacement while pinned: the entry has left the map, so
   * the last release() retires the slot (budget decrement) instead of
   * freelisting it.
   */
  dropped: boolean;
}

/** A pin outstanding longer than this is assumed leaked (contract violation). */
const LONG_PIN_MS = 60_000;

/** Minimum slot size; typical yEnc articles decode below this. */
const MIN_SLOT_BYTES = 1 << 20;

/**
 * Pinned, recyclable storage for decoded segment bodies: the serve path's
 * shared in-RAM cache tier. Bodies are decoded directly into arena slots and
 * shared via pin/release handles, so the steady-state serve path allocates
 * nothing per segment (V8 charges off-heap Buffer churn as external-memory
 * major GC, which otherwise dominates serve-path CPU).
 *
 * Contract (violations are silent corruption):
 * - a body may be read only between pin and release(), and only
 *   synchronously, never across an `await`;
 * - pins are granted only in synchronous blocks (acquire hit, or the
 *   coordinator's post-commit delivery loop) so no eviction can interleave;
 * - eviction touches only refs === 0 entries; leases are never evictable;
 * - on exhaustion checkout() returns null and the caller degrades to an
 *   owned allocation.
 *
 * `USENET_ARENA_POISON=1` fills evicted/recycled slots with 0xDB so any
 * use-after-release fails byte identity instead of flaking silently.
 */
export class SegmentArena {
  private entries = new Map<string, Entry>(); // insertion order = LRU
  private freeSlots: Buffer[] = [];
  private allocatedBytes = 0;
  private readonly budgetBytes: number;
  private readonly poison =
    process.env.USENET_ARENA_POISON === '1' ||
    process.env.USENET_ARENA_POISON === 'true';

  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private exhaustions = 0;

  constructor(opts: { budgetBytes: number }) {
    this.budgetBytes = Math.max(0, opts.budgetBytes);
  }

  /** Pin a resident entry (LRU touch + refs++). Null on miss. */
  acquire(messageId: string): SharedSegment | null {
    const entry = this.entries.get(messageId);
    if (!entry) {
      this.misses++;
      return null;
    }
    // LRU touch (insertion-ordered Map).
    this.entries.delete(messageId);
    this.entries.set(messageId, entry);
    this.hits++;
    return this.pinEntry(entry);
  }

  /** Whether a body for `messageId` is resident (no pin, no LRU touch). */
  has(messageId: string): boolean {
    return this.entries.has(messageId);
  }

  /**
   * Lease a slot of at least `minBytes` for an in-flight decode. May evict
   * unpinned LRU entries to make room. Returns null on exhaustion (everything
   * pinned/leased); the caller must degrade to an owned allocation.
   */
  checkout(minBytes: number): ArenaLease | null {
    const need = Math.max(MIN_SLOT_BYTES, minBytes);
    if (this.budgetBytes === 0) return null;

    // 1. Free list, dropping undersized slots (sizes settle at the release's
    //    dominant segment size).
    let slot: Buffer | undefined;
    while ((slot = this.freeSlots.pop())) {
      if (slot.length >= need) return { slot };
      this.allocatedBytes -= slot.length;
    }

    // 2. Fresh allocation while under budget.
    if (this.allocatedBytes + need <= this.budgetBytes) {
      this.allocatedBytes += need;
      return { slot: Buffer.allocUnsafe(need) };
    }

    // 3. Evict unpinned LRU entries until one yields a reusable slot or frees
    //    enough budget for a fresh allocation.
    for (const [id, entry] of this.entries) {
      if (entry.refs > 0) continue;
      this.entries.delete(id);
      this.evictions++;
      if (this.poison) entry.slot.fill(0xdb);
      if (entry.slot.length >= need) return { slot: entry.slot };
      this.allocatedBytes -= entry.slot.length; // undersized: drop it
      if (this.allocatedBytes + need <= this.budgetBytes) {
        this.allocatedBytes += need;
        return { slot: Buffer.allocUnsafe(need) };
      }
    }

    // Everything resident is pinned (or budget too small): degrade to owned.
    this.exhaustions++;
    return null;
  }

  /** Return a leased slot unused (fetch failed / decode fell back to owned). */
  abandon(lease: ArenaLease): void {
    if (this.poison) lease.slot.fill(0xdb);
    this.freeSlots.push(lease.slot);
  }

  /**
   * Register a fetched segment whose body occupies `lease.slot[0..len)`. The
   * entry is born with refs = 0; the caller must grant pins to its waiters in
   * the same synchronous block, before any checkout can evict.
   */
  commit(lease: ArenaLease, messageId: string, data: SegmentData): void {
    const existing = this.entries.get(messageId);
    if (existing) {
      // Shouldn't happen under single-flight; keep the newer body.
      this.entries.delete(messageId);
      if (existing.refs === 0) this.freeSlots.push(existing.slot);
      else existing.dropped = true;
    }
    const { body, ...meta } = data;
    this.entries.set(messageId, {
      id: messageId,
      slot: lease.slot,
      body,
      meta,
      refs: 0,
      pinnedAt: 0,
      dropped: false,
    });
  }

  stats(): ArenaStats {
    let pinned = 0;
    let longPins = 0;
    const now = Date.now();
    for (const e of this.entries.values()) {
      if (e.refs > 0) {
        pinned++;
        if (now - e.pinnedAt > LONG_PIN_MS) longPins++;
      }
    }
    return {
      bytes: this.allocatedBytes,
      freeSlots: this.freeSlots.length,
      entries: this.entries.size,
      pinned,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      exhaustions: this.exhaustions,
      longPins,
    };
  }

  /**
   * Drop everything. Unpinned entries + the free list are retired
   * immediately; pinned entries are flagged `dropped` so their final
   * release() retires the slot instead of freelisting it.
   */
  clear(): void {
    for (const entry of this.entries.values()) {
      if (entry.refs === 0) {
        if (this.poison) entry.slot.fill(0xdb);
        this.allocatedBytes -= entry.slot.length;
      } else {
        entry.dropped = true;
      }
    }
    this.entries.clear();
    for (const slot of this.freeSlots) this.allocatedBytes -= slot.length;
    this.freeSlots = [];
  }

  private pinEntry(entry: Entry): SharedSegment {
    if (entry.refs === 0) entry.pinnedAt = Date.now();
    entry.refs++;
    let released = false;
    const arena = this;
    return {
      data: { ...entry.meta, body: entry.body },
      owned: false,
      release(): void {
        if (released) {
          logger.debug(
            { messageId: entry.id },
            'segment arena handle double-release (ignored)'
          );
          return;
        }
        released = true;
        entry.refs--;
        if (entry.refs === 0 && entry.dropped) {
          if (arena.poison) entry.slot.fill(0xdb);
          arena.allocatedBytes -= entry.slot.length;
        }
      },
    };
  }

  /**
   * Pin delivery for the coordinator: identical to {@link acquire} but throws
   * on a miss. Called in the same synchronous block as {@link commit}, where
   * the entry cannot have been evicted.
   */
  acquireCommitted(messageId: string): SharedSegment {
    const h = this.acquire(messageId);
    if (!h) {
      throw new Error(
        `segment arena: entry vanished between commit and delivery (${messageId})`
      );
    }
    return h;
  }
}

/** An owned (non-arena) SharedSegment: release is a no-op. */
export function ownedShared(data: SegmentData): SharedSegment {
  return { data, owned: true, release: NOOP };
}

const NOOP = (): void => {};
