import { readdir, rm } from 'fs/promises';
import { join } from 'path';
import { createLogger } from '../logging/logger.js';
import { getCacheFolder } from '../utils/general.js';
import { MultiProviderPool } from './pool/multi-provider-pool.js';
import { SegmentCache, CacheStats } from './pool/segment-cache.js';
import { StatsAccumulator } from './stats/accumulator.js';
import { FileStream, SeekableStream } from './pool/file-stream.js';
import { trackSeekableStream } from './pool/tracked-stream.js';
import {
  inspectNzb,
  selectBestVideo,
  sampleTargetAvailability,
  NzbContent,
  NzbContentFile,
  InspectOptions,
} from './pool/inspect/index.js';
import {
  inspectArchiveSets,
  groupArchiveSets,
  openArchiveInner,
  rebuildArchiveStream,
  FileOpener,
  ArchiveStreamLayout,
  type ArchiveInnerEntry,
  type ArchiveSetSpec,
  type ContentFileRef,
} from './pool/archive/open/index.js';
import { type LazyResolveHooks } from './pool/archive/lazy-resolver.js';
import {
  groupNumericSplitSets,
  type ArchiveKind,
  type NumericSplitGroup,
} from './pool/archive/archive-volume.js';
import { NotStreamableError } from './pool/archive/errors.js';
import { parseNzb } from './nzb/parse.js';
import { Nzb, NzbFile } from './nzb/model.js';
import {
  DEFAULT_ENGINE_OPTIONS,
  EngineOptions,
  PoolInfo,
  ProviderConfig,
  providerSetFingerprint,
} from './types.js';
import {
  LiveStreamInfo,
  LiveTiles,
  ProviderMetricDelta,
  ProviderStatsSnapshot,
} from './stats/types.js';

const logger = createLogger('usenet/engine');

/**
 * Cap on inspect probe concurrency. Import has no playback competing for the
 * pool, so it probes with much of the connection budget (not the per-stream
 * cap), bounded so a cold-handshake herd doesn't hit the provider.
 */
const INSPECT_MAX_CONCURRENCY = 64;

/**
 * Wall-clock budget for the whole archive-inspection phase. A pathological set
 * (thousands of volumes against a degraded provider) aborts and classifies
 * honestly instead of grinding connections for the rest of the resolve.
 */
const ARCHIVE_INSPECT_TIMEOUT_MS = 120_000;

/**
 * Target STAT sample width when the import skipped middle-volume probes
 * (lazy parse): restores the availability evidence those probes used to
 * provide, at the cost of STAT round-trips only.
 */
const CHASED_SAMPLE_POINTS = 16;

export * from './types.js';
export * from './nzb/model.js';
export { isProbablyObfuscated } from './nzb/obfuscation.js';
export * from './stats/types.js';
export { parseNzb } from './nzb/parse.js';
export {
  NntpError,
  ArticleNotFoundError,
  isProviderUnavailableError,
} from './nntp/errors.js';
export type { NzbContent, NzbContentFile } from './pool/inspect/index.js';
export {
  isSampleName,
  isEligibleVideoTarget,
  contentTotalSize,
} from './pool/inspect/index.js';
export type { CacheStats } from './pool/segment-cache.js';
export { FileStream } from './pool/file-stream.js';
export type { SeekableStream } from './pool/file-stream.js';
export { NotStreamableError } from './pool/archive/errors.js';
export type { ArchiveErrorCode } from './pool/archive/errors.js';
export type {
  ArchiveInnerEntry,
  ArchiveStreamLayout,
} from './pool/archive/open/index.js';
export type { LazyResolveHooks } from './pool/archive/lazy-resolver.js';
export {
  serializeArchiveLayout,
  deserializeArchiveLayout,
  hasPendingFragments,
} from './pool/archive/open/index.js';
export type { DataFragment } from './pool/archive/types.js';

/** Unified live snapshot for the dashboard. */
export interface EngineLiveStats {
  fingerprint: string;
  tiles: LiveTiles;
  pool: PoolInfo;
  providers: ProviderStatsSnapshot[];
  cache: CacheStats;
  /** In-flight read streams (live "Streams" view). */
  streams: LiveStreamInfo[];
}

export interface SelectCriteria {
  /** Explicit file index to open. */
  fileIndex?: number;
  /** When no index given, pick the largest streamable video (default). */
  auto?: boolean;
}

export interface FileStreamHandle {
  stream: SeekableStream;
  file: NzbContentFile;
}

