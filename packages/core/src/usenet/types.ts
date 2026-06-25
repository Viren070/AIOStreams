/**
 * Shared, HTTP-agnostic types for the usenet engine. The service layer maps
 * dashboard/global settings onto these; the engine never reads UserData.
 */

/** A single NNTP provider/account configuration. */
export interface ProviderConfig {
  /** Stable id (e.g. slug of host or a uuid) used for stats + dashboard. */
  id: string;
  /** Display name for the dashboard. */
  name?: string;
  host: string;
  port: number;
  /** Use implicit TLS (usually port 563). */
  tls: boolean;
  /** Skip TLS certificate verification (self-signed providers). */
  tlsSkipVerify?: boolean;
  username?: string;
  password?: string;
  /** Hard ceiling on simultaneous connections for this account. */
  maxConnections: number;
  /** Lower number = higher priority. Primaries should be < backups. */
  priority: number;
  /**
   * Block/backup account: only used after primaries return 430 for a segment.
   * Keeps metered block usage low.
   */
  isBackup?: boolean;
  /** Admin toggle to disable without deleting. */
  enabled?: boolean;
  /**
   * Max in-flight `BODY`/`STAT` commands per connection (NNTP pipelining). `1`
   * (default) = sequential. Higher hides per-article latency so fewer
   * connections saturate a fast/high-latency link. Defaults to `1` (off) when
   * unset.
   */
  pipelineDepth?: number;
}

/** Tunable engine behaviour (sourced from global usenet settings). */
export interface EngineOptions {
  /** Global ceiling on concurrent BODY/ARTICLE downloads across all streams. */
  maxDownloadConnections: number;
  /** Max parallel segment fetches for a single playback/stream. */
  maxConnectionsPerStream: number;
  /**
   * Read-ahead depth, in segments, for a single playback/stream. The reorder
   * buffer is sized to hold this many segments so the stream stays ahead of the
   * consumer and absorbs per-segment latency jitter.
   * Independent of {@link maxConnectionsPerStream}, which caps *in-flight*
   * fetches; this caps how far *ahead* of the read cursor we prefetch.
   */
  prefetchSegments: number;
  /**
   * Share (0..1) of the global download budget reserved for High-priority
   * playback so background work (health/inspect/seek) never starves it.
   */
  streamingPriority: number;
  /** In-memory segment cache size in bytes. */
  segmentCacheBytes: number;
  /** On-disk segment cache overflow size in bytes. `0` disables the disk tier. */
  segmentDiskCacheBytes: number;
  /** Absolute base directory for the on-disk segment cache. */
  segmentDiskCachePath?: string;
  /** Per-command/segment hard timeout in milliseconds. */
  segmentTimeoutMs: number;
  /** TCP dial timeout in milliseconds. */
  dialTimeoutMs: number;
  /** Idle connection TTL before considered stale. */
  idleConnectionMs: number;
  /** Consecutive failures before a provider circuit-breaker trips. */
  circuitBreakerThreshold: number;
  /** Cooldown before a tripped provider is probed again. */
  circuitBreakerCooldownMs: number;
  /**
   * Number of evenly-spaced points (begin/end) of the target video to STAT at
   * import to catch incomplete/removed posts before playback (reduces
   * mid-stream failures). `0` disables. STATs are cheap (Low priority, no
   * download budget) and check every provider incl. backups.
   */
  availabilitySamplePoints: number;
  /**
   * How the target-availability sample is verified at import:
   * - `stat`: cheap STAT existence check (fast, but a cache/debrid NNTP gateway
   *   can answer "present" for an article whose body it cannot deliver).
   * - `body`: authoritative - actually body-fetches the sample segments, slightly slower; the
   *   fetched segments are cached so they double as start-of-playback prefetch.
   * - `none`: skip the target-availability sample entirely.
   */
  verifyMode: 'none' | 'stat' | 'body';
  /**
   * Lazy RAR fragment resolution: for named multi-volume RAR sets whose exact
   * volume sizes come from PAR2 descriptors, skip the middle-volume probes at
   * import and read each middle volume's continuation header on first touch
   * during playback instead. Cuts a season pack's import from one segment per
   * volume to roughly one read per inner file; per-set STAT sampling is
   * widened to compensate for the skipped availability evidence.
   */
  lazyRarResolution: boolean;
}

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  maxDownloadConnections: 60,
  maxConnectionsPerStream: 8,
  prefetchSegments: 32,
  streamingPriority: 0.8,
  segmentCacheBytes: 256 * 1024 * 1024,
  segmentDiskCacheBytes: 2 * 1024 * 1024 * 1024,
  segmentTimeoutMs: 30_000,
  dialTimeoutMs: 15_000,
  idleConnectionMs: 60_000,
  circuitBreakerThreshold: 5,
  circuitBreakerCooldownMs: 30_000,
  availabilitySamplePoints: 3,
  verifyMode: 'stat',
  lazyRarResolution: true,
};

/** Priority for an NNTP command acquisition. */
export enum CommandPriority {
  /** Playback BODY/ARTICLE; must not be starved. */
  High = 0,
  /** STAT/HEAD/DATE: health, inspect, seek probes. */
  Low = 1,
}

export type ProviderState =
  | 'online'
  | 'connecting'
  | 'offline'
  | 'auth_failed'
  | 'disabled';

/** Live per-provider connection info for the dashboard + ordering. */
export interface ProviderPoolInfo {
  id: string;
  name?: string;
  state: ProviderState;
  total: number;
  idle: number;
  acquired: number;
  available: number;
  max: number;
  tripped: boolean;
  isBackup: boolean;
  freeSlots: number;
  throughput: number;
}

export interface PoolInfo {
  providers: ProviderPoolInfo[];
  /** Currently in-use slots of the global download semaphore. */
  globalDownloadsInUse: number;
  globalDownloadMax: number;
}

/** Minimal reference to a segment the pool needs to fetch. */
export interface NzbSegmentRef {
  messageId: string;
  number?: number;
  bytes?: number;
}

/** A fetched, decoded segment payload. */
export interface SegmentData {
  body: Buffer;
  byteRange?: [number, number];
  fileSize?: number;
  /** Filename from the yEnc `=ybegin name=` header, if present. */
  name?: string;
  /** Decoded byte length. */
  size: number;
}

/** Stable fingerprint of a provider set (for engine registry keying). */
export function providerSetFingerprint(providers: ProviderConfig[]): string {
  const norm = providers
    .filter((p) => p.enabled !== false)
    .map((p) => ({
      host: p.host,
      port: p.port,
      tls: p.tls,
      username: p.username ?? '',
      maxConnections: p.maxConnections,
      priority: p.priority,
      isBackup: !!p.isBackup,
      // Depth changes pool sizing (pipeline slots), so it must rebuild the engine.
      pipelineDepth: p.pipelineDepth ?? 0,
    }))
    .sort((a, b) =>
      `${a.host}:${a.port}:${a.username}`.localeCompare(
        `${b.host}:${b.port}:${b.username}`
      )
    );
  return JSON.stringify(norm);
}
