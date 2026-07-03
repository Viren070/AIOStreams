import { appConfig } from '../../utils/index.js';
import { getCacheFolder } from '../../utils/general.js';
import {
  UsenetEngineRegistry,
  EngineOptions,
  ProviderConfig,
} from '../index.js';
import {
  PERFORMANCE_PROFILES,
  type PerformanceProfile,
} from '../../config/schema/usenet.js';

/**
 * Per-process registry of warm engines, keyed by provider-set fingerprint.
 * Shared between the service (`resolve`) and the byte-serving route so
 * connection pools and the segment cache stay warm across requests.
 */
export const usenetEngineRegistry = new UsenetEngineRegistry();

/** Human-facing summary of the per-stream knobs a (speed) test exercises. */
export interface UsenetStreamConfigSummary {
  /** In-flight BODY commands per connection (NNTP pipelining). */
  pipelineDepth: number;
  /** Per-stream read-ahead window in segments (also the per-stream parallelism). */
  prefetchSegments: number;
}

/**
 * Build the engine {@link EngineOptions} for a given provider set from the
 * DB-backed settings store. Duration settings are stored in seconds
 * (human-friendly) but the engine's options are in milliseconds, so they are
 * scaled here. Read at call-time (never at module load) so live settings edits
 * and env overrides are observed.
 *
 * `providers` scopes the auto-computed download budget (`maxConcurrentDownloads`
 * auto = Σ provider connections × pipeline depth), so passing a single provider
 * yields an isolated config; used by the per-provider speed test.
 */
export function buildUsenetEngineOptions(
  providers: ProviderConfig[]
): Partial<EngineOptions> {
  const u = appConfig.usenet;
  const depthOf = (p: ProviderConfig): number =>
    Math.max(1, p.pipelineDepth ?? 1);
  const sumPipelineSlots = providers.reduce(
    (n, p) => n + (p.maxConnections || 0) * depthOf(p),
    0
  );
  // A performance profile bundles the speed/resource knobs; `custom` falls back
  // to the individual fields. Resolved at call-time so a profile switch in the
  // dashboard takes effect on the next stream without a restart.
  const profile = u.performanceProfile as PerformanceProfile;
  const preset =
    profile !== 'custom' ? PERFORMANCE_PROFILES[profile] : undefined;
  const prefetchSegments = preset?.prefetchSegments ?? u.prefetchSegments;
  const diskCacheBytes =
    preset?.segmentDiskCacheBytes ?? u.segmentDiskCacheBytes;
  // `0` means auto: size the global in-flight download budget to the total
  // pipeline-slot count (Σ maxConnections × depth) so it never throttles
  // pipelining. An explicit value is a hard ceiling the pool gate clamps to
  // (each account's sockets are still bounded by its own maxConnections).
  const maxDownloadSetting =
    preset?.maxConcurrentDownloads ?? u.maxConcurrentDownloads;
  const maxConcurrentDownloads =
    maxDownloadSetting > 0 ? maxDownloadSetting : Math.max(1, sumPipelineSlots);
  // All disk-backed caches share the `<data>/cache` root; the engine adds its
  // own per-provider-set namespace subdirectory under it.
  const diskCachePath = diskCacheBytes > 0 ? getCacheFolder() : undefined;
  return {
    maxConcurrentDownloads,
    prefetchSegments,
    streamingPriority: u.streamingPriority,
    segmentDiskCacheBytes: diskCacheBytes,
    segmentDiskCachePath: diskCachePath,
    segmentTimeoutMs: u.segmentTimeout * 1000,
    dialTimeoutMs: u.dialTimeout * 1000,
    idleConnectionMs: u.idleConnection * 1000,
    circuitBreakerThreshold: u.circuitBreakerThreshold,
    circuitBreakerCooldownMs: u.circuitBreakerCooldown * 1000,
    lazyRarResolution: u.lazyRarResolution,
    strictArchiveMembership: u.strictArchiveMembership,
    verifyMode: u.verifyMode,
    verifyBudgetMs: u.verifyBudgetMs,
    damagePolicy: u.damagePolicy,
    censusShadowConcurrency: u.censusShadowConcurrency,
    censusMaxLifetimeMs: u.censusMaxLifetime * 1000,
  };
}

/**
 * Resolve the global usenet engine configuration (every enabled provider) from
 * the DB-backed settings store, for the warm streaming engine.
 */
export function getUsenetEngineConfig(): {
  providers: ProviderConfig[];
  options: Partial<EngineOptions>;
} {
  const providers = (appConfig.usenet.providers as ProviderConfig[]).filter(
    (p) => p.enabled !== false
  );
  return { providers, options: buildUsenetEngineOptions(providers) };
}

/**
 * Resolve the streaming config a SINGLE provider runs under, for an isolated
 * speed test that replicates a real playback: the same {@link EngineOptions} the
 * engine would build for that provider alone, plus a human-facing summary of the
 * per-stream knobs being exercised (read-ahead window + pipeline depth). Lets the
 * dashboard show "tested at read-ahead R × depth D" so the knobs are tunable by
 * re-running.
 */
export function getSpeedTestEngineConfig(provider: ProviderConfig): {
  options: Partial<EngineOptions>;
  summary: UsenetStreamConfigSummary;
} {
  const u = appConfig.usenet;
  const options = buildUsenetEngineOptions([provider]);
  const pipelineDepth = Math.max(1, provider.pipelineDepth ?? 1);
  const prefetchSegments = options.prefetchSegments ?? u.prefetchSegments;
  return {
    options,
    summary: { pipelineDepth, prefetchSegments },
  };
}
