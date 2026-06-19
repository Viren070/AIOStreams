import { createLogger } from '../../logging/logger.js';
import {
  ProviderWorkerPool,
  WorkerPoolOptions,
} from '../nntp/provider-worker-pool.js';
import { NntpConnection } from '../nntp/connection.js';
import {
  ArticleNotFoundError,
  NntpError,
  isTransientNntpError,
} from '../nntp/errors.js';
import { decodeArticle, YencDecodeError, YencHeadCapture } from './yenc.js';
import { SegmentCache } from './segment-cache.js';
import { PrioritySemaphore } from './priority-semaphore.js';
import { StatsAccumulator } from '../stats/accumulator.js';
import {
  CommandPriority,
  EngineOptions,
  NzbSegmentRef,
  PoolInfo,
  ProviderConfig,
  SegmentData,
} from '../types.js';

const logger = createLogger('usenet/multi-pool');

/** Shared empty exclusion set for full-order candidate listing. */
const EMPTY_EXCLUDE = new Set<string>();

/** Sliding lifetime of a per-NZB provider-affinity entry. */
const AFFINITY_TTL_MS = 30 * 60_000;
/** Max NZBs tracked (insertion-order eviction). */
const AFFINITY_MAX_HASHES = 512;

/**
 * Per-NZB provider-order hint. A provider that 430s articles of one release
 * while another serves them gets demoted FOR THAT RELEASE ONLY; the global
 * provider order (priority/tier/health) is untouched, so a backup or
 * lower-priority provider that happens to carry one NZB doesn't get promoted
 * for everything else (metered block accounts must not drain globally).
 *
 * Affinity is an ORDERING hint, never an exclusion: every fetch still falls
 * through the full provider list, so "missing on all providers" semantics and
 * transient-outage failover are unchanged. Without it, every segment of a
 * release missing on the first-tried provider pays a wasted 430 round-trip.
 */
class ProviderAffinity {
  private byHash = new Map<
    string,
    { at: number; outcomes: Map<string, 'served' | 'missing'> }
  >();

  record(
    hash: string,
    providerId: string,
    outcome: 'served' | 'missing'
  ): void {
    const now = Date.now();
    let entry = this.byHash.get(hash);
    if (entry && now - entry.at > AFFINITY_TTL_MS) {
      this.byHash.delete(hash);
      entry = undefined;
    }
    if (!entry) {
      entry = { at: now, outcomes: new Map() };
    } else {
      this.byHash.delete(hash); // refresh insertion order (LRU)
    }
    entry.at = now;
    if (outcome === 'missing' && entry.outcomes.get(providerId) !== 'missing') {
      logger.debug(
        { nzbHash: hash, providerId },
        'provider demoted for this nzb (article missing)'
      );
    }
    entry.outcomes.set(providerId, outcome);
    this.byHash.set(hash, entry);
    if (this.byHash.size > AFFINITY_MAX_HASHES) {
      const oldest = this.byHash.keys().next().value;
      if (oldest !== undefined) this.byHash.delete(oldest);
    }
  }

  /** 0 = known to serve this nzb, 1 = unknown, 2 = known to be missing it. */
  classOf(hash: string, providerId: string): 0 | 1 | 2 {
    const entry = this.byHash.get(hash);
    if (!entry || Date.now() - entry.at > AFFINITY_TTL_MS) return 1;
    const o = entry.outcomes.get(providerId);
    return o === 'served' ? 0 : o === 'missing' ? 2 : 1;
  }
}

/**
 * Result of a head-only probe fetch: the decoded leading bytes plus the yEnc
 * header fields (everything inspection needs), WITHOUT materialising,
 * decoding or caching the full article (its remaining bytes drain on the
 * wire). `size` is the part's decoded length when derivable.
 */
export interface SegmentHeadData {
  head: Buffer;
  byteRange?: [number, number];
  fileSize?: number;
  name?: string;
  size?: number;
}

/**
 * Coordinates all provider pools to fetch a single segment with per-segment
 * failover, a global (prioritised) download budget, single-flight de-dupe and
 * caching, plus connection budgeting and provider ordering.
 */
export class MultiProviderPool {
  private pools: ProviderWorkerPool[];
  private globalDownloads: PrioritySemaphore;
  private inflight = new Map<string, Promise<SegmentData>>();
  /**
   * Single-flight for head-only probe fetches. Fill/repost NZBs list the SAME
   * articles under multiple `<file>` entries, and head fetches don't populate
   * the segment cache; without this, every duplicate probe re-downloads the
   * article.
   */
  private inflightHeads = new Map<string, Promise<SegmentHeadData>>();
  /** Per-NZB provider-order hints (only consulted with >1 provider). */
  private affinity = new ProviderAffinity();

