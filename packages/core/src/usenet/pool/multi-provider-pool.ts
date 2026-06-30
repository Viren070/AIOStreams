import { SegmentCache } from './segment-cache.js';
import { PrioritySemaphore } from './priority-semaphore.js';
import { StatsAccumulator } from '../stats/accumulator.js';
import {
  SegmentFetcher,
  SegmentHeadData,
  LocalSegmentFetcher,
  awaitAbortable,
} from '../nntp/segment-fetcher.js';
import {
  CommandPriority,
  EngineOptions,
  NzbSegmentRef,
  PoolInfo,
  ProviderConfig,
  SegmentData,
} from '../types.js';

export type { SegmentHeadData } from '../nntp/segment-fetcher.js';

/**
 * Coordinates segment fetches: owns the segment cache, single-flight de-dupe and
 * the global (prioritised) download budget, and delegates the actual
 * connection-owning work (provider failover + yEnc decode) to a
 * {@link SegmentFetcher} (the in-process {@link LocalSegmentFetcher}).
 */
export class MultiProviderPool {
  private fetcher: SegmentFetcher;
  private globalDownloads: PrioritySemaphore;
  private inflight = new Map<string, Promise<SegmentData>>();
  /**
   * Single-flight for head-only probe fetches. Fill/repost NZBs list the SAME
   * articles under multiple `<file>` entries, and head fetches don't populate
   * the segment cache; without this, every duplicate probe re-downloads the
   * article.
   */
  private inflightHeads = new Map<string, Promise<SegmentHeadData>>();

  constructor(
    providers: ProviderConfig[],
    opts: EngineOptions,
    private cache: SegmentCache,
    stats: StatsAccumulator
  ) {
    // The fetcher owns the connection pools + failover + decode; the engine's
    // StatsAccumulator is its (in-process) stats sink.
    this.fetcher = new LocalSegmentFetcher(providers, opts, stats);

    // The global download budget is a hard ceiling on concurrent in-flight
    // BODY/ARTICLE downloads; the per-stream priority reservation rides on this
    // semaphore.
    this.globalDownloads = new PrioritySemaphore(
      Math.max(1, opts.maxDownloadConnections),
      opts.streamingPriority
    );
  }

  /**
   * Fetch + decode one segment, trying providers in priority/availability order
   * with per-segment 430 failover and backup escalation. Throws
   * `ArticleNotFoundError` when every provider reports the article missing, or
   * the last transient `NntpError` when all attempts failed transiently.
   */
  async fetchSegment(
    segment: NzbSegmentRef,
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
      const promise = this.diskThenFetch(segment, nzbHash, priority);
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
    return awaitAbortable(shared, signal);
  }

  /**
   * On a sync (L1) cache miss, consult the disk tier before paying for a
   * network fetch. Runs inside the single-flight dedupe so concurrent misses
   * for the same segment share one disk read.
   */
  private async diskThenFetch(
    segment: NzbSegmentRef,
    nzbHash: string,
    priority: CommandPriority
  ): Promise<SegmentData> {
    const fromDisk = await this.cache.getAsync(segment.messageId);
    if (fromDisk) return fromDisk;
    return this.doFetch(segment, nzbHash, priority);
  }

  private async doFetch(
    segment: NzbSegmentRef,
    nzbHash: string,
    priority: CommandPriority
  ): Promise<SegmentData> {
    const releaseGlobal = await this.globalDownloads.acquire(
      priority,
      undefined
    );
    try {
      const data = await this.fetcher.fetchBody(segment, nzbHash, priority);
      // Write-through for ALL priorities, including import probes that still take
      // the full path (par2, mid-volume header reads). RAM is protected by the
      // bounded pending-write queue, not by skipping the writes.
      this.cache.set(segment.messageId, data);
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
    if (this.cache.get(messageId)) return true;
    return this.fetcher.statSegment(
      messageId,
      nzbHash,
      CommandPriority.Low,
      signal
    );
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
