import React from 'react';
import { api } from '@/lib/api';

export interface SystemMetrics {
  ts: number;
  cpu: {
    cores: number;
    model: string;
    loadavg: [number, number, number] | null;
    perCore: number[];
    total: number;
    process: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  disk: { path: string; total: number; used: number; free: number } | null;
  process: {
    uptimeSec: number;
    nodeVersion: string;
    pid: number;
    platform: string;
  };
  lifecycleEnabled?: boolean;
  /** Server-side rolling window, present on the initial fetch only. */
  history?: MetricsSample[];
}

/** Rolling-history sample behind the charts. Mirrors the server's shape. */
export interface MetricsSample {
  ts: number;
  cpu: { total: number; process: number; perCore: number[] };
  memory: {
    used: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
}

const toSample = (m: SystemMetrics): MetricsSample => ({
  ts: m.ts,
  cpu: { total: m.cpu.total, process: m.cpu.process, perCore: m.cpu.perCore },
  memory: {
    used: m.memory.used,
    heapUsed: m.memory.heapUsed,
    heapTotal: m.memory.heapTotal,
    external: m.memory.external,
    rss: m.memory.rss,
  },
});

/** Cap on samples retained (5 minutes at ~5s SSE tick = 60 samples; we keep a
 *  bit more headroom so the cap holds across faster manual `setMetrics`). */
const MAX_SAMPLES = 120;
const WINDOW_MS = 5 * 60 * 1000;

/**
 * Live system metrics via SSE plus a 5-minute rolling history used by the
 * dashboard charts. The initial fetch seeds the window from the server's own
 * buffer so the charts open populated; SSE frames extend it from there. Older
 * samples are dropped both by count (`MAX_SAMPLES`) and by age (`WINDOW_MS`)
 * so the chart can't grow unbounded if the SSE connection stalls and
 * reconnects rapidly.
 */
export function useSystemStream() {
  const [metrics, setMetrics] = React.useState<SystemMetrics | null>(null);
  const [connected, setConnected] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [retryNonce, setRetryNonce] = React.useState(0);
  const historyRef = React.useRef<MetricsSample[]>([]);
  const [history, setHistory] = React.useState<MetricsSample[]>([]);

  const pushSamples = React.useCallback((incoming: MetricsSample[]) => {
    // Keyed by `ts` so the seeded window and the first SSE frame, which can
    // describe the same moment, collapse to one point.
    const byTs = new Map(historyRef.current.map((s) => [s.ts, s]));
    for (const s of incoming) byTs.set(s.ts, s);
    const merged = [...byTs.values()].sort((a, b) => a.ts - b.ts);
    const cutoff = (merged.at(-1)?.ts ?? 0) - WINDOW_MS;
    const next = merged.filter((s) => s.ts >= cutoff).slice(-MAX_SAMPLES);
    historyRef.current = next;
    setHistory(next);
  }, []);

  const retry = React.useCallback(() => {
    setError(null);
    setRetryNonce((n) => n + 1);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    api<SystemMetrics>('/dashboard/system')
      .then((m) => {
        if (cancelled) return;
        setMetrics(m);
        setError(null);
        pushSamples([...(m.history ?? []), toSample(m)]);
      })
      .catch((e) => {
        if (cancelled) return;
        // Only surface the error to the UI if we don't already have a sample
        // — once metrics are showing, transient failures are harmless and the
        // SSE stream will re-deliver fresh data on its own.
        setError(
          (prev) =>
            prev ??
            (e instanceof Error ? e.message : 'Failed to load system metrics')
        );
      });

    const es = new EventSource('/api/v1/dashboard/system/stream', {
      withCredentials: true,
    });
    es.onopen = () => {
      setConnected(true);
      setError(null);
    };
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data) as SystemMetrics;
        setMetrics((prev) => ({
          ...m,
          lifecycleEnabled: prev?.lifecycleEnabled,
        }));
        pushSamples([toSample(m)]);
      } catch {
        /* ignore */
      }
    };
    return () => {
      cancelled = true;
      es.close();
    };
  }, [pushSamples, retryNonce]);

  return { metrics, connected, history, windowMs: WINDOW_MS, error, retry };
}
