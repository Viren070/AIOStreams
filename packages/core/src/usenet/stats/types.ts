/** Aggregated, derived stats for a single provider. */
export interface ProviderStatsSnapshot {
  providerId: string;
  segmentsFetched: number;
  bytesDownloaded: number;
  missingSegments: number;
  connectionErrors: number;
  /** Mean segment fetch latency in ms (over the retained sample window). */
  avgLatencyMs: number;
  /** 95th percentile segment fetch latency in ms. */
  p95LatencyMs: number;
  /** segmentsFetched / (segmentsFetched + missingSegments). */
  successRate: number;
}

export type StatsEvent =
  | {
      type: 'segment_fetched';
      providerId: string;
      bytes: number;
      durationMs: number;
    }
  | { type: 'segment_missing'; providerId: string }
  | { type: 'connection_error'; providerId: string };

/** Live, recent-window counters for the dashboard "now" tiles. */
export interface LiveTiles {
  /** Concurrent open read streams (active playbacks). */
  activeStreams: number;
  /** Download rate over a short trailing window, bytes/second. */
  currentBytesPerSec: number;
  /** Highest per-second rate observed this process lifetime. */
  peakBytesPerSec: number;
  /** Successful article fetches in the last 60s. */
  articlesLastMinute: number;
  /** Errors (transient + missing) in the last 60s. */
  errorsLastMinute: number;
  /** Bytes downloaded in the last 60s. */
  bytesLastMinute: number;
}

/**
 * One in-flight read stream (active playback/download range) for the dashboard's
 * live "Streams" view. Built from the per-stream registry; no DB join.
 */
export interface LiveStreamInfo {
  /** Monotonic id within the engine process (stringified for the UI). */
  id: string;
  /** Content hash of the NZB being streamed (links to the library entry). */
  nzbHash: string;
  /** Best-effort file name of the streamed file. */
  filename?: string;
  /** Decoded size of the streamed file in bytes (0 when unknown). */
  size: number;
  /** Byte offset the served range began at. */
  start: number;
  /** Bytes pushed to the client so far for this range. */
  bytesServed: number;
  /** Recent download rate for this stream, bytes/second (short EMA). */
  bytesPerSec: number;
  /** Epoch ms when the range stream opened. */
  openedAt: number;
}

/**
 * Per-provider counters accumulated since the last DB drain. Flushed by the
 * rollup task into the hourly metrics table, then zeroed.
 */
export interface ProviderMetricDelta {
  providerId: string;
  articles: number;
  bytes: number;
  errors: number;
  missing: number;
  /** Sum of successful fetch durations (ms); divide by articles for avg. */
  sumDurationMs: number;
  /**
   * Wall-clock busy ms (union of in-flight fetches) for this provider since the
   * last drain. `bytes / (wallClockMs/1000)` is the provider's true average
   * throughput, independent of how many connections ran in parallel.
   */
  wallClockMs: number;
}
