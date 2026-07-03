import { SegmentCache } from './segment-cache.js';
import { PrioritySemaphore } from './priority-semaphore.js';
import { StatsAccumulator } from '../stats/accumulator.js';
import {
  SegmentArena,
  SharedSegment,
  ArenaLease,
  ownedShared,
} from './segment-arena.js';
import {
  SegmentFetcher,
  SegmentHeadData,
  StatDetail,
  LocalSegmentFetcher,
  awaitAbortable,
} from '../nntp/segment-fetcher.js';
import { NntpError } from '../nntp/errors.js';
import {
  CommandPriority,
  EngineOptions,
  NzbSegmentRef,
  PoolInfo,
  ProviderConfig,
  SegmentData,
} from '../types.js';

export type { SegmentHeadData } from '../nntp/segment-fetcher.js';
export type { SharedSegment } from './segment-arena.js';

/** One registered waiter of a shared single-flight fetch. */
interface SharedWaiter {
  deliver(h: SharedSegment): void;
  fail(err: unknown): void;
}

/** A shared fetch in flight; aborting waiters deregister themselves. */
interface SharedFlight {
  waiters: Set<SharedWaiter>;
}

/**
 * Coordinates segment fetches: owns the segment cache, single-flight de-dupe and
 * the global (prioritised) download budget, and delegates the actual
 * connection-owning work (provider failover + yEnc decode) to a
 * {@link SegmentFetcher} (the in-process {@link LocalSegmentFetcher}).
 */
export class MultiProviderPool {
  private fetcher: SegmentFetcher;
  private globalDownloads: PrioritySemaphore;
  /** Single-flight coordinator for shared (arena-backed) segment fetches. */
  private sharedInflight = new Map<string, SharedFlight>();
  /**
   * Single-flight for head-only probe fetches. Fill/repost NZBs list the SAME
   * articles under multiple `<file>` entries, and head fetches don't populate
   * the segment cache; without this, every duplicate probe re-downloads the
   * article.
   */
  private inflightHeads = new Map<string, Promise<SegmentHeadData>>();

  /** The pinned decoded-body tier (owned by the segment cache). */
  private get arena(): SegmentArena {
    return this.cache.arena;
  }

  constructor(
    providers: ProviderConfig[],
    opts: EngineOptions,
    private cache: SegmentCache,
    stats: StatsAccumulator
  ) {
    // The fetcher owns the connection pools + failover + decode; the engine's
    // StatsAccumulator is its (in-process) stats sink.
    this.fetcher = new LocalSegmentFetcher(providers, opts, stats);

    // The global download budget is a HARD ceiling on concurrent in-flight
    // BODY/ARTICLE downloads. It is auto-sized (in buildUsenetEngineOptions) to
    // Σ maxConnections × depth so the default never throttles pipelining; an
    // explicit `maxConcurrentDownloads` lower than that is honoured as a real
    // cap (the per-provider connection pools still bound sockets per account).
    // The per-stream priority reservation rides on this semaphore.
    this.globalDownloads = new PrioritySemaphore(
      Math.max(1, opts.maxConcurrentDownloads),
      opts.streamingPriority
    );
  }

  /**
   * Fetch + decode one segment, trying providers in priority/availability order
   * with per-segment 430 failover and backup escalation. Throws
   * `ArticleNotFoundError` when every provider reports the article missing, or
   * the last transient `NntpError` when all attempts failed transiently.
   *
   * Thin wrapper over {@link fetchSegmentShared}: the returned body is always
   * owned, so callers may retain it freely.
   */
  async fetchSegment(
    segment: NzbSegmentRef,
    nzbHash: string,
    signal: AbortSignal | undefined,
    priority: CommandPriority = CommandPriority.High
  ): Promise<SegmentData> {
    const h = await this.fetchSegmentShared(segment, nzbHash, signal, priority);
    try {
      return h.owned ? h.data : { ...h.data, body: Buffer.from(h.data.body) };
    } finally {
      h.release();
    }
  }

