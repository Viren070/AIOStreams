/**
 * Shared, HTTP-agnostic types for the usenet engine. The service layer maps
 * dashboard/global settings onto these; the engine never reads UserData.
 */
import { createHmac } from 'node:crypto';

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
  maxConcurrentDownloads: number;
  /**
   * Per-stream read-ahead window, in segments: how many segments a single
   * playback/stream fetches in parallel ahead of the read cursor (and the size of
   * its reorder buffer). This is the per-stream parallelism: a lone stream
   * dispatches up to this many fetches and the global
   * {@link maxConcurrentDownloads} semaphore caps how many actually run, so one
   * stream can use the whole account while concurrent streams fair-share it.
   * Bigger absorbs more latency jitter at the cost of memory.
   */
  prefetchSegments: number;
  /**
   * Share (0..1) of the global download budget reserved for High-priority
   * playback so background work (health/inspect/seek) never starves it.
   */
  streamingPriority: number;
  /** On-disk decoded-segment cache size in bytes. `0` disables the disk cache. */
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
   * Import-time availability verification:
   * - `census`: STAT-audit every data segment of the release, run
   *   concurrently with the import (anchors + low-discrepancy spread, run
   *   densification, per-provider STAT-trust calibration). The blocking share
   *   ends with the inspect (+{@link verifyBudgetMs}); the remainder finishes
   *   in the background and updates the library entry.
   * - `none`: skip verification entirely.
   */
  verifyMode: 'none' | 'census';
  /**
   * Extra milliseconds the import may wait for census evidence after the
   * inspect phases finish. `0` (default) never delays the import.
   */
  verifyBudgetMs: number;
  /**
   * Verdict for SMALL confirmed damage (within the playback padding caps,
   * see `holes.ts`): `tolerant` imports as degraded (playback zero-fills),
   * `strict` fails the import. Damage beyond the caps fails either way.
   */
  damagePolicy: 'tolerant' | 'strict';
  /**
   * Census worker width once an import has returned and the audit continues
   * in the background (the "shadow"). The import-time (blocking) share always
   * uses the full budget: min(40, max(4, {@link maxConcurrentDownloads})).
   * Lower is gentler on providers during playback; higher finishes the audit
   * (and the final degraded/failed verdict) sooner.
   */
  censusShadowConcurrency: number;
  /**
   * Hard wall-clock cap on one census run (blocking + shadow) in ms. Bounds
   * how long a background audit can keep an otherwise-idle engine alive; a
   * capped census applies nothing (the blocking verdict stands).
   */
  censusMaxLifetimeMs: number;
  /**
   * Lazy RAR fragment resolution: for named multi-volume RAR sets whose exact
   * volume sizes come from PAR2 descriptors, skip the middle-volume probes at
   * import and read each middle volume's continuation header on first touch
   * during playback instead. Cuts a season pack's import from one segment per
   * volume to roughly one read per inner file; per-set STAT sampling is
   * widened to compensate for the skipped availability evidence.
   */
  lazyRarResolution: boolean;
  /**
   * Strict archive-volume membership: for OBFUSCATED split-7z sets (md5-named
   * subjects whose real `.7z.NNN` names live only in the yEnc headers), skip the
   * positional name-inference that avoids probing middle volumes and instead
   * probe every volume so each is identified authoritatively by its yEnc name /
   * PAR2 md5-16k descriptor. Eliminates the residual risk of the cheap
   * inference (mislabeling a non-uniform sidecar, or transposing two equal-size
   * volumes) at the cost of a first-segment fetch per volume (~one segment each,
   * full article on the wire). Off by default; the size-gated inference is the
   * cheap, always-on safety net.
   */
  strictArchiveMembership: boolean;
}

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  maxConcurrentDownloads: 60,
  prefetchSegments: 32,
  streamingPriority: 0.8,
  segmentDiskCacheBytes: 2 * 1024 * 1024 * 1024,
  segmentTimeoutMs: 30_000,
  dialTimeoutMs: 15_000,
  idleConnectionMs: 60_000,
  circuitBreakerThreshold: 5,
  circuitBreakerCooldownMs: 30_000,
  verifyMode: 'census',
  verifyBudgetMs: 0,
  damagePolicy: 'tolerant',
  censusShadowConcurrency: 12,
  censusMaxLifetimeMs: 30 * 60_000,
  lazyRarResolution: true,
  strictArchiveMembership: false,
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

/**
 * Short, non-secret discriminator for a provider's credentials, keyed with the
 * server secret (HMAC) so the value — which appears in the logged fingerprint —
 * cannot be brute-forced back to the password. A credential change yields a new
 * value, forcing an engine rebuild. Mirrors the HMAC(SECRET_KEY, …) identifier
 * pattern used elsewhere (analytics, auth).
 */
function credFingerprint(p: ProviderConfig, secret: string): string {
  if (!p.password) return '';
  return createHmac('sha256', secret)
    .update(`${p.username ?? ''}:${p.password}`)
    .digest('hex')
    .slice(0, 16);
}

/** Stable fingerprint of a provider set (for engine registry keying). */
export function providerSetFingerprint(
  providers: ProviderConfig[],
  secret: string
): string {
  const norm = providers
    .filter((p) => p.enabled !== false)
    .map((p) => ({
      host: p.host,
      port: p.port,
      tls: p.tls,
      tlsSkipVerify: !!p.tlsSkipVerify,
      username: p.username ?? '',
      credHash: credFingerprint(p, secret),
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