  constructor(
    providers: ProviderConfig[],
    private opts: EngineOptions,
    private cache: SegmentCache,
    private stats: StatsAccumulator
  ) {
    const depthOf = (p: ProviderConfig): number =>
      Math.max(1, p.pipelineDepth ?? 1);
    this.pools = providers
      .filter((p) => p.enabled !== false)
      .map((p) => {
        const poolOpts: WorkerPoolOptions = {
          dialTimeoutMs: opts.dialTimeoutMs,
          idleConnectionMs: opts.idleConnectionMs,
          circuitBreakerThreshold: opts.circuitBreakerThreshold,
          circuitBreakerCooldownMs: opts.circuitBreakerCooldownMs,
          pipelineDepth: depthOf(p),
          streamingPriority: opts.streamingPriority,
        };
        return new ProviderWorkerPool(p, poolOpts);
      });
    // The global download budget admits up to the total PIPELINE-slot count
    // (Σ maxConnections × depth) so pipelining isn't capped by it; the per-stream
    // priority reservation still rides on this semaphore.
    const totalPipelineSlots = providers
      .filter((p) => p.enabled !== false)
      .reduce((n, p) => n + Math.max(1, p.maxConnections) * depthOf(p), 0);
    this.globalDownloads = new PrioritySemaphore(
      Math.max(1, opts.maxDownloadConnections, totalPipelineSlots),
      opts.streamingPriority
    );
  }

  /**
   * Fetch + decode one segment, trying providers in priority/availability order
   * with per-segment 430 failover and backup escalation. Throws
   * {@link ArticleNotFoundError} when every provider reports the article
   * missing, or the last transient {@link NntpError} when all attempts failed
   * transiently.
   */
  async fetchSegment(
    segment: NzbSegmentRef,
    groups: string[],
    nzbHash: string,
    signal: AbortSignal | undefined,
    priority: CommandPriority = CommandPriority.High
  ): Promise<SegmentData> {
    const cached = this.cache.get(segment.messageId);
    if (cached) return cached;

    let shared = this.inflight.get(segment.messageId);
    if (!shared) {
      // The shared single-flight fetch deliberately runs WITHOUT any caller's
      // signal: it is bounded only by `segmentTimeoutMs` and always runs to
      // completion (caching its result). A single caller abandoning its wait
      // (e.g. a teardown aborting prefetched-but-unneeded segments) must never
      // poison the fetch for other callers single-flighting the same segment.
      const promise = this.diskThenFetch(
        segment,
        groups,
        nzbHash,
        undefined,
        priority
      );
      shared = promise;
      this.inflight.set(segment.messageId, promise);
      // Only clear the map entry if it still points at this promise (a later
      // miss may have already replaced it).
      void promise
        .catch(() => undefined)
        .finally(() => {
          if (this.inflight.get(segment.messageId) === promise) {
            this.inflight.delete(segment.messageId);
          }
        });
    }
    return this.awaitAbortable(shared, signal);
  }