/**
 * Pure, HTTP-agnostic usenet engine: given provider configs + an NZB it
 * produces file lists, seekable streams, and stats. No UserData, no Express.
 */
export class UsenetEngine {
  private pool: MultiProviderPool;
  private cache: SegmentCache;
  private stats: StatsAccumulator;
  readonly options: EngineOptions;
  private purgeTimer?: NodeJS.Timeout;
  /** Epoch ms of the last activity, for idle eviction by the registry. */
  lastUsedAt = Date.now();

  constructor(
    private providers: ProviderConfig[],
    options: Partial<EngineOptions> = {}
  ) {
    this.options = { ...DEFAULT_ENGINE_OPTIONS, ...options };
    // Segment cache entries are keyed by message-id (a globally-unique article
    // identifier whose body is byte-identical regardless of provider), so the
    // cache is provider-independent and uses one stable namespace. The registry
    // guarantees a single live engine, so this directory only has one writer.
    this.cache = new SegmentCache({
      maxBytes: this.options.segmentCacheBytes,
      diskBytes: this.options.segmentDiskCachePath
        ? this.options.segmentDiskCacheBytes
        : 0,
      diskPath: this.options.segmentDiskCachePath,
      namespace: 'segments',
    });
    this.stats = new StatsAccumulator();
    this.pool = new MultiProviderPool(
      providers,
      this.options,
      this.cache,
      this.stats
    );
    this.purgeTimer = setInterval(
      () => this.pool.purgeStaleIdles(),
      Math.max(10_000, this.options.idleConnectionMs)
    );
    this.purgeTimer.unref?.();
    logger.info(
      {
        fingerprint: this.fingerprint,
        providers: providers.filter((p) => p.enabled !== false).length,
        maxDownloadConnections: this.options.maxDownloadConnections,
        segmentCacheBytes: this.options.segmentCacheBytes,
      },
      'usenet engine created'
    );
  }

  /** Fast file list + streamability verdict. */
  async inspect(nzb: Nzb, opts: InspectOptions = {}): Promise<NzbContent> {
    this.touch();
    const inspectConcurrency =
      opts.concurrency ??
      Math.min(
        Math.max(8, this.options.maxDownloadConnections),
        INSPECT_MAX_CONCURRENCY
      );
    const content = await inspectNzb(nzb, this.pool, {
      ...opts,
      concurrency: inspectConcurrency,
      lazyArchives: opts.lazyArchives ?? this.options.lazyRarResolution,
    });
    // A definitive availability verdict from the gate / dead-abort means the
    // import fails as missing_on_providers; archive parsing and target
    // sampling would only spend fetches re-proving it.
    if ((content.availability?.missing ?? 0) > 0) {
      content.heads = undefined;
      return content;
    }
    let anyChased = await this.inspectArchives(
      nzb,
      content,
      inspectConcurrency,
      opts.signal
    );
    // The probe heads exist solely as a hand-off to the archive parse, so free
    // them (~16KB per file) before sampling/persisting.
    content.heads = undefined;
    const verifyMode = opts.verifyMode ?? this.options.verifyMode;
    const points =
      opts.availabilitySamplePoints ?? this.options.availabilitySamplePoints;
    // A chased import skipped its middle-volume probes, so its availability
    // evidence is thinner; widen the STAT sample (still ~zero bytes). In `body`
    // mode each extra point is a real transfer on the playback hot path, so keep
    // it at the configured count instead of widening.
    const samplePoints =
      anyChased && verifyMode === 'stat'
        ? Math.max(points, CHASED_SAMPLE_POINTS)
        : points;
    if (content.streamable && verifyMode !== 'none' && samplePoints > 0) {
      await sampleTargetAvailability(
        nzb,
        this.pool,
        content,
        samplePoints,
        verifyMode,
        opts.signal
      );
    }
    return content;
  }

