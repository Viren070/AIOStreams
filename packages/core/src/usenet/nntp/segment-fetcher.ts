import { createLogger } from '../../logging/logger.js';
import {
  ProviderWorkerPool,
  WorkerPoolOptions,
} from './provider-worker-pool.js';
import { NntpConnection } from './connection.js';
import {
  ArticleNotFoundError,
  NntpError,
  isTransientNntpError,
} from './errors.js';
import {
  decodeArticle,
  YencDecodeError,
  YencHeadCapture,
} from '../pool/yenc.js';
import {
  CommandPriority,
  EngineOptions,
  NzbSegmentRef,
  ProviderConfig,
  ProviderPoolInfo,
  SegmentData,
} from '../types.js';
import { StatsEvent } from '../stats/types.js';

const logger = createLogger('usenet/segment-fetcher');

/**
 * Minimal stats surface the fetcher reports outcomes to. The engine's
 * `StatsAccumulator` implements it directly (in-process); a worker-backed
 * fetcher swaps in a sink that ships the events to the main thread.
 */
export interface StatsSink {
  fetchStarted(providerId: string): void;
  fetchEnded(providerId: string): void;
  record(event: StatsEvent): void;
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
 * "Fetch one segment, with provider failover + decode." The connection-owning
 * half of the engine ({@link LocalSegmentFetcher}). The caller
 * ({@link MultiProviderPool}) owns the segment cache, single-flight de-dupe and
 * the global download semaphore; the fetcher owns the provider pools,
 * ordering/affinity, the 430 failover and the yEnc decode.
 */
export interface SegmentFetcher {
  /**
   * Fetch + decode a full article body, with per-segment provider failover.
   * When `out` is provided the decode targets the buffer it returns (invoked
   * lazily at decode time) and the returned body may be a view into it, with
   * its lifetime owned by the caller; without `out` the body is always owned.
   */
  fetchBody(
    segment: NzbSegmentRef,
    nzbHash: string,
    priority: CommandPriority,
    out?: () => Buffer
  ): Promise<SegmentData>;
  /** Head-only probe: decode the leading `want` bytes + yEnc header fields. */
  fetchHead(
    segment: NzbSegmentRef,
    nzbHash: string,
    priority: CommandPriority,
    want: number
  ): Promise<SegmentHeadData>;
  /** STAT existence probe across providers (no download budget). */
  statSegment(
    messageId: string,
    nzbHash: string | undefined,
    priority: CommandPriority,
    signal: AbortSignal | undefined
  ): Promise<boolean>;
  /** STAT probe that reports which provider answered (census evidence). */
  statSegmentDetailed(
    messageId: string,
    nzbHash: string | undefined,
    priority: CommandPriority,
    signal: AbortSignal | undefined,
    providerIds?: readonly string[]
  ): Promise<StatDetail>;
  /** BODY existence probe on exactly one provider (STAT-trust calibration). */
  probeBodyOnProvider(
    segment: NzbSegmentRef,
    providerId: string,
    signal?: AbortSignal
  ): Promise<'ok' | 'not_found' | 'unreachable'>;
  /** Configured provider ids, in priority order. */
  providerIds(): string[];
  /** Per-provider pool info for the dashboard. */
  info(): ProviderPoolInfo[];
  purgeStaleIdles(): void;
  close(): void;
}

/** Outcome of a detailed STAT probe (see {@link SegmentFetcher}). */
export interface StatDetail {
  /** True when some candidate answered 223 (present). */
  present: boolean;
  /** Provider that answered present (unset for cache-satisfied probes). */
  answeredBy?: string;
  /** Whether at least one candidate gave a definitive answer. */
  answered: boolean;
}

/**
 * Await a shared fetch on behalf of one caller, allowing that caller to abandon
 * its wait via its own `signal` (rejecting with `aborted`) without affecting the
 * shared work or any other waiter.
 */
export function awaitAbortable<T>(
  shared: Promise<T>,
  signal: AbortSignal | undefined
): Promise<T> {
  if (!signal) return shared;
  if (signal.aborted) {
    void shared.catch(() => undefined);
    return Promise.reject(new NntpError('connection', 'aborted'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new NntpError('connection', 'aborted'));
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

/** Shared empty exclusion set for full-order candidate listing. */
const EMPTY_EXCLUDE = new Set<string>();

/** Sliding lifetime of a per-NZB provider-affinity entry. */
const AFFINITY_TTL_MS = 30 * 60_000;
/** Max NZBs tracked (insertion-order eviction). */
const AFFINITY_MAX_HASHES = 512;

/** Min recorded outcomes before a provider can be demoted for a release. */
const AFFINITY_MIN_SAMPLES = 4;
/**
 * Cumulative body-miss ratio (missed / attempts) at/above which a provider is
 * demoted for this nzb.
 */
const AFFINITY_DEMOTE_RATIO = 0.3;
/**
 * Cumulative ratio at/below which a demoted provider rehabilitates. The gap to
 * {@link AFFINITY_DEMOTE_RATIO} plus the cumulative denominator make demotion
 * sticky: once misses accrue the ratio can't crater in one run, so a provider
 * proven materially incomplete for a release stays demoted (a miss is a
 * definitive content 430, not a transient error). A small cold-start burst still
 * self-corrects while the counts are tiny.
 */
const AFFINITY_RECOVER_RATIO = 0.12;

/** Mutable per-(nzb, provider) reliability state. */
interface AffinityStat {
  /** Body fetches this provider actually delivered for this nzb. */
  served: number;
  /** Definitive content-misses (body/STAT 430) for this nzb. */
  missed: number;
  /** Stateful demotion flag with hysteresis (never recomputed ad hoc). */
  demoted: boolean;
}

/**
 * Per-NZB provider reliability tracker. A provider that 430s articles of one
 * release while another serves them gets demoted for that release only; the
 * global provider order (priority/tier/health) is untouched, so a backup or
 * lower-priority provider that happens to carry one NZB isn't promoted for
 * everything else (metered block accounts must not drain globally).
 *
 * Demotion is driven by the cumulative per-release body-miss ratio with sticky
 * hysteresis (see the threshold constants), so a provider stays deprioritised
 * for a release instead of flapping as playback crosses present/absent clusters.
 * It is only an ordering signal: every fetch still falls through the full
 * provider list, so "missing on all providers" semantics and transient-outage
 * failover are unchanged, and a demoted provider is still tried as a fallback
 * when the leader misses.
 */
class ProviderAffinity {
  private byHash = new Map<
    string,
    { at: number; stats: Map<string, AffinityStat> }
  >();

  /**
   * Record one fetch outcome for ordering. `miss` is a definitive content-miss
   * (a body/STAT 430), never a transient/unreachable error (those aren't
   * recorded). A STAT `present` is dropped (unreliable: a cache/debrid gateway
   * answers present for articles it can't deliver), so only body successes count
   * as `served`.
   */
  record(
    hash: string,
    providerId: string,
    miss: boolean,
    source: 'body' | 'stat'
  ): void {
    if (source === 'stat' && !miss) return; // unreliable positive; ignore
    const now = Date.now();
    let entry = this.byHash.get(hash);
    if (entry && now - entry.at > AFFINITY_TTL_MS) {
      this.byHash.delete(hash);
      entry = undefined;
    }
    if (!entry) {
      entry = { at: now, stats: new Map() };
    } else {
      this.byHash.delete(hash); // refresh insertion order (LRU)
    }
    entry.at = now;

    let stat = entry.stats.get(providerId);
    if (!stat) {
      stat = { served: 0, missed: 0, demoted: false };
      entry.stats.set(providerId, stat);
    }
    if (miss) stat.missed++;
    else stat.served++;
    const attempts = stat.served + stat.missed;
    const ratio = stat.missed / attempts;

    // Hysteresis on the cumulative ratio: demote a materially-incomplete provider
    // and keep it demoted (sticky) until it serves nearly everything again.
    if (
      !stat.demoted &&
      attempts >= AFFINITY_MIN_SAMPLES &&
      ratio >= AFFINITY_DEMOTE_RATIO
    ) {
      stat.demoted = true;
      logger.debug(
        { nzbHash: hash, providerId, served: stat.served, missed: stat.missed },
        'provider demoted for this nzb (missing a material fraction)'
      );
    } else if (stat.demoted && ratio <= AFFINITY_RECOVER_RATIO) {
      stat.demoted = false;
      logger.debug(
        { nzbHash: hash, providerId, served: stat.served, missed: stat.missed },
        'provider rehabilitated for this nzb (serving again)'
      );
    }

    this.byHash.set(hash, entry);
    if (this.byHash.size > AFFINITY_MAX_HASHES) {
      const oldest = this.byHash.keys().next().value;
      if (oldest !== undefined) this.byHash.delete(oldest);
    }
  }

  /** Whether this provider is currently demoted for this release. */
  isDemoted(hash: string, providerId: string): boolean {
    const entry = this.byHash.get(hash);
    if (!entry || Date.now() - entry.at > AFFINITY_TTL_MS) return false;
    return entry.stats.get(providerId)?.demoted ?? false;
  }
}

/**
 * In-process {@link SegmentFetcher}: owns the per-provider {@link
 * ProviderWorkerPool}s and runs the BODY/HEAD/STAT + 430 failover + yEnc decode
 * on the event loop.
 */
export class LocalSegmentFetcher implements SegmentFetcher {
  private pools: ProviderWorkerPool[];
  /** Per-NZB provider-order hints (only consulted with >1 provider). */
  private affinity = new ProviderAffinity();

  constructor(
    providers: ProviderConfig[],
    private opts: EngineOptions,
    private stats: StatsSink
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
  }

  async fetchBody(
    segment: NzbSegmentRef,
    nzbHash: string,
    priority: CommandPriority,
    out?: () => Buffer
  ): Promise<SegmentData> {
    return this.submitWithFailover<SegmentData>(
      segment,
      nzbHash,
      priority,
      async (conn) => {
        const raw = await conn.body(
          segment.messageId,
          undefined,
          this.opts.segmentTimeoutMs
        );
        // Failover attempts run sequentially, so re-decoding a retry into the
        // same target is safe: only the resolving attempt's bytes survive.
        const decoded = decodeArticle(raw, out?.());
        const data: SegmentData = {
          body: decoded.body,
          byteRange: decoded.byteRange,
          fileSize: decoded.fileSize,
          name: decoded.name,
          size: decoded.size,
        };
        return { value: data, bytes: data.size };
      }
    );
  }

  async fetchHead(
    segment: NzbSegmentRef,
    nzbHash: string,
    priority: CommandPriority,
    want: number
  ): Promise<SegmentHeadData> {
    return this.submitWithFailover<SegmentHeadData>(
      segment,
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
  }

  /**
   * Cheap existence probe (STAT) across providers, used by health checks /
   * inspect. Does NOT consume the global download budget. Returns true if any
   * provider has the article.
   */
  async statSegment(
    messageId: string,
    nzbHash: string | undefined,
    priority: CommandPriority,
    signal: AbortSignal | undefined
  ): Promise<boolean> {
    const detail = await this.statSegmentDetailed(
      messageId,
      nzbHash,
      priority,
      signal
    );
    return detail.present;
  }

  /**
   * STAT probe that also reports WHICH provider answered present, and lets the
   * caller restrict candidates (the census excludes providers whose STAT
   * answers are proven untrustworthy). Throws when no candidate could be
   * queried at all; callers treat a throw as "unknown ⇒ present".
   */
  async statSegmentDetailed(
    messageId: string,
    nzbHash: string | undefined,
    priority: CommandPriority,
    signal: AbortSignal | undefined,
    providerIds?: readonly string[]
  ): Promise<StatDetail> {
    // Track whether any provider actually answered the STAT. If none did (all
    // unreachable / at-capacity / errored), we must not report `absent`; that
    // reads as "definitively missing" and trips availability verdicts. Throw
    // the last error instead. STATs go to the same worker connections at Low
    // priority (behind playback) and do NOT consume the global download budget.
    let answered = false;
    let lastErr: unknown;
    for (const pool of this.orderedCandidates(nzbHash)) {
      if (providerIds && !providerIds.includes(pool.id)) continue;
      try {
        // Let the caller abandon its wait (a caller aborts remaining STATs on
        // a definitive miss) without affecting the in-flight STAT on the worker.
        const { value: exists } = await awaitAbortable(
          pool.submit<boolean>({
            priority,
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
          this.affinity.record(nzbHash, pool.id, !exists, 'stat');
        }
        if (exists) return { present: true, answeredBy: pool.id, answered };
      } catch (err) {
        lastErr = err;
        logger.debug(
          { provider: pool.id, messageId, err: (err as Error).message },
          'stat failed; trying next provider'
        );
        continue;
      }
    }
    // A provider answered "absent" on every reachable candidate → missing.
    if (answered) return { present: false, answered };
    // Nobody could be reached/queried: unknown, not missing.
    if (lastErr) throw lastErr;
    return { present: false, answered: false };
  }

  /**
   * BODY probe on exactly ONE provider, transfer discarded: does this provider
   * actually deliver an article it (or its index) claims to have? Used only
   * for STAT-trust calibration (a lying cache/debrid gateway answers STAT 223
   * for bodies it 430s). No failover, no decode, no cache interaction.
   */
  async probeBodyOnProvider(
    segment: NzbSegmentRef,
    providerId: string,
    signal?: AbortSignal
  ): Promise<'ok' | 'not_found' | 'unreachable'> {
    const pool = this.pools.find((p) => p.id === providerId);
    if (!pool) return 'unreachable';
    try {
      await awaitAbortable(
        pool.submit<number>({
          priority: CommandPriority.Low,
          run: async (conn) => {
            // Raw transfer only: the calibration signal is 222-vs-430, and
            // skipping the decode keeps corrupt-but-delivered articles from
            // reading as a lying STAT.
            const raw = await conn.body(
              segment.messageId,
              undefined,
              this.opts.segmentTimeoutMs
            );
            return { value: raw.length, bytes: raw.length };
          },
        }),
        signal
      );
      return 'ok';
    } catch (err) {
      if (err instanceof NntpError && err.kind === 'article_not_found') {
        return 'not_found';
      }
      return 'unreachable';
    }
  }

  providerIds(): string[] {
    return this.pools.map((p) => p.id);
  }

  info(): ProviderPoolInfo[] {
    return this.pools.map((p) => p.info());
  }

  purgeStaleIdles(): void {
    for (const pool of this.pools) pool.purgeStaleIdles();
  }

  close(): void {
    for (const pool of this.pools) pool.close();
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
    nzbHash: string | undefined,
    priority: CommandPriority,
    run: (conn: NntpConnection) => Promise<{ value: T; bytes: number }>
  ): Promise<T> {
    const notFound = new Set<string>();
    let lastTransient: NntpError | null = null;
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
          priority,
          run,
        });
        if (nzbHash) this.affinity.record(nzbHash, pool.id, false, 'body');
        this.stats.record({
          type: 'segment_fetched',
          providerId: pool.id,
          bytes,
          durationMs,
        });
        logger.trace(
          {
            provider: pool.label,
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
          if (nzbHash) this.affinity.record(nzbHash, pool.id, true, 'body');
          this.stats.record({ type: 'segment_missing', providerId: pool.id });
          logger.debug(
            { provider: pool.label, messageId: segment.messageId },
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
   * Only providers DEMOTED for this release (missing the bulk of it) sink to the
   * back; everyone else keeps the {@link orderProviders} order (which load-
   * balances a group), so a provider that serves the odd segment isn't pinned as
   * the sole candidate and starve its equally-capable peers. With no affinity
   * data (or a single provider) this is exactly the tier order.
   */
  private orderedCandidates(nzbHash: string | undefined): ProviderWorkerPool[] {
    const list = [
      ...this.orderProviders(false, EMPTY_EXCLUDE),
      ...this.orderProviders(true, EMPTY_EXCLUDE),
    ];
    if (!nzbHash || list.length < 2) return list;
    return list
      .map((pool, i) => ({
        pool,
        i,
        demoted: this.affinity.isDemoted(nzbHash, pool.id) ? 1 : 0,
      }))
      .sort((a, b) => a.demoted - b.demoted || a.i - b.i)
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
        // comparison is fair across providers with different pipeline depths.
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
}