  /**
   * Fetch + decode one segment as a pinned view into the shared segment arena
   * ({@link SegmentArena} documents the pin/release contract). Single-flighted:
   * concurrent callers of the same message-id share one fetch, each receiving
   * its own pin.
   */
  fetchSegmentShared(
    segment: NzbSegmentRef,
    nzbHash: string,
    signal: AbortSignal | undefined,
    priority: CommandPriority = CommandPriority.High
  ): Promise<SharedSegment> {
    const id = segment.messageId;
    const hit = this.arena.acquire(id);
    if (hit) return Promise.resolve(hit);
    if (signal?.aborted) {
      return Promise.reject(new NntpError('connection', 'aborted'));
    }

    let flight = this.sharedInflight.get(id);
    const isNew = !flight;
    if (!flight) {
      flight = { waiters: new Set() };
      this.sharedInflight.set(id, flight);
    }
    const joined = flight;
    const p = new Promise<SharedSegment>((resolve, reject) => {
      // An aborting waiter deregisters itself before delivery, so pins are
      // granted only to waiters that will consume them. The fetch itself runs
      // without any caller's signal (bounded by segmentTimeoutMs) so one
      // abandoning caller cannot poison the flight for the others.
      let onAbort: (() => void) | undefined;
      const done = (): void => {
        if (onAbort) signal!.removeEventListener('abort', onAbort);
      };
      const waiter: SharedWaiter = {
        deliver: (h) => {
          done();
          resolve(h);
        },
        fail: (e) => {
          done();
          reject(e);
        },
      };
      joined.waiters.add(waiter);
      if (signal) {
        onAbort = () => {
          joined.waiters.delete(waiter);
          reject(new NntpError('connection', 'aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
    if (isNew) void this.runShared(segment, nzbHash, priority, joined);
    return p;
  }

  /** The single flight behind {@link fetchSegmentShared}. */
  private async runShared(
    segment: NzbSegmentRef,
    nzbHash: string,
    priority: CommandPriority,
    flight: SharedFlight
  ): Promise<void> {
    const id = segment.messageId;
    let lease: ArenaLease | null | undefined;
    try {
      let data = await this.cache.getAsync(id);
      if (data) {
        // Disk hit: promote into the arena (one memcpy) when a slot is free,
        // so serve-path re-touches stop paying the disk round-trip.
        lease = this.arena.checkout(data.body.length);
        if (lease) {
          data.body.copy(lease.slot, 0);
          data = { ...data, body: lease.slot.subarray(0, data.body.length) };
        }
      } else {
        const need = Math.max(1 << 20, segment.bytes ?? 0);
        data = await this.runFetch(
          segment,
          nzbHash,
          priority,
          () =>
            (lease ??= this.arena.checkout(need))?.slot ??
            Buffer.allocUnsafe(need)
        );
        if (lease && data.body.buffer !== lease.slot.buffer) {
          // Decode fell back to an owned buffer (oversized/undeclared bytes).
          this.arena.abandon(lease);
          lease = null;
        }
      }
      // Deliver in one synchronous block: unregister the flight, commit the
      // slot, and grant one pin per still-registered waiter, so no checkout
      // (hence no eviction) can interleave.
      if (this.sharedInflight.get(id) === flight) {
        this.sharedInflight.delete(id);
      }
      if (lease) {
        this.arena.commit(lease, id, data);
        for (const w of flight.waiters) {
          w.deliver(this.arena.acquireCommitted(id));
        }
      } else {
        const shared = ownedShared(data);
        for (const w of flight.waiters) w.deliver(shared);
      }
    } catch (err) {
      if (lease) this.arena.abandon(lease);
      if (this.sharedInflight.get(id) === flight) {
        this.sharedInflight.delete(id);
      }
      for (const w of flight.waiters) w.fail(err);
    }
  }

  /**
   * Fetch + decode one segment into a caller-owned buffer (a per-stream decode
   * slot). `out` is invoked lazily at decode time: cache hits never check a
   * slot out, and no slot is held while waiting on the download semaphore.
   * Deliberately not single-flighted: the body may be a view into the slot,
   * whose recycle policy belongs to this one caller. Concurrent streams of the
   * same file may duplicate a fetch until the disk tier catches up.
   */
  async fetchSegmentInto(
    segment: NzbSegmentRef,
    nzbHash: string,
    signal: AbortSignal | undefined,
    priority: CommandPriority,
    out: () => Buffer
  ): Promise<SegmentData> {
    // Arena hit: copy into the caller's slot to keep the stream's
    // `body.buffer === slot.buffer` bookkeeping intact; oversized bodies fall
    // back to an owned copy.
    const pinned = this.arena.acquire(segment.messageId);
    if (pinned) {
      try {
        const body = pinned.data.body;
        const dst = out();
        if (dst.length >= body.length) {
          body.copy(dst, 0);
          return { ...pinned.data, body: dst.subarray(0, body.length) };
        }
        return { ...pinned.data, body: Buffer.from(body) };
      } finally {
        pinned.release();
      }
    }
    // Disk hits return owned bodies (fresh deserialize) and ignore `out`.
    const fromDisk = await this.cache.getAsync(segment.messageId);
    if (fromDisk) return fromDisk;
    return awaitAbortable(
      this.runFetch(segment, nzbHash, priority, out),
      signal
    );
  }

  private async runFetch(
    segment: NzbSegmentRef,
    nzbHash: string,
    priority: CommandPriority,
    out?: () => Buffer
  ): Promise<SegmentData> {
    const releaseGlobal = await this.globalDownloads.acquire(
      priority,
      undefined
    );
    try {
      const data = await this.fetcher.fetchBody(
        segment,
        nzbHash,
        priority,
        out
      );
      // Write-through for ALL priorities, including import probes that still take
      // the full path (par2, mid-volume header reads). RAM is protected by the
      // bounded pending-write queue, not by skipping the writes. Slot-backed
      // bodies must skip the mem tier (see SegmentCache.set).
      this.cache.set(segment.messageId, data, { skipMem: out !== undefined });
      return data;
    } finally {
      releaseGlobal();
    }
  }

  /**
   * Head-only probe fetch: stream the article's raw payload, decode just the
   * leading `want` bytes + yEnc header fields, and let the rest drain on the
   * wire; no full-article buffer, no decode of the remainder, no cache write.
   * Same provider failover semantics as {@link fetchSegment}. Single-flighted
   * (fill/repost NZBs probe the same article under multiple files); an
   * already-cached body is reused.
   */
  async fetchSegmentHead(
    segment: NzbSegmentRef,
    nzbHash: string,
    signal: AbortSignal | undefined,
    priority: CommandPriority,
    want: number
  ): Promise<SegmentHeadData> {
    const fromHit = (d: SegmentData): SegmentHeadData => ({
      head: Buffer.from(d.body.subarray(0, want)),
      byteRange: d.byteRange,
      fileSize: d.fileSize,
      name: d.name,
      size: d.size,
    });
    const pinned = this.arena.acquire(segment.messageId);
    if (pinned) {
      try {
        return fromHit(pinned.data); // head is copied while pinned
      } finally {
        pinned.release();
      }
    }

    let shared = this.inflightHeads.get(segment.messageId);
    if (!shared) {
      const promise = (async (): Promise<SegmentHeadData> => {
        const fromDisk = await this.cache.getAsync(segment.messageId);
        if (fromDisk) return fromHit(fromDisk);
        const releaseGlobal = await this.globalDownloads.acquire(
          priority,
          undefined
        );
        try {
          return await this.fetcher.fetchHead(segment, nzbHash, priority, want);
        } finally {
          releaseGlobal();
        }
      })();
      shared = promise;
      this.inflightHeads.set(segment.messageId, promise);
      void promise
        .catch(() => undefined)
        .finally(() => {
          if (this.inflightHeads.get(segment.messageId) === promise) {
            this.inflightHeads.delete(segment.messageId);
          }
        });
    }
    return awaitAbortable(shared, signal);
  }

  /**
   * Cheap existence probe (STAT) across providers, used by health checks /
   * inspect. Does NOT consume the global download budget. Returns true if any
   * provider has the article.
   */
  async statSegment(
    messageId: string,
    signal: AbortSignal | undefined,
    nzbHash?: string
  ): Promise<boolean> {
    if (this.arena.has(messageId)) return true;
    return this.fetcher.statSegment(
      messageId,
      nzbHash,
      CommandPriority.Low,
      signal
    );
  }

  /**
   * STAT probe that reports WHICH provider answered and can restrict the
   * candidate set (census evidence with per-provider STAT trust). An arena hit
   * is authoritative present with no `answeredBy` (no provider was asked, so
   * trust calibration must ignore it).
   */
  async statSegmentDetailed(
    messageId: string,
    signal: AbortSignal | undefined,
    nzbHash?: string,
    providerIds?: readonly string[]
  ): Promise<StatDetail> {
    if (this.arena.has(messageId)) return { present: true, answered: true };
    return this.fetcher.statSegmentDetailed(
      messageId,
      nzbHash,
      CommandPriority.Low,
      signal,
      providerIds
    );
  }

  /**
   * BODY probe on exactly one provider (STAT-trust calibration): transfer
   * discarded, no failover, no cache. Takes a Low-priority download slot so a
   * calibration burst can never oversubscribe the account's sockets.
   */
  async probeBodyOnProvider(
    segment: NzbSegmentRef,
    providerId: string,
    signal?: AbortSignal
  ): Promise<'ok' | 'not_found' | 'unreachable'> {
    const releaseGlobal = await this.globalDownloads.acquire(
      CommandPriority.Low,
      signal
    );
    try {
      return await this.fetcher.probeBodyOnProvider(
        segment,
        providerId,
        signal
      );
    } finally {
      releaseGlobal();
    }
  }

  /** Configured provider ids, in priority order. */
  providerIds(): string[] {
    return this.fetcher.providerIds();
  }

  /** Download slots currently leased (in-flight article fetches). */
  get downloadsInUse(): number {
    return this.globalDownloads.inUse;
  }

  poolInfo(): PoolInfo {
    return {
      providers: this.fetcher.info(),
      globalDownloadsInUse: this.globalDownloads.inUse,
      globalDownloadMax: this.globalDownloads.capacity,
    };
  }

  purgeStaleIdles(): void {
    this.fetcher.purgeStaleIdles();
  }

  close(): void {
    this.fetcher.close();
  }
}
