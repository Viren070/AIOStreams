import { settingsStore } from '../../../config/index.js';
import {
  UsenetMetricsRepository,
  type UsenetMetricDelta,
} from '../../../db/index.js';
import {
  ProviderConfig,
  ProviderState,
  PoolInfo,
  LiveTiles,
  LiveStreamInfo,
  CacheStats,
} from '../../index.js';
import { usenetEngineRegistry, getUsenetEngineConfig } from '../engine.js';

export type UsenetStatsWindow = '24h' | '7d' | '30d' | 'all';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Live connection summary for one provider. */
export interface ProviderLiveInfo {
  state: ProviderState;
  active: number;
  idle: number;
  total: number;
  max: number;
  available: number;
  tripped: boolean;
}

/** A provider row combining config, live pool state, and window aggregates. */
export interface UsenetProviderStatRow {
  id: string;
  name?: string;
  host: string;
  enabled: boolean;
  isBackup: boolean;
  priority: number;
  live: ProviderLiveInfo;
  articles: number;
  bytes: number;
  errors: number;
  missing: number;
  avgLatencyMs: number;
  /** bytes / wall-clock busy seconds: the provider's average throughput. */
  avgBytesPerSec: number;
  /** errors / (articles + errors). */
  errorRate: number;
  /** missing / (articles + missing): availability signal. */
  missRate: number;
  /** articles / total articles across providers in the window. */
  articleShare: number;
}

export interface UsenetThroughputPoint {
  bucketMs: number;
  articles: number;
  bytes: number;
  errors: number;
  missing: number;
  avgLatencyMs: number;
  /** Aggregate download rate for the bucket: bytes / wall-clock active time. */
  avgBytesPerSec: number;
}

export interface UsenetStatsOverview {
  window: UsenetStatsWindow;
  generatedAt: number;
  bucketMs: number;
  live: LiveTiles;
  pool: PoolInfo;
  cache: CacheStats;
  totals: {
    articles: number;
    bytes: number;
    errors: number;
    missing: number;
    avgLatencyMs: number;
    /** Aggregate download rate over the window: bytes / wall-clock active time. */
    avgBytesPerSec: number;
  };
  providers: UsenetProviderStatRow[];
  throughput: UsenetThroughputPoint[];
  firstSeenAt?: number;
}

function resolveWindow(window: UsenetStatsWindow): {
  sinceMs: number;
  bucketMs: number;
} {
  const now = Date.now();
  switch (window) {
    case '24h':
      return { sinceMs: now - DAY_MS, bucketMs: HOUR_MS };
    case '7d':
      return { sinceMs: now - 7 * DAY_MS, bucketMs: HOUR_MS };
    case '30d':
      return { sinceMs: now - 30 * DAY_MS, bucketMs: DAY_MS };
    case 'all':
    default:
      return { sinceMs: 0, bucketMs: DAY_MS };
  }
}

function emptyLive(): LiveTiles {
  return {
    activeStreams: 0,
    currentBytesPerSec: 0,
    peakBytesPerSec: 0,
    articlesLastMinute: 0,
    errorsLastMinute: 0,
    bytesLastMinute: 0,
  };
}

function emptyCache(): CacheStats {
  return {
    sizeBytes: 0,
    maxBytes: 0,
    count: 0,
    hits: 0,
    misses: 0,
    hitRate: 0,
    memBytes: 0,
    diskBytes: 0,
    diskCount: 0,
    diskHits: 0,
  };
}

/**
 * Drain in-memory per-provider deltas from every warm engine and fold them into
 * the hourly metrics table. Returns the number of provider deltas persisted.
 */
export async function drainUsenetMetrics(): Promise<number> {
  const merged = new Map<string, UsenetMetricDelta>();
  for (const engine of usenetEngineRegistry.all()) {
    for (const d of engine.drainMetrics()) {
      const cur =
        merged.get(d.providerId) ??
        ({
          providerId: d.providerId,
          articles: 0,
          bytes: 0,
          errors: 0,
          missing: 0,
          sumDurationMs: 0,
          wallClockMs: 0,
        } satisfies UsenetMetricDelta);
      cur.articles += d.articles;
      cur.bytes += d.bytes;
      cur.errors += d.errors;
      cur.missing += d.missing;
      cur.sumDurationMs += d.sumDurationMs;
      // Per-provider wall-clock busy time (union of in-flight fetches).
      cur.wallClockMs += d.wallClockMs;
      merged.set(d.providerId, cur);
    }
  }
  const deltas = [...merged.values()];
  if (deltas.length === 0) return 0;
  await UsenetMetricsRepository.addDeltas(deltas);
  return deltas.length;
}

/** Prune rollups older than `retentionDays`. Returns rows removed. */
export async function pruneUsenetMetrics(
  retentionDays: number
): Promise<number> {
  const cutoff = Date.now() - retentionDays * DAY_MS;
  return UsenetMetricsRepository.pruneOlderThan(cutoff);
}

