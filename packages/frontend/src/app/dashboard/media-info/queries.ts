import React from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  MediaInfoFile,
  MediaInfoKind,
  MediaInfoSummary,
  ProbeAttempt,
  ProbeOutcome,
  ProbePath,
  ProberSnapshot,
} from '@aiostreams/core';
import { api } from '@/lib/api';

export type {
  MediaInfoKind,
  MediaInfoSummary,
  ProbeAttempt,
  ProbeOutcome,
  ProbePath,
  ProberSnapshot,
};
export type { ProbeJob, MediaInfoRecord } from '@aiostreams/core';

export type ProbedFile = MediaInfoFile;

interface Page<T> {
  items: T[];
  total: number;
  /** More rows exist than were counted. */
  capped: boolean;
}

const REFETCH_GAP_MS = 5_000;

const ROOT = ['dashboard', 'media-info'] as const;
const LIVE_KEY = [...ROOT, 'live'] as const;

export function useMediaInfoSummary() {
  return useQuery({
    queryKey: [...ROOT, 'summary'],
    queryFn: () => api<MediaInfoSummary>('/dashboard/media-info'),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

/**
 * The probe queue, pushed over SSE. A `finished` event refetches the totals
 * and both logs, so a probe shows up everywhere as it lands.
 */
export function useMediaInfoLive() {
  const qc = useQueryClient();
  React.useEffect(() => {
    const es = new EventSource('/api/v1/dashboard/media-info/live/stream', {
      withCredentials: true,
    });
    es.onmessage = (e) => {
      try {
        qc.setQueryData(LIVE_KEY, JSON.parse(e.data) as ProberSnapshot);
      } catch {
        /* ignore a malformed frame */
      }
    };
    // A busy instance finishes probes back to back; refetch once per gap.
    let timer: ReturnType<typeof setTimeout> | undefined;
    es.addEventListener('finished', () => {
      timer ??= setTimeout(() => {
        timer = undefined;
        for (const part of ['summary', 'probes', 'files']) {
          void qc.invalidateQueries({ queryKey: [...ROOT, part] });
        }
      }, REFETCH_GAP_MS);
    });
    return () => {
      es.close();
      if (timer) clearTimeout(timer);
    };
  }, [qc]);
  return useQuery({
    queryKey: LIVE_KEY,
    queryFn: () => api<ProberSnapshot>('/dashboard/media-info/live'),
    staleTime: Infinity,
  });
}

function pageQuery(params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') qs.set(key, String(value));
  }
  return qs.toString();
}

export function useProbeAttempts(opts: {
  limit: number;
  offset: number;
  outcome?: ProbeOutcome;
  path?: ProbePath;
  kind?: MediaInfoKind;
  search: string;
}) {
  const q = opts.search.trim();
  const qs = pageQuery({
    limit: opts.limit,
    offset: opts.offset,
    outcome: opts.outcome,
    path: opts.path,
    kind: opts.kind,
    q,
  });
  return useQuery({
    queryKey: [...ROOT, 'probes', qs],
    queryFn: () =>
      api<Page<ProbeAttempt>>(`/dashboard/media-info/probes?${qs}`),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

export function useProbedFiles(opts: {
  limit: number;
  offset: number;
  search: string;
  nzb?: string;
  kind?: MediaInfoKind;
  origin?: string;
}) {
  const q = opts.search.trim();
  const qs = pageQuery({
    limit: opts.limit,
    offset: opts.offset,
    q,
    nzb: opts.nzb,
    kind: opts.kind,
    origin: opts.origin,
  });
  return useQuery({
    queryKey: [...ROOT, 'files', qs],
    queryFn: () => api<Page<ProbedFile>>(`/dashboard/media-info/files?${qs}`),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

export function useCancelProbe() {
  return useMutation({
    mutationFn: (id: string) =>
      api<{ cancelled: boolean }>(
        `POST /dashboard/media-info/jobs/${encodeURIComponent(id)}/cancel`
      ),
  });
}