  /**
   * Await a shared segment fetch on behalf of one caller, allowing that caller
   * to abandon its wait via its own `signal` (rejecting with `aborted`) without
   * affecting the shared fetch or any other waiter.
   */
  private awaitAbortable<T>(
    shared: Promise<T>,
    signal: AbortSignal | undefined
  ): Promise<T> {
    if (!signal) return shared;
    if (signal.aborted) {
      return Promise.reject(new NntpError('connection', 'aborted'));
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void =>
        reject(new NntpError('connection', 'aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
      shared.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        }
      );
    });
  }

  /**
   * On a sync (L1) cache miss, consult the disk tier before paying for a
   * network fetch. Runs inside the single-flight dedupe so concurrent misses
   * for the same segment share one disk read.
   */
  private async diskThenFetch(
    segment: NzbSegmentRef,
    groups: string[],
    nzbHash: string,
    signal: AbortSignal | undefined,
    priority: CommandPriority
  ): Promise<SegmentData> {
    const fromDisk = await this.cache.getAsync(segment.messageId);
    if (fromDisk) return fromDisk;
    return this.doFetch(segment, groups, nzbHash, signal, priority);
  }

  private async doFetch(
    segment: NzbSegmentRef,
    groups: string[],
    nzbHash: string,
    signal: AbortSignal | undefined,
    priority: CommandPriority
  ): Promise<SegmentData> {
    const releaseGlobal = await this.globalDownloads.acquire(priority, signal);
    try {
      return await this.submitWithFailover<SegmentData>(
        segment,
        groups,
        nzbHash,
        priority,
        async (conn) => {
          const raw = await conn.body(
            segment.messageId,
            undefined,
            this.opts.segmentTimeoutMs
          );
          const decoded = decodeArticle(raw);
          const data: SegmentData = {
            body: decoded.body,
            byteRange: decoded.byteRange,
            fileSize: decoded.fileSize,
            name: decoded.name,
            size: decoded.size,
          };
          // Write-through for ALL priorities, including import probes that
          // still take the full path (par2, mid-volume header reads). RAM is
          // protected by the bounded pending-write queue, not by skipping the
          // writes.
          this.cache.set(segment.messageId, data);
          return { value: data, bytes: data.size };
        }
      );
    } finally {
      releaseGlobal();
    }
  }

  /**
   * Head-only probe fetch: stream the article's raw payload, decode just the
   * leading `want` bytes + yEnc header fields, and let the rest drain on the
   * wire; no full-article buffer, no decode of the remainder, no cache write.
   * Same provider failover semantics as {@link fetchSegment}. No single-flight
   * (probes touch unique segments); an already-cached body is reused.
   */
  async fetchSegmentHead(
    segment: NzbSegmentRef,
    groups: string[],
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
    const cached = this.cache.get(segment.messageId);
    if (cached) return fromHit(cached);

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
          return await this.submitWithFailover<SegmentHeadData>(
            segment,
            groups,
            nzbHash,
            priority,
            async (conn) => {
              const capture = new YencHeadCapture(want);
              const rawBytes = await conn.bodyStreaming(
                segment.messageId,
                (chunk) => capture.push(chunk),
                undefined,
                this.opts.segmentTimeoutMs
              );
              return { value: capture.finish(), bytes: rawBytes };
            }
          );
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
    return this.awaitAbortable(shared, signal);
  }

  /**
   * Submit one fetch to providers in priority/affinity order with per-segment
   * 430 failover and backup escalation. `run` performs the actual transfer +
   * decode on a ready (possibly pipelined) connection chosen by the worker pool.
   * Throws {@link ArticleNotFoundError} only when a provider ACTUALLY answered
   * 430 (and no provider was merely unreachable); otherwise the last
   * transient/unreachable error so a transport/capacity problem never reads as
   * "missing".
   */
  private async submitWithFailover<T>(
    segment: NzbSegmentRef,
    groups: string[],
    nzbHash: string | undefined,
    priority: CommandPriority,
    run: (conn: NntpConnection) => Promise<{ value: T; bytes: number }>
  ): Promise<T> {
    const notFound = new Set<string>();
    let lastTransient: NntpError | null = null;
    // A provider we couldn't even reach/authenticate, distinct from a provider
    // that ANSWERED that the article is missing (430). Tracked so a fetch that
    // touched no answering provider never masquerades as "missing".
    let lastUnreachable: NntpError | null = null;
    let triedAny = false;

    // One ordered candidate list: primaries before backups (the backup tier is
    // reached whenever earlier providers failed to deliver, whether missing or
    // erroring), reordered by per-NZB affinity so a provider known to be
    // missing this release stops being body-tried first on every segment.
    const candidates = this.orderedCandidates(nzbHash);
    let escalationLogged = false;
    for (const pool of candidates) {
      if (
        pool.isBackup &&
        !escalationLogged &&
        (notFound.size > 0 || lastTransient)
      ) {
        escalationLogged = true;
        logger.debug(
          { messageId: segment.messageId, notFoundOn: [...notFound] },
          'escalating segment fetch to backup providers'
        );
      }
      triedAny = true;
      // Wall-clock busy accounting (union of in-flight fetches → honest average
      // throughput, see StatsAccumulator). The worker pool owns latency/miss-rate
      // EWMAs (used for ordering); the stats events here drive the dashboard.
      this.stats.fetchStarted(pool.id);
      try {
        const { value, bytes, durationMs } = await pool.submit<T>({
          groups,
          priority,
          run,
        });
        if (nzbHash) this.affinity.record(nzbHash, pool.id, 'served');
        this.stats.record({
          type: 'segment_fetched',
          providerId: pool.id,
          bytes,
          durationMs,
        });
        logger.trace(
          {
            providerId: pool.id,
            messageId: segment.messageId,
            bytes,
            latency: durationMs,
            useBackup: pool.isBackup,
          },
          'segment fetched'
        );
        return value;
      } catch (err) {
        if (err instanceof NntpError && err.kind === 'article_not_found') {
          notFound.add(pool.id);
          if (nzbHash) this.affinity.record(nzbHash, pool.id, 'missing');
          this.stats.record({ type: 'segment_missing', providerId: pool.id });
          logger.debug(
            { providerId: pool.id, messageId: segment.messageId },
            'segment missing on provider'
          );
          continue;
        }
        if (err instanceof YencDecodeError) {
          // The article was read off the wire; the content is undecodable but
          // the connection is healthy. Surface it (don't fail over as missing).
          throw err;
        }
        if (
          err instanceof NntpError &&
          (err.kind === 'auth_failed' || err.kind === 'no_providers')
        ) {
          lastUnreachable = err;
          continue;
        }
        if (isTransientNntpError(err)) {
          lastTransient = err as NntpError;
          this.stats.record({ type: 'connection_error', providerId: pool.id });
          continue;
        }
        throw err;
      } finally {
        this.stats.fetchEnded(pool.id);
      }
    }

    if (!triedAny) {
      throw new NntpError('no_providers', 'no usable providers available');
    }
    if (notFound.size === 0) {
      // No provider actually reported the article missing (430). The fetch failed
      // because providers were unreachable/at-capacity/transient: surface THAT,
      // never a false ArticleNotFoundError (which the import layer treats as
      // "incomplete or removed" and persists as dead).
      throw (
        lastTransient ??
        lastUnreachable ??
        new NntpError('no_providers', 'no usable providers available')
      );
    }
    logger.debug(
      { messageId: segment.messageId, notFoundOn: [...notFound] },
      'article not found on any provider'
    );
    throw new ArticleNotFoundError(
      `article not found on any provider: ${segment.messageId}`,
      {
        messageId: segment.messageId,
        // Only "all providers" when every provider we tried actually answered 430
        // (no provider was unreachable or merely transiently failing).
        allProviders: !lastTransient && !lastUnreachable,
      }
    );
  }

  /**
   * The full provider order for one fetch: primaries before backups, each tier
   * ordered by {@link orderProviders}, then STABLE-sorted by per-NZB affinity.
   * Only providers KNOWN to be missing this release sink to the back; "served"
   * and "untried" are treated equally so the {@link orderProviders} order (which
   * load-balances a group) is preserved between them. Promoting "served" over
   * "untried" would pin the first provider that serves a segment as the sole
   * candidate and starve its equally-capable group peers for the whole stream.
   * With no affinity data (or a single provider) this is exactly the tier order.
   */
  private orderedCandidates(nzbHash: string | undefined): ProviderWorkerPool[] {
    const list = [
      ...this.orderProviders(false, EMPTY_EXCLUDE),
      ...this.orderProviders(true, EMPTY_EXCLUDE),
    ];
    if (!nzbHash || list.length < 2) return list;
    // Collapse served(0)/unknown(1) → 0, missing(2) → 1: only known-missing
    // providers are deprioritised; the rest keep their load-balanced order.
    const rank = (c: 0 | 1 | 2): 0 | 1 => (c === 2 ? 1 : 0);
    return list
      .map((pool, i) => ({
        pool,
        i,
        c: rank(this.affinity.classOf(nzbHash, pool.id)),
      }))
      .sort((a, b) => a.c - b.c || a.i - b.i)
      .map((x) => x.pool);
  }

  /**
   * Order providers for a fetch within a tier. Healthy (non-tripped) first,
   * then least-busy (most free connection slots) so load spreads across
   * providers that have merged into one pool. Explicit
   * `priority` (lower = first) still wins when set; latency is only a final
   * tie-breaker so the faster provider serves first-byte when capacity is equal.
   * Tripped providers are kept as last-resort cooldown probes so a fully-tripped
   * set still attempts one connection.
   */
  private orderProviders(
    useBackup: boolean,
    exclude: Set<string>
  ): ProviderWorkerPool[] {
    const eligible = this.pools.filter(
      (p) => p.isBackup === useBackup && !exclude.has(p.id)
    );
    const healthy = eligible.filter((p) => !p.tripped);
    const tripped = eligible.filter((p) => p.tripped);

    const order = (a: ProviderWorkerPool, b: ProviderWorkerPool) => {
      if (a.config.priority !== b.config.priority) {
        return a.config.priority - b.config.priority;
      }
      // Deprioritise a provider that's been missing this content, but only when
      // the difference is meaningful, so capacity + latency still drive normal
      // load-spreading between equally-reliable providers.
      if (Math.abs(a.missRate - b.missRate) > 0.2) {
        return a.missRate - b.missRate;
      }
      // Sample every online provider at least once. Without this an unmeasured
      // small account is permanently out-ranked by a roomy measured one (its
      // throughput stays 0 → never picked → never sampled → invisible to the
      // weighting below). A provider with capacity but no reading yet goes first.
      const aSample = a.throughput === 0 && a.freeSlots > 0;
      const bSample = b.throughput === 0 && b.freeSlots > 0;
      if (aSample !== bSample) return aSample ? -1 : 1;

      // Saturated providers (no free slots) sort last so the next segment spills
      // to a group member with capacity instead of queueing behind a full pool.
      const aSaturated = a.freeSlots <= 0;
      const bSaturated = b.freeSlots <= 0;
      if (aSaturated !== bSaturated) return aSaturated ? 1 : -1;

      if (a.throughput > 0 && b.throughput > 0) {
        // Spread proportional to MEASURED per-connection throughput, not nominal
        // slot count: prefer the provider with the least in-flight backlog
        // relative to its speed. `throughput × depth` recovers the per-connection
        // rate (a pipelined fetch only sees a depth-share of the socket), so the
        // comparison is fair across providers with different pipeline depths. A
        // high-capacity-but-slow provider can no longer hog the stream, and a
        // fast small account can no longer be starved by a roomy slow one.
        const aLoad = a.inFlight / (a.throughput * a.depth);
        const bLoad = b.inFlight / (b.throughput * b.depth);
        if (aLoad !== bLoad) return aLoad - bLoad;
      } else if (b.freeSlots !== a.freeSlots) {
        // Both still unmeasured: spread the cold-start burst by raw free slots.
        return b.freeSlots - a.freeSlots;
      }
      // Unmeasured (0) sorts as fastest so a fresh provider gets sampled.
      const la = a.avgLatencyMs || 0;
      const lb = b.avgLatencyMs || 0;
      return la - lb;
    };
    healthy.sort(order);
    tripped.sort(order);

    return healthy.length > 0 ? healthy : tripped;
  }

  /**
   * Cheap existence probe (STAT) across providers, used by health checks /
   * inspect. Does NOT consume the global download budget. Returns true if any
   * provider has the article.
   */
  async statSegment(
    messageId: string,
    groups: string[],
    signal: AbortSignal | undefined,
    nzbHash?: string
  ): Promise<boolean> {
    if (this.cache.get(messageId)) return true;
    // Track whether ANY provider actually answered the STAT. If none did (all
    // unreachable / at-capacity / errored), we must not return `false`; that
    // reads as "definitively absent" and trips the release gate. Throw the last
    // error instead; callers treat a throw as "unknown ⇒ present". STATs go to
    // the same worker connections at Low priority (behind playback) and do NOT
    // consume the global download budget.
    let answered = false;
    let lastErr: unknown;
    for (const pool of this.orderedCandidates(nzbHash)) {
      try {
        // Let the caller abandon its wait (the gate aborts remaining STATs on a
        // definitive miss) without affecting the in-flight STAT on the worker.
        const { value: exists } = await this.awaitAbortable(
          pool.submit<boolean>({
            groups,
            priority: CommandPriority.Low,
            run: async (conn) => ({
              value: await conn.stat(
                messageId,
                undefined,
                this.opts.segmentTimeoutMs
              ),
              bytes: 0,
            }),
          }),
          signal
        );
        // A resolved STAT means the provider answered (exists = true | false).
        answered = true;
        if (nzbHash) {
          this.affinity.record(nzbHash, pool.id, exists ? 'served' : 'missing');
        }
        if (exists) return true;
      } catch (err) {
        lastErr = err;
        logger.debug(
          { provider: pool.id, messageId, err: (err as Error).message },
          'stat failed; trying next provider'
        );
        continue;
      }
    }
    // A provider answered "absent" on every reachable provider → genuinely missing.
    if (answered) return false;
    // Nobody could be reached/queried: unknown, not missing.
    if (lastErr) throw lastErr;
    return false;
  }

  /** Download slots currently leased (in-flight article fetches). */
  get downloadsInUse(): number {
    return this.globalDownloads.inUse;
  }

  poolInfo(): PoolInfo {
    return {
      providers: this.pools.map((p) => p.info()),
      globalDownloadsInUse: this.globalDownloads.inUse,
      globalDownloadMax: this.globalDownloads.capacity,
    };
  }

  purgeStaleIdles(): void {
    for (const pool of this.pools) pool.purgeStaleIdles();
  }

  close(): void {
    for (const pool of this.pools) pool.close();
  }
}
