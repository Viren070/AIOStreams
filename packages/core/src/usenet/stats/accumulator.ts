import {
  LiveStreamInfo,
  LiveTiles,
  ProviderMetricDelta,
  ProviderStatsSnapshot,
  StatsEvent,
} from './types.js';

const MAX_LATENCY_SAMPLES = 10_000;

/** Seconds retained in the live ring buffer. */
const WINDOW_SEC = 60;
/** Trailing window used to compute the "current" download rate. */
const RATE_WINDOW_SEC = 5;

/** Counters since the last DB drain (zeroed on flush). */
interface DeltaCounters {
  articles: number;
  bytes: number;
  errors: number;
  missing: number;
  sumDurationMs: number;
  /** Wall-clock busy ms (union of in-flight fetches), for avg throughput. */
  wallClockMs: number;
}

interface ProviderAccumulator {
  segmentsFetched: number;
  bytesDownloaded: number;
  missingSegments: number;
  connectionErrors: number;
  latencies: number[];
  delta: DeltaCounters;
  /** In-flight article fetches on this provider (for union busy timing). */
  inFlight: number;
  /** Wall-clock start of the current busy interval (inFlight went 0→1). */
  busyStart: number | null;
  /** Accumulated wall-clock busy ms since the last drain. */
  busyMsDelta: number;
}

function emptyAccumulator(): ProviderAccumulator {
  return {
    segmentsFetched: 0,
    bytesDownloaded: 0,
    missingSegments: 0,
    connectionErrors: 0,
    latencies: [],
    delta: {
      articles: 0,
      bytes: 0,
      errors: 0,
      missing: 0,
      sumDurationMs: 0,
      wallClockMs: 0,
    },
    inFlight: 0,
    busyStart: null,
    busyMsDelta: 0,
  };
}

/**
 * Process-global rolling meter over per-second buckets for the live tiles
 * (download rate, articles/errors/bytes in the last minute).
 */
class LiveMeter {
  private bytes = new Float64Array(WINDOW_SEC);
  private articles = new Float64Array(WINDOW_SEC);
  private errors = new Float64Array(WINDOW_SEC);
  private lastSec = Math.floor(Date.now() / 1000);
  private peakBytesPerSec = 0;

  private rotate(): void {
    const now = Math.floor(Date.now() / 1000);
    if (now === this.lastSec) return;
    const gap = Math.min(WINDOW_SEC, now - this.lastSec);
    for (let i = 1; i <= gap; i++) {
      const idx = (((this.lastSec + i) % WINDOW_SEC) + WINDOW_SEC) % WINDOW_SEC;
      this.bytes[idx] = 0;
      this.articles[idx] = 0;
      this.errors[idx] = 0;
    }
    this.lastSec = now;
  }

  record(d: { bytes?: number; articles?: number; errors?: number }): void {
    this.rotate();
    const idx = ((this.lastSec % WINDOW_SEC) + WINDOW_SEC) % WINDOW_SEC;
    if (d.bytes) {
      this.bytes[idx] += d.bytes;
      if (this.bytes[idx] > this.peakBytesPerSec) {
        this.peakBytesPerSec = this.bytes[idx];
      }
    }
    if (d.articles) this.articles[idx] += d.articles;
    if (d.errors) this.errors[idx] += d.errors;
  }

  private sum(arr: Float64Array, secs: number): number {
    let s = 0;
    for (let i = 0; i < secs; i++) {
      const idx = (((this.lastSec - i) % WINDOW_SEC) + WINDOW_SEC) % WINDOW_SEC;
      s += arr[idx];
    }
    return s;
  }

  tiles(): Omit<LiveTiles, 'activeStreams'> {
    this.rotate();
    return {
      currentBytesPerSec: Math.round(
        this.sum(this.bytes, RATE_WINDOW_SEC) / RATE_WINDOW_SEC
      ),
      peakBytesPerSec: Math.round(this.peakBytesPerSec),
      articlesLastMinute: this.sum(this.articles, WINDOW_SEC),
      errorsLastMinute: this.sum(this.errors, WINDOW_SEC),
      bytesLastMinute: this.sum(this.bytes, WINDOW_SEC),
    };
  }
}

