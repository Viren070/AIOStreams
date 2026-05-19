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
}

/** Rolling-history sample for the CPU chart. */
export interface CpuSample {
  ts: number;
  total: number;
  process: number;
  perCore: number[];
}

/** Cap on samples retained (5 minutes at ~5s SSE tick = 60 samples; we keep a
 *  bit more headroom so the cap holds across faster manual `setMetrics`). */
const MAX_SAMPLES = 120;
const WINDOW_MS = 5 * 60 * 1000;

/**
 * Live system metrics via SSE plus a 5-minute rolling history used by the
 * dashboard CPU chart. Older samples are dropped both by count (`MAX_SAMPLES`)
 * and by age (`WINDOW_MS`) so the chart can't grow unbounded if the SSE
 * connection stalls and reconnects rapidly.
 */
export function useSystemStream() {
  const [metrics, setMetrics] = React.useState<SystemMetrics | null>(null);
  const [connected, setConnected] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [retryNonce, setRetryNonce] = React.useState(0);
  const historyRef = React.useRef<CpuSample[]>([]);
  const [history, setHistory] = React.useState<CpuSample[]>([]);

  const pushSample = React.useCallback((m: SystemMetrics) => {
    const sample: CpuSample = {
      ts: m.ts,
      total: m.cpu.total,
      process: m.cpu.process,
      perCore: m.cpu.perCore,
    };
    const cutoff = Date.now() - WINDOW_MS;
    const next = [...historyRef.current, sample]
      .filter((s) => s.ts >= cutoff)
      .slice(-MAX_SAMPLES);
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
        pushSample(m);
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
        pushSample(m);
      } catch {
        /* ignore */
      }
    };
    return () => {
      cancelled = true;
      es.close();
    };
  }, [pushSample, retryNonce]);

  return { metrics, connected, history, windowMs: WINDOW_MS, error, retry };
}