  /**
   * Augment inspect results with stored inner-file listings for archive sets.
   * Returns whether any set was parsed in lazy mode (probe-skipped middles).
   */
  private async inspectArchives(
    nzb: Nzb,
    content: NzbContent,
    parseConcurrency: number,
    signal?: AbortSignal
  ): Promise<boolean> {
    // Raw numeric splits (`x.001..x.NNN`, names recovered by now): what the
    // joined bytes are is decided by the first chunk's probed magic: a video
    // becomes a join-layout plain target, an archive becomes a single-range
    // archive set parsed alongside the regular ones.
    const joinedArchiveSets: ArchiveSetSpec[] = [];
    for (const g of groupNumericSplitSets(
      content.files.filter((f) => !f.error)
    )) {
      const first = content.files[g.members[0].index];
      if (!first) continue;
      if (
        first.category === 'archive' &&
        (first.format === 'rar' || first.format === '7z')
      ) {
        joinedArchiveSets.push({
          kind: first.format as ArchiveKind,
          index: g.members[0].index,
          memberIndices: g.members.map((m) => m.index),
          joined: true,
        });
      } else if (first.category === 'video' && first.streamable) {
        this.addJoinedVideo(nzb, content, g);
      }
    }

    const updateStreamable = () => {
      content.streamable = content.files.some(
        (f) =>
          f.streamable ||
          (f.archiveInner?.some(
            (i) => i.streamable && i.category === 'video'
          ) ??
            false)
      );
    };

    const hasArchive = content.files.some(
      (f) => f.category === 'archive' && !f.error
    );
    if (!hasArchive && joinedArchiveSets.length === 0) {
      logger.debug(
        { nzbHash: nzb.hash },
        'no archive files detected; skipping archive inspection'
      );
      updateStreamable();
      return false;
    }

    let anyChased = false;
    // Bound the whole archive phase with ARCHIVE_INSPECT_TIMEOUT_MS, chained to
    // the caller's signal.
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    if (signal) {
      if (signal.aborted) ac.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => {
      logger.warn(
        { nzbHash: nzb.hash, timeoutMs: ARCHIVE_INSPECT_TIMEOUT_MS },
        'archive inspection timed out; aborting remaining work'
      );
      ac.abort();
    }, ARCHIVE_INSPECT_TIMEOUT_MS);
    timer.unref?.();

    const opener: FileOpener = (index, knownSize) =>
      this.openFile(nzb, nzb.files[index], ac.signal, knownSize);
    try {
      // Only EXACT sizes may seed archive volume offsets: a placeholder
      // (encoded-size) value shifts every later volume's mapping and the
      // header reads land on garbage. Unknown sizes are probed in parallel by
      // VolumeSet.open instead.
      const refs: ContentFileRef[] = content.files.map((f) => ({
        index: f.index,
        filename: f.filename,
        size: f.sizeExact ? f.size : undefined,
        segments: nzb.files[f.index]?.segments.length,
        firstSegmentNumber: nzb.files[f.index]?.segments[0]?.number,
      }));
      // Split-7z middle volumes skipped at probe time inherit volume 1's exact
      // size (fixed-size slicing). Marked `inferred` so a failed parse can fall
      // back to probing them for real (inspectArchiveSets retries).
      for (const set of groupArchiveSets(refs)) {
        if (set.kind !== '7z' || set.memberIndices.length < 4) continue;
        const first = content.files[set.memberIndices[0]];
        if (!first?.sizeExact) continue;
        for (const i of set.memberIndices.slice(1, -1)) {
          if (!content.files[i]?.sizeExact) {
            refs[i] = { ...refs[i], size: first.size, inferred: true };
          }
        }
      }
      const sets = await inspectArchiveSets(refs, opener, {
        password: nzb.meta.password,
        // Volume-size probing parallelism stays at the per-stream budget
        // (these can hit a cold pool); the header walk itself reads mostly
        // from probe heads and otherwise rides the warm import budget.
        concurrency: this.options.maxConnectionsPerStream,
        parseConcurrency,
        heads: content.heads,
        extraSets: joinedArchiveSets,
        allowLazy: !content.gateMiss && this.options.lazyRarResolution,
        signal: ac.signal,
      });
      anyChased = sets.some((s) => s.chased);
      for (const set of sets) {
        const rep = content.files.find((f) => f.index === set.index);
        if (!rep) continue;
        if (set.inner.length > 0) rep.archiveInner = set.inner;
        // A parse that failed on missing articles IS missing content: feed the
        // honest verdict (missing_on_providers) instead of the generic
        // "no streamable files".
        if (set.failure === 'article_not_found' && !rep.error) {
          rep.error = 'article_not_found';
        }
      }
      logger.debug(
        {
          nzbHash: nzb.hash,
          sets: sets.map((s) => ({
            kind: s.kind,
            volumes: s.memberIndices.length,
            inner: s.inner.length,
            streamableInner: s.inner.filter((i) => i.streamable).length,
            videos: s.inner.filter((i) => i.category === 'video').length,
            failure: s.failure,
            chased: s.chased,
          })),
        },
        'inspected archive sets'
      );
    } catch (err) {
      logger.warn(
        { nzbHash: nzb.hash, err: (err as Error).message },
        'archive inspection failed'
      );
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
    updateStreamable();
    return anyChased;
  }

  /**
   * Surface a raw numeric split whose first chunk probed as VIDEO as one
   * joined plain file: an archive-inner entry whose layout concatenates the
   * member files (`kind: 'join'`), streamed through the existing layout/session
   * machinery. Requires exact member sizes (the fragment math depends on them).
   */
  private addJoinedVideo(
    nzb: Nzb,
    content: NzbContent,
    g: NumericSplitGroup
  ): void {
    const sizes = g.members.map((m) => {
      const f = content.files[m.index];
      return f?.sizeExact ? f.size : undefined;
    });
    if (sizes.some((s) => s === undefined)) return;
    const total = sizes.reduce((a: number, b) => a + (b as number), 0);
    const first = content.files[g.members[0].index];
    if (!first) return;
    const inner: ArchiveInnerEntry = {
      path: g.baseName,
      size: total,
      category: 'video',
      format: first.format,
      streamable: true,
      layout: {
        kind: 'join',
        memberIndices: g.members.map((m) => m.index),
        memberSizes: sizes,
        nestedLevels: [],
        target: {
          name: g.baseName,
          size: total,
          fragments: [{ offset: 0, length: total }],
        },
      },
    };
    first.archiveInner = [...(first.archiveInner ?? []), inner];
    logger.debug(
      {
        nzbHash: nzb.hash,
        base: g.baseName,
        members: g.members.length,
        size: total,
      },
      'joined raw numeric split as plain video'
    );
  }

  /**
   * Open a seekable stream for a previously-selected file. Archive-inner files
   * carry an `innerPath` and are located by it (their `fileIndex` is an absolute
   * selector offset beyond `nzb.files`, not a position). Plain files carry their
   * NZB-file index in `fileIndex` and open by position (robust even when PAR2
   * recovery renamed the file), with `filename` as a last-resort fallback.
   */
  async openFileStream(
    nzb: Nzb,
    selector: { fileIndex?: number; innerPath?: string; filename?: string },
    signal?: AbortSignal
  ): Promise<SeekableStream> {
    this.touch();
    if (selector.innerPath) {
      return this.track(
        nzb,
        await this.openArchiveFileByPath(nzb, selector.innerPath, signal)
      );
    }
    let file =
      selector.fileIndex !== undefined
        ? nzb.files[selector.fileIndex]
        : undefined;
    if (!file && selector.filename !== undefined) {
      file = nzb.files.find((f) => (f.filename ?? '') === selector.filename);
    }
    if (!file) {
      throw new Error(
        `file not found (filename=${selector.filename ?? '-'}, index=${selector.fileIndex ?? '-'})`
      );
    }
    return this.track(nzb, await this.openFile(nzb, file, signal));
  }

  /**
   * Grouping refs over the raw NZB files. Segment info rides along so volume
   * grouping can resolve reposted/fill duplicates the same way everywhere.
   */
  private fileRefs(nzb: Nzb) {
    return nzb.files.map((f, i) => ({
      index: i,
      filename: f.filename,
      segments: f.segments.length,
      firstSegmentNumber: f.segments[0]?.number,
    }));
  }

  /**
   * Open a stored inner file, locating the archive set that contains it. The
   * common case is a single archive set (opened directly); when an NZB carries
   * several independent sets, each is tried until the inner path resolves.
   */
  private async openArchiveFileByPath(
    nzb: Nzb,
    innerPath: string,
    signal?: AbortSignal
  ): Promise<SeekableStream> {
    const sets = groupArchiveSets(this.fileRefs(nzb));
    if (sets.length === 0) {
      throw new Error(`no archive set in nzb for inner file (${innerPath})`);
    }
    if (sets.length === 1) {
      return this.openArchiveFile(nzb, sets[0].index, innerPath, signal);
    }
    let lastErr: unknown;
    for (const set of sets) {
      try {
        return await this.openArchiveFile(nzb, set.index, innerPath, signal);
      } catch (err) {
        // Inner path absent from this set: try the next one. Any other failure
        // (encrypted/compressed/transport) is real and propagates immediately.
        if (
          err instanceof NotStreamableError &&
          err.code === 'archive_no_video'
        ) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw (
      lastErr ??
      new Error(`inner file not found in any archive set (${innerPath})`)
    );
  }

  /** Inspect, pick a file by criteria, and open it. */
  async selectAndOpen(
    nzb: Nzb,
    criteria: SelectCriteria = { auto: true },
    signal?: AbortSignal
  ): Promise<FileStreamHandle> {
    this.touch();
    const content = await this.inspect(nzb, { mode: 'quick', signal });

    let chosen: NzbContentFile | undefined;
    if (criteria.fileIndex !== undefined) {
      chosen = content.files.find((f) => f.index === criteria.fileIndex);
    }
    if (!chosen) {
      chosen = selectBestVideo(content);
    }
    if (!chosen) {
      throw new Error('no streamable file found in NZB');
    }

    const fileSizes = new Map(
      content.files
        .filter((f) => f.sizeExact)
        .map((f) => [f.index, f.size] as [number, number])
    );
    const stream = chosen.innerPath
      ? await this.openArchiveFile(
          nzb,
          chosen.index,
          chosen.innerPath,
          signal,
          fileSizes
        )
      : await this.openFile(nzb, nzb.files[chosen.index], signal);
    return { stream: this.track(nzb, stream), file: chosen };
  }

  /** Open a stored file inside an archive set (by representative index + path). */
  private async openArchiveFile(
    nzb: Nzb,
    archiveIndex: number,
    innerPath: string,
    signal?: AbortSignal,
    fileSizes?: Map<number, number>
  ): Promise<SeekableStream> {
    const set = groupArchiveSets(this.fileRefs(nzb)).find(
      (s) => s.index === archiveIndex || s.memberIndices.includes(archiveIndex)
    );
    if (!set) {
      throw new Error(`no archive set for file index ${archiveIndex}`);
    }
    const opener: FileOpener = (index, knownSize) =>
      this.openFile(nzb, nzb.files[index], signal, knownSize);
    const knownSizes = fileSizes
      ? set.memberIndices.map((i) => fileSizes.get(i))
      : undefined;
    const opened = await openArchiveInner(set, opener, innerPath, {
      knownSizes,
      password: nzb.meta.password,
      concurrency: this.options.maxConnectionsPerStream,
      prefetchWindows: this.options.prefetchSegments,
    });
    return opened.stream;
  }

  /**
   * Rebuild an archive inner-file stream from a layout captured at inspection,
   * skipping the archive header fetch + parse (incl. the encrypted-7z AES/LZMA
   * decode) entirely. Falls back to {@link openFileStream} at the call site when
   * no layout is cached. The selector's `innerPath` is implicit in the layout.
   */
  async openArchiveStreamFromLayout(
    nzb: Nzb,
    layout: ArchiveStreamLayout,
    signal?: AbortSignal,
    lazyHooks?: LazyResolveHooks
  ): Promise<SeekableStream> {
    this.touch();
    const opener: FileOpener = (index, knownSize) =>
      this.openFile(nzb, nzb.files[index], signal, knownSize);
    const stream = await rebuildArchiveStream(layout, opener, {
      password: nzb.meta.password,
      concurrency: this.options.maxConnectionsPerStream,
      prefetchWindows: this.options.prefetchSegments,
      lazyHooks,
    });
    return this.track(nzb, stream);
  }

  private async openFile(
    nzb: Nzb,
    file: NzbFile,
    signal?: AbortSignal,
    knownSize?: number
  ): Promise<FileStream> {
    const stream = new FileStream(
      this.pool,
      {
        segments: file.segments,
        groups: file.groups,
        filename: file.filename,
        knownSize,
      },
      nzb.hash,
      this.options
    );
    await stream.open(signal);
    return stream;
  }

  /**
   * Register the streams opened on a handed-out {@link SeekableStream} with
   * this engine's stats (live dashboard gauge + per-stream view). Applied to
   * every stream returned from the public open methods (plain and archive
   * paths alike), while internal per-volume streams stay untracked.
   */
  private track(nzb: Nzb, stream: SeekableStream): SeekableStream {
    return trackSeekableStream(stream, this.stats, nzb.hash);
  }

  poolInfo(): PoolInfo {
    return this.pool.poolInfo();
  }

  statsSnapshot(): ProviderStatsSnapshot[] {
    return this.stats.snapshot();
  }

  cacheStats(): CacheStats {
    return this.cache.stats();
  }

  /**
   * True while this engine is doing real work: a read stream is open (even a
   * stalled one, since a paused player fetches nothing) or article fetches are in
   * flight (imports, inspections).
   */
  isBusy(): boolean {
    return this.stats.activeStreams > 0 || this.pool.downloadsInUse > 0;
  }

  /** Unified live snapshot (tiles + pool + per-provider + cache). */
  liveStats(): EngineLiveStats {
    this.touch();
    return {
      fingerprint: this.fingerprint,
      tiles: this.stats.live(),
      pool: this.pool.poolInfo(),
      providers: this.stats.snapshot(),
      cache: this.cache.stats(),
      streams: this.stats.liveStreams(),
    };
  }

  /** Drain per-provider deltas since the last call (for DB rollups). */
  drainMetrics(): ProviderMetricDelta[] {
    return this.stats.drain();
  }

  get fingerprint(): string {
    return providerSetFingerprint(this.providers);
  }

  private touch(): void {
    this.lastUsedAt = Date.now();
  }

  close(): void {
    if (this.purgeTimer) clearInterval(this.purgeTimer);
    this.pool.close();
    // Persist the disk index + drain pending writes; keep on-disk files so the
    // cache survives the eviction/restart (do NOT clear()).
    void this.cache.close();
    logger.debug({ fingerprint: this.fingerprint }, 'usenet engine closed');
  }
}

/**
 * One-time cleanup of legacy per-provider segment caches. Earlier builds keyed
 * the cache directory by a provider-set hash (`segments-<hash>/` +
 * `segments-<hash>.index.json`); the cache is now a single stable `segments`
 * namespace, so any `segments-*` leftover is dead weight. Best-effort and
 * silent on a missing cache folder.
 */
async function pruneLegacySegmentCaches(): Promise<void> {
  const root = getCacheFolder();
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return; // no cache folder yet, nothing to prune
  }
  await Promise.all(
    entries
      .filter(
        (name) =>
          name.startsWith('segments-') &&
          (name.endsWith('.index.json') || !name.includes('.'))
      )
      .map(async (name) => {
        try {
          await rm(join(root, name), { recursive: true, force: true });
          logger.debug({ name }, 'pruned legacy segment cache');
        } catch {
          // ignore: a concurrent process or permissions hiccup
        }
      })
  );
}

/**
 * Caches one {@link UsenetEngine} per provider-set fingerprint so connection
 * pools stay warm across requests, with idle eviction.
 */
export class UsenetEngineRegistry {
  private engines = new Map<string, UsenetEngine>();
  private evictionTimer?: NodeJS.Timeout;

  constructor(private idleEvictMs = 5 * 60_000) {
    this.evictionTimer = setInterval(() => this.evictIdle(), 60_000);
    this.evictionTimer.unref?.();
    void pruneLegacySegmentCaches();
  }

  /** Get-or-create an engine for the given providers + options. */
  get(
    providers: ProviderConfig[],
    options?: Partial<EngineOptions>
  ): UsenetEngine {
    const key = providerSetFingerprint(providers);
    let engine = this.engines.get(key);
    if (!engine) {
      // NNTP providers are a single global admin config, so any engine under a
      // different fingerprint is stale (e.g. providers were just edited). Close
      // it now instead of waiting for idle eviction, so the shared, stable
      // segment-cache directory only ever has one live writer.
      for (const [k, e] of this.engines) {
        if (k !== key) {
          logger.debug(
            { fingerprint: k },
            'closing stale usenet engine after provider change'
          );
          e.close();
          this.engines.delete(k);
        }
      }
      engine = new UsenetEngine(providers, options);
      this.engines.set(key, engine);
    }
    engine.lastUsedAt = Date.now();
    return engine;
  }

  get size(): number {
    return this.engines.size;
  }

  /** All currently-warm engines (for cross-engine drains/inspection). */
  all(): UsenetEngine[] {
    return [...this.engines.values()];
  }

  private evictIdle(): void {
    const now = Date.now();
    for (const [key, engine] of this.engines) {
      if (engine.isBusy()) {
        engine.lastUsedAt = now;
        continue;
      }
      if (now - engine.lastUsedAt > this.idleEvictMs) {
        logger.debug(
          { fingerprint: key, idleMs: now - engine.lastUsedAt },
          'evicting idle usenet engine'
        );
        engine.close();
        this.engines.delete(key);
      }
    }
  }

  closeAll(): void {
    if (this.evictionTimer) clearInterval(this.evictionTimer);
    for (const engine of this.engines.values()) engine.close();
    this.engines.clear();
  }
}