/** Time constant (ms) for the per-stream download-rate EMA. */
const STREAM_RATE_TAU_MS = 3_000;

/** One tracked in-flight read stream (live "Streams" view). */
interface LiveStreamRecord {
  id: number;
  nzbHash: string;
  filename?: string;
  size: number;
  start: number;
  bytesServed: number;
  openedAt: number;
  /** Last chunk timestamp, for EMA decay. */
  lastChunkAt: number;
  /** Smoothed download rate, bytes/second. */
  emaBytesPerSec: number;
}

/**
 * In-memory per-provider stats accumulator. Live counters feed the dashboard;
 * a drainer (TaskManager job, service layer) periodically flushes aggregates to
 * the DB and may reset the deltas.
 */
export class StatsAccumulator {
  private providers = new Map<string, ProviderAccumulator>();
  private liveMeter = new LiveMeter();
  private active = 0;
  /** Per-stream registry for the live "Streams" view. */
  private streams = new Map<number, LiveStreamRecord>();
  private streamSeq = 0;

  record(event: StatsEvent): void {
    const acc = this.get(event.providerId);
    switch (event.type) {
      case 'segment_fetched':
        acc.segmentsFetched++;
        acc.bytesDownloaded += event.bytes;
        acc.delta.articles++;
        acc.delta.bytes += event.bytes;
        acc.delta.sumDurationMs += event.durationMs;
        if (acc.latencies.length < MAX_LATENCY_SAMPLES) {
          acc.latencies.push(event.durationMs);
        } else {
          // Reservoir-style overwrite to keep a bounded recent window.
          acc.latencies[acc.segmentsFetched % MAX_LATENCY_SAMPLES] =
            event.durationMs;
        }
        this.liveMeter.record({ bytes: event.bytes, articles: 1 });
        break;
      case 'segment_missing':
        acc.missingSegments++;
        acc.delta.missing++;
        this.liveMeter.record({ errors: 1 });
        break;
      case 'connection_error':
        acc.connectionErrors++;
        acc.delta.errors++;
        this.liveMeter.record({ errors: 1 });
        break;
    }
  }

  /**
   * Register a newly-opened read stream and bump the live active-stream gauge.
   * Returns an id used to report served bytes and to close the stream.
   */
  streamOpened(info: {
    nzbHash: string;
    filename?: string;
    size: number;
    start: number;
  }): number {
    this.active++;
    const id = ++this.streamSeq;
    const now = Date.now();
    this.streams.set(id, {
      id,
      nzbHash: info.nzbHash,
      filename: info.filename,
      size: info.size,
      start: info.start,
      bytesServed: 0,
      openedAt: now,
      lastChunkAt: now,
      emaBytesPerSec: 0,
    });
    return id;
  }

  /** Record bytes pushed to the client for a stream, updating its rate EMA. */
  streamBytes(id: number, bytes: number): void {
    const s = this.streams.get(id);
    if (!s || bytes <= 0) return;
    const now = Date.now();
    const dtMs = now - s.lastChunkAt;
    s.bytesServed += bytes;
    if (dtMs > 0) {
      const instRate = (bytes / dtMs) * 1000;
      const w = Math.exp(-dtMs / STREAM_RATE_TAU_MS);
      s.emaBytesPerSec = s.emaBytesPerSec * w + instRate * (1 - w);
    }
    s.lastChunkAt = now;
  }

  /** Decrement the live active-stream gauge and drop the stream record. */
  streamClosed(id: number): void {
    if (this.active > 0) this.active--;
    this.streams.delete(id);
  }