/** Live tiles + pool snapshot from the warm engine for the configured set. */
export function getUsenetLiveStats(): {
  live: LiveTiles;
  pool: PoolInfo;
  cache: CacheStats;
  streams: LiveStreamInfo[];
} {
  const { providers, options } = getUsenetEngineConfig();
  if (providers.length === 0) {
    return {
      live: emptyLive(),
      pool: { providers: [], globalDownloadsInUse: 0, globalDownloadMax: 0 },
      cache: emptyCache(),
      streams: [],
    };
  }
  const snapshot = usenetEngineRegistry.get(providers, options).liveStats();
  return {
    live: snapshot.tiles,
    pool: snapshot.pool,
    cache: snapshot.cache,
    streams: snapshot.streams,
  };
}

/** Build the full dashboard overview for the given window. */
export async function getUsenetStatsOverview(
  window: UsenetStatsWindow
): Promise<UsenetStatsOverview> {
  const { sinceMs, bucketMs } = resolveWindow(window);
  const configProviders = (settingsStore.current.usenet?.providers ??
    []) as ProviderConfig[];

  const { live, pool, cache } = getUsenetLiveStats();
  const poolById = new Map(pool.providers.map((p) => [p.id, p]));

  const [summary, series, firstSeenAt] = await Promise.all([
    UsenetMetricsRepository.summaryByProvider(sinceMs),
    UsenetMetricsRepository.timeSeries(sinceMs, bucketMs),
    UsenetMetricsRepository.firstHour(),
  ]);
  const summaryById = new Map(summary.map((s) => [s.providerId, s]));

  const totalArticles = summary.reduce((s, p) => s + p.articles, 0);
  const totalBytes = summary.reduce((s, p) => s + p.bytes, 0);
  const totalWallClockMs = summary.reduce((s, p) => s + p.wallClockMs, 0);
  const totalSpeedBytes = summary.reduce((s, p) => s + p.speedBytes, 0);
  const totals = {
    articles: totalArticles,
    bytes: totalBytes,
    errors: summary.reduce((s, p) => s + p.errors, 0),
    missing: summary.reduce((s, p) => s + p.missing, 0),
    avgLatencyMs: (() => {
      const dur = summary.reduce((s, p) => s + p.sumDurationMs, 0);
      return totalArticles > 0 ? Math.round(dur / totalArticles) : 0;
    })(),
    avgBytesPerSec:
      totalWallClockMs > 0
        ? Math.round(totalSpeedBytes / (totalWallClockMs / 1000))
        : 0,
  };

  // Build a row per configured provider (so idle providers still show), plus
  // any provider that appears in metrics but is no longer configured.
  const ids = new Set<string>([
    ...configProviders.map((p) => p.id),
    ...summary.map((s) => s.providerId),
  ]);

  const providers: UsenetProviderStatRow[] = [...ids].map((id) => {
    const cfg = configProviders.find((p) => p.id === id);
    const agg = summaryById.get(id);
    const info = poolById.get(id);
    const articles = agg?.articles ?? 0;
    const errors = agg?.errors ?? 0;
    const missing = agg?.missing ?? 0;
    return {
      id,
      name: cfg?.name,
      host: cfg?.host ?? id,
      enabled: cfg ? cfg.enabled !== false : false,
      isBackup: cfg?.isBackup ?? info?.isBackup ?? false,
      priority: cfg?.priority ?? 0,
      live: {
        state: info?.state ?? (cfg ? 'offline' : 'disabled'),
        active: info?.acquired ?? 0,
        idle: info?.idle ?? 0,
        total: info?.total ?? 0,
        max: info?.max ?? cfg?.maxConnections ?? 0,
        available: info?.available ?? 0,
        tripped: info?.tripped ?? false,
      },
      articles,
      bytes: agg?.bytes ?? 0,
      errors,
      missing,
      avgLatencyMs:
        articles > 0 ? Math.round((agg?.sumDurationMs ?? 0) / articles) : 0,
      avgBytesPerSec:
        agg && agg.wallClockMs > 0
          ? Math.round(agg.speedBytes / (agg.wallClockMs / 1000))
          : 0,
      errorRate: articles + errors > 0 ? errors / (articles + errors) : 0,
      missRate: articles + missing > 0 ? missing / (articles + missing) : 0,
      articleShare: totalArticles > 0 ? articles / totalArticles : 0,
    };
  });

  // Sort by usage desc, keeping configured-but-idle providers after active ones.
  providers.sort((a, b) => b.articles - a.articles || a.priority - b.priority);

  const throughput: UsenetThroughputPoint[] = series.map((b) => ({
    bucketMs: b.bucketMs,
    articles: b.articles,
    bytes: b.bytes,
    errors: b.errors,
    missing: b.missing,
    avgLatencyMs: b.articles > 0 ? Math.round(b.sumDurationMs / b.articles) : 0,
    avgBytesPerSec:
      b.wallClockMs > 0 ? Math.round(b.speedBytes / (b.wallClockMs / 1000)) : 0,
  }));

  return {
    window,
    generatedAt: Date.now(),
    bucketMs,
    live,
    pool,
    cache,
    totals,
    providers,
    throughput,
    firstSeenAt,
  };
}
