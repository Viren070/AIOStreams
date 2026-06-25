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
  /** Parallel socket fetches per stream (the configured connections-per-stream). */
  connectionsPerStream: number;
  /** In-flight BODY commands per connection (NNTP pipelining). */
  pipelineDepth: number;
  /** Read-ahead depth in segments. */
  prefetchSegments: number;
}

/**
 * Build the engine {@link EngineOptions} for a given provider set from the
 * DB-backed settings store. Duration settings are stored in seconds
 * (human-friendly) but the engine's options are in milliseconds, so they are
 * scaled here. Read at call-time (never at module load) so live settings edits
 * and env overrides are observed.
 *
 * `providers` scopes the auto-computed connection budgets (`maxDownloadConnections`
 * auto = Σ provider connections; per-stream parallelism scales by the deepest
 * provider's pipeline depth), so passing a single provider yields an isolated
 * config; used by the per-provider speed test.
 */
export function buildUsenetEngineOptions(
  providers: ProviderConfig[]
): Partial<EngineOptions> {
  const u = appConfig.usenet;
  // `0` (default) means auto: the global download budget is the sum of every
  // enabled provider's account connection limit, so a single provider's cap is
  // never artificially throttled by a fixed global ceiling.
  const sumProviderConnections = providers.reduce(
    (n, p) => n + (p.maxConnections || 0),
    0
  );
  const maxDownloadConnections =
    u.maxDownloadConnections > 0
      ? u.maxDownloadConnections
      : Math.max(1, sumProviderConnections);
  // A performance profile bundles the speed/resource knobs; `custom` falls back
  // to the individual fields. Resolved at call-time so a profile switch in the
  // dashboard takes effect on the next stream without a restart.
  const profile = u.performanceProfile as PerformanceProfile;
  const preset =
    profile !== 'custom' ? PERFORMANCE_PROFILES[profile] : undefined;
  const baseConnectionsPerStream =
    preset?.maxConnectionsPerStream ?? u.maxConnectionsPerStream;
  // `maxConnectionsPerStream` is a *parallel-fetch* count (segments in flight per
  // stream), not a connection cap. With NNTP pipelining each connection carries
  // up to `depth` in-flight commands, so a stream must dispatch
  // `connections × depth` fetches to fill the pipelines. Scale it by the deepest
  // provider depth (the worker pool still packs them onto ≤ connections sockets).
  const maxProviderDepth = Math.max(
    1,
    ...providers.map((p) => p.pipelineDepth ?? 0)
  );
  const maxConnectionsPerStream = baseConnectionsPerStream * maxProviderDepth;
  const prefetchSegments = preset?.prefetchSegments ?? u.prefetchSegments;
  const segmentCacheBytes = preset?.segmentCacheBytes ?? u.segmentCacheBytes;
  const diskCacheBytes =
    preset?.segmentDiskCacheBytes ?? u.segmentDiskCacheBytes;
  // All disk-backed caches share the `<data>/cache` root; the engine adds its
  // own per-provider-set namespace subdirectory under it.
  const diskCachePath = diskCacheBytes > 0 ? getCacheFolder() : undefined;
  return {
    maxDownloadConnections,
    maxConnectionsPerStream,
    prefetchSegments,
    streamingPriority: u.streamingPriority,
    segmentCacheBytes,
    segmentDiskCacheBytes: diskCacheBytes,
    segmentDiskCachePath: diskCachePath,
    segmentTimeoutMs: u.segmentTimeout * 1000,
    dialTimeoutMs: u.dialTimeout * 1000,
    idleConnectionMs: u.idleConnection * 1000,
    circuitBreakerThreshold: u.circuitBreakerThreshold,
    circuitBreakerCooldownMs: u.circuitBreakerCooldown * 1000,
    lazyRarResolution: u.lazyRarResolution,
    verifyMode: u.verifyMode,
    availabilitySamplePoints: u.verifySamplePoints,
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
 * three knobs being exercised (connections per stream, pipeline depth, prefetch).
 * Lets the dashboard show "tested at N conns × depth D, prefetch P" so the knobs
 * are tunable by re-running.
 */
export function getSpeedTestEngineConfig(provider: ProviderConfig): {
  options: Partial<EngineOptions>;
  summary: UsenetStreamConfigSummary;
} {
  const u = appConfig.usenet;
  const options = buildUsenetEngineOptions([provider]);
  const pipelineDepth = Math.max(1, provider.pipelineDepth ?? 1);
  const prefetchSegments = options.prefetchSegments ?? u.prefetchSegments;
  // options.maxConnectionsPerStream is the scaled parallel-fetch count
  // (connections × depth); divide back out to report the configured socket count.
  const connectionsPerStream = Math.max(
    1,
    Math.round((options.maxConnectionsPerStream ?? pipelineDepth) / pipelineDepth)
  );
  return {
    options,
    summary: { connectionsPerStream, pipelineDepth, prefetchSegments },
  };
}
