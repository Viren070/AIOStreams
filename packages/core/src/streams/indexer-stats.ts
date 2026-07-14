import type { IndexerMetricDelta } from '../db/repositories/indexer-metrics.js';

interface IndexerCounters {
  name: string;
  searches: number;
  results: number;
  errors: number;
  latencyMsSum: number;
  latencySamples: number;
}

/**
 * Process-global in-memory accumulator for per-indexer activity. The stream
 * pipeline records searches (with result counts + latency); a background task
 * drains the deltas to the DB and clears them.
 */
class IndexerStatsAccumulator {
  private byInstance = new Map<string, IndexerCounters>();

  private get(instanceId: string, name: string): IndexerCounters {
    let c = this.byInstance.get(instanceId);
    if (!c) {
      c = {
        name,
        searches: 0,
        results: 0,
        errors: 0,
        latencyMsSum: 0,
        latencySamples: 0,
      };
      this.byInstance.set(instanceId, c);
    }
    if (name) c.name = name;
    return c;
  }

  /** One completed search against an indexer instance. */
  recordSearch(event: {
    instanceId: string;
    name: string;
    results: number;
    latencyMs: number;
    error: boolean;
  }): void {
    const c = this.get(event.instanceId, event.name);
    c.searches++;
    c.results += event.results;
    if (event.error) c.errors++;
    if (event.latencyMs > 0) {
      c.latencyMsSum += event.latencyMs;
      c.latencySamples++;
    }
  }

  /** Return per-indexer counters since the last drain and clear them. */
  drain(): IndexerMetricDelta[] {
    const out: IndexerMetricDelta[] = [];
    for (const [instanceId, c] of this.byInstance) {
      out.push({ instanceId, ...c });
    }
    this.byInstance.clear();
    return out;
  }
}

export const indexerStats = new IndexerStatsAccumulator();