  /** Snapshot of in-flight read streams, with decayed current rates. */
  liveStreams(): LiveStreamInfo[] {
    const now = Date.now();
    const out: LiveStreamInfo[] = [];
    for (const s of this.streams.values()) {
      // Decay the rate toward 0 for streams that have stalled (player buffer
      // full) so a paused stream doesn't show its last burst speed forever.
      const idle = now - s.lastChunkAt;
      const bytesPerSec = Math.round(
        s.emaBytesPerSec * Math.exp(-Math.max(0, idle) / STREAM_RATE_TAU_MS)
      );
      out.push({
        id: String(s.id),
        nzbHash: s.nzbHash,
        filename: s.filename,
        size: s.size,
        start: s.start,
        bytesServed: s.bytesServed,
        bytesPerSec,
        openedAt: s.openedAt,
      });
    }
    return out.sort((a, b) => a.openedAt - b.openedAt);
  }

  /**
   * Mark the start of an article fetch on a provider. Paired with
   * {@link fetchEnded}; the union of in-flight intervals is the provider's
   * wall-clock busy time, used to derive an honest average download speed
   * (bytes / busy-seconds) that (unlike summed per-segment durations) doesn't
   * scale with connection count.
   */
  fetchStarted(providerId: string): void {
    const acc = this.get(providerId);
    if (acc.inFlight === 0) acc.busyStart = Date.now();
    acc.inFlight++;
  }

  /** Mark the end of an article fetch on a provider (success or failure). */
  fetchEnded(providerId: string): void {
    const acc = this.get(providerId);
    if (acc.inFlight > 0) acc.inFlight--;
    if (acc.inFlight === 0 && acc.busyStart != null) {
      acc.busyMsDelta += Date.now() - acc.busyStart;
      acc.busyStart = null;
    }
  }

  get activeStreams(): number {
    return this.active;
  }

  /** Live "now" tiles for the dashboard. */
  live(): LiveTiles {
    return { activeStreams: this.active, ...this.liveMeter.tiles() };
  }

  /**
   * Return per-provider counters accumulated since the previous drain and zero
   * them. Only providers with activity are returned. Cumulative counters and
   * the live meter are left untouched.
   */
  drain(): ProviderMetricDelta[] {
    const out: ProviderMetricDelta[] = [];
    const now = Date.now();
    for (const [providerId, acc] of this.providers) {
      // Fold any in-progress busy interval into the delta and re-anchor it, so
      // a still-active provider reports its wall-clock time incrementally.
      let busyMs = acc.busyMsDelta;
      acc.busyMsDelta = 0;
      if (acc.busyStart != null) {
        busyMs += now - acc.busyStart;
        acc.busyStart = now;
      }
      const d = acc.delta;
      if (d.articles || d.bytes || d.errors || d.missing) {
        out.push({ providerId, ...d, wallClockMs: busyMs });
        acc.delta = {
          articles: 0,
          bytes: 0,
          errors: 0,
          missing: 0,
          sumDurationMs: 0,
          wallClockMs: 0,
        };
      }
    }
    return out;
  }

  private get(providerId: string): ProviderAccumulator {
    let acc = this.providers.get(providerId);
    if (!acc) {
      acc = emptyAccumulator();
      this.providers.set(providerId, acc);
    }
    return acc;
  }

  snapshot(): ProviderStatsSnapshot[] {
    const out: ProviderStatsSnapshot[] = [];
    for (const [providerId, acc] of this.providers) {
      const sorted = [...acc.latencies].sort((a, b) => a - b);
      const avg =
        sorted.length > 0
          ? sorted.reduce((s, v) => s + v, 0) / sorted.length
          : 0;
      const p95 =
        sorted.length > 0
          ? sorted[
              Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
            ]
          : 0;
      const attempts = acc.segmentsFetched + acc.missingSegments;
      out.push({
        providerId,
        segmentsFetched: acc.segmentsFetched,
        bytesDownloaded: acc.bytesDownloaded,
        missingSegments: acc.missingSegments,
        connectionErrors: acc.connectionErrors,
        avgLatencyMs: Math.round(avg),
        p95LatencyMs: Math.round(p95),
        successRate: attempts > 0 ? acc.segmentsFetched / attempts : 1,
      });
    }
    return out;
  }

  /** Reset all counters (after a drain flush, if deltas are desired). */
  reset(): void {
    this.providers.clear();
  }
}
