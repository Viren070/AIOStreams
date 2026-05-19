import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { LogRecord } from '@aiostreams/core';

export interface LogRow {
  seq: number;
  time: string;
  level: string;
  module?: string;
  msg: string;
  raw: string;
  obj: Record<string, unknown>;
}

export interface LogFilters {
  q: string;
  regex: boolean;
  levels: string[];
  module?: string;
}

const MAX_ROWS = 10000;
const SNAPSHOT_LIMIT = 2000;

function parseLine(seq: number, raw: string): LogRow {
  let obj: Record<string, unknown> = {};
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { seq, time: '', level: 'info', msg: raw, raw, obj: {} };
  }
  const { level, time, module, msg, ...rest } = obj as Record<string, unknown>;
  return {
    seq,
    time: typeof time === 'string' ? time : '',
    level: typeof level === 'string' ? level : 'info',
    module: typeof module === 'string' ? module : undefined,
    msg: typeof msg === 'string' ? msg : '',
    raw,
    obj: rest,
  };
}

function buildQuery(f: LogFilters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.q.trim() && f.regex) p.set('regex', 'true');
  if (f.levels.length) p.set('level', f.levels.join(','));
  if (f.module) p.set('module', f.module);
  return p.toString();
}

/**
 * Loads a snapshot from the ring buffer, then live-tails via SSE. Filters are
 * applied server-side; changing them resets the view and reconnects. The
 * client keeps at most {@link MAX_ROWS} rows to bound DOM-state memory (the
 * full searchable history lives server-side in the ring).
 */
export function useLogStream(filters: LogFilters) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const lastSeqRef = useRef(0);

  const key = buildQuery(filters);
  const retry = useCallback(() => setRetryCount((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    setLoading(true);
    setError(null);
    setRows([]);
    lastSeqRef.current = 0;

    (async () => {
      try {
        const qs = key ? `&${key}` : '';
        const data = await api<{
          logs: LogRecord[];
          nextSeq: number;
        }>(`/dashboard/logs?order=asc&limit=${SNAPSHOT_LIMIT}${qs}`);
        if (cancelled) return;
        const initial = data.logs.map((r) => parseLine(r.seq, r.line));
        setRows(initial);
        lastSeqRef.current = initial.length
          ? initial[initial.length - 1].seq
          : data.nextSeq;
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Failed to load logs');
      } finally {
        if (!cancelled) setLoading(false);
      }

      if (cancelled) return;
      const sinceQs = `since=${lastSeqRef.current}${key ? `&${key}` : ''}`;
      es = new EventSource(`/api/v1/dashboard/logs/stream?${sinceQs}`, {
        withCredentials: true,
      });
      es.onopen = () => !cancelled && setConnected(true);
      es.onerror = () => !cancelled && setConnected(false);
      es.onmessage = (ev) => {
        if (cancelled || !ev.data) return;
        const seq = Number(ev.lastEventId);
        if (Number.isFinite(seq) && seq <= lastSeqRef.current) return;
        if (Number.isFinite(seq)) lastSeqRef.current = seq;
        const row = parseLine(seq || lastSeqRef.current, ev.data);
        setRows((prev) => {
          const next = prev.length >= MAX_ROWS ? prev.slice(1) : prev.slice();
          next.push(row);
          return next;
        });
      };
    })();

    return () => {
      cancelled = true;
      es?.close();
      setConnected(false);
    };
  }, [key, retryCount]);

  const clear = useCallback(() => setRows([]), []);

  return { rows, loading, connected, error, clear, retry };
}

export function exportUrl(filters: LogFilters, format: 'log' | 'json'): string {
  const q = buildQuery(filters);
  return `/api/v1/dashboard/logs/export?format=${format}${q ? `&${q}` : ''}`;
}
