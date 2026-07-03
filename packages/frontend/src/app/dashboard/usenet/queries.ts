import React from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { SettingsKey } from '../settings/queries';

export type UsenetWindow = '24h' | '7d' | '30d' | 'all';

/** Sentinel sent back in place of an unchanged provider password. */
export const PROVIDER_SECRET_MASK = '__stored__';

export type ProviderState =
  | 'online'
  | 'connecting'
  | 'offline'
  | 'auth_failed'
  | 'disabled';

export interface LiveTiles {
  activeStreams: number;
  currentBytesPerSec: number;
  peakBytesPerSec: number;
  articlesLastMinute: number;
  errorsLastMinute: number;
  bytesLastMinute: number;
}

export interface ProviderPoolInfo {
  id: string;
  name?: string;
  state: ProviderState;
  total: number;
  idle: number;
  acquired: number;
  available: number;
  max: number;
  tripped: boolean;
  isBackup: boolean;
  freeSlots: number;
  throughput: number;
}

export interface PoolInfo {
  providers: ProviderPoolInfo[];
  globalDownloadsInUse: number;
  globalDownloadMax: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  diskBytes: number;
  diskCount: number;
  diskHits: number;
}

export interface ProviderLiveInfo {
  state: ProviderState;
  active: number;
  idle: number;
  total: number;
  max: number;
  available: number;
  tripped: boolean;
}

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
  avgBytesPerSec: number;
  errorRate: number;
  missRate: number;
  articleShare: number;
}

export interface UsenetThroughputPoint {
  bucketMs: number;
  articles: number;
  bytes: number;
  errors: number;
  missing: number;
  avgLatencyMs: number;
  avgBytesPerSec: number;
}

export interface UsenetStatsOverview {
  window: UsenetWindow;
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
    avgBytesPerSec: number;
  };
  providers: UsenetProviderStatRow[];
  throughput: UsenetThroughputPoint[];
  firstSeenAt?: number;
}

/** One in-flight read stream for the live "Streams" view. */
export interface LiveStreamInfo {
  id: string;
  nzbHash: string;
  filename?: string;
  size: number;
  start: number;
  bytesServed: number;
  bytesPerSec: number;
  openedAt: number;
}

export interface LiveStats {
  live: LiveTiles;
  pool: PoolInfo;
  cache: CacheStats;
  streams: LiveStreamInfo[];
}

export interface MaskedProvider {
  id: string;
  name?: string;
  host: string;
  port: number;
  tls: boolean;
  tlsSkipVerify?: boolean;
  username?: string;
  maxConnections: number;
  pipelineDepth?: number;
  priority: number;
  isBackup?: boolean;
  enabled?: boolean;
  hasPassword: boolean;
}

export interface ProviderTestResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  code?: string;
}

export interface ProviderSpeedTestResult {
  ok: boolean;
  bytesPerSec?: number;
  bytes?: number;
  durationMs?: number;
  segments?: number;
  pipelineDepth?: number;
  connections?: number;
  error?: string;
  code?: string;
}

export interface LibraryFile {
  name?: string;
  size: number;
  index?: number;
  path?: string;
  category?: string;
  streamable?: boolean;
}

export type LibraryStatus =
  | 'queued'
  | 'inspecting'
  | 'available'
  | 'degraded'
  | 'failed';

export type LibraryStatusGroup = 'active' | 'history' | 'all';

export type LibrarySort = 'activity' | 'added' | 'name' | 'size';
export type LibrarySortDir = 'asc' | 'desc';

export interface LibraryEntry {
  nzbHash: string;
  name?: string;
  size?: number;
  fileIndex?: number;
  files: LibraryFile[];
  status: LibraryStatus;
  failReason?: string;
  errorCode?: string;
  failCount: number;
  addedAt: string;
  lastUsedAt: string;
  progress: number;
  bytesDone: number;
  bytesTotal: number;
  owner?: string;
  source: 'auto' | 'manual';
  importMs?: number;
  nzbUrl?: string;
  category?: string;
  password?: string;
}

const ROOT = ['dashboard', 'usenet'] as const;

export function useUsenetStats(window: UsenetWindow) {
  return useQuery({
    queryKey: [...ROOT, 'stats', window],
    queryFn: () =>
      api<UsenetStatsOverview>(`/dashboard/usenet/stats?window=${window}`),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useUsenetLive(enabled = true) {
  return useQuery({
    queryKey: [...ROOT, 'live'],
    queryFn: () => api<LiveStats>('/dashboard/usenet/live'),
    refetchInterval: 4_000,
    enabled,
  });
}

export function useUsenetProviders() {
  return useQuery({
    queryKey: [...ROOT, 'providers'],
    queryFn: () =>
      api<{ providers: MaskedProvider[] }>('/dashboard/usenet/providers'),
    staleTime: 10_000,
  });
}

export function useSaveProviders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (providers: unknown[]) =>
      api<{ providers: MaskedProvider[] }>('PUT /dashboard/usenet/providers', {
        body: { providers },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...ROOT, 'providers'] });
      qc.invalidateQueries({ queryKey: [...ROOT, 'stats'] });
    },
  });
}

export function useTestProvider() {
  return useMutation({
    mutationFn: (provider: Record<string, unknown>) =>
      api<ProviderTestResult>('POST /dashboard/usenet/providers/test', {
        body: provider,
      }),
  });
}

export function useSpeedTestProvider() {
  return useMutation({
    mutationFn: (id: string) =>
      api<ProviderSpeedTestResult>(
        `POST /dashboard/usenet/providers/${encodeURIComponent(id)}/speedtest`
      ),
  });
}

// --- Engine settings (the bespoke usenet Settings tab) ----------------------

/** Concrete values a performance profile applies (matches core PERFORMANCE_PROFILES). */
export interface UsenetProfilePreset {
  prefetchSegments: number;
  maxConcurrentDownloads: number;
  segmentDiskCacheBytes: number;
}
export type UsenetProfiles = Record<string, UsenetProfilePreset>;

export function useUsenetSettings() {
  return useQuery({
    queryKey: [...ROOT, 'settings'],
    queryFn: () =>
      api<{ keys: SettingsKey[]; profiles: UsenetProfiles }>(
        '/dashboard/usenet/settings'
      ),
    staleTime: 10_000,
  });
}

export function useSaveUsenetSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api<{ updated: string[]; requiresRestart: boolean }>(
        'PATCH /dashboard/usenet/settings',
        { body: patch }
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ROOT, 'settings'] }),
  });
}

export function useUsenetLibrary(opts: {
  limit?: number;
  offset?: number;
  status?: LibraryStatusGroup;
  /** Explicit status filter; takes precedence over `status` (group) server-side. */
  statuses?: LibraryStatus[];
  /** Case-insensitive substring match against the entry name. */
  search?: string;
  /** Sort field (defaults to recent activity server-side). */
  sort?: LibrarySort;
  /** Sort direction (defaults to desc server-side). */
  dir?: LibrarySortDir;
}) {
  const {
    limit = 50,
    offset = 0,
    status = 'all',
    statuses = [],
    search = '',
    sort,
    dir,
  } = opts;
  const statusesCsv = [...statuses].sort().join(',');
  const trimmedSearch = search.trim();
  const qs = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    status,
  });
  if (statusesCsv) qs.set('statuses', statusesCsv);
  if (trimmedSearch) qs.set('q', trimmedSearch);
  if (sort) qs.set('sort', sort);
  if (dir) qs.set('dir', dir);
  return useQuery({
    queryKey: [
      ...ROOT,
      'library',
      limit,
      offset,
      status,
      statusesCsv,
      trimmedSearch,
      sort ?? '',
      dir ?? '',
    ],
    queryFn: () =>
      api<{ entries: LibraryEntry[]; total: number }>(
        `/dashboard/usenet/library?${qs.toString()}`
      ),
    // Keep the previous page on screen while the next loads so `total` never
    // momentarily collapses (which used to snap the page selector back).
    placeholderData: keepPreviousData,
    // Freshness is driven by the SSE library stream (see useUsenetLibraryStream),
    // so there's no polling here.
    staleTime: 10_000,
  });
}

/**
 * Subscribe to the server-pushed library change stream (SSE) and refetch the
 * library queries whenever an entry is added, transitions, or is removed. This
 * replaces polling — the list updates the instant the engine changes anything.
 */
export function useUsenetLibraryStream() {
  const qc = useQueryClient();
  React.useEffect(() => {
    const es = new EventSource('/api/v1/dashboard/usenet/library/stream', {
      withCredentials: true,
    });
    es.onmessage = () => {
      void qc.invalidateQueries({ queryKey: [...ROOT, 'library'] });
    };
    // Browsers auto-reconnect SSE on transient errors; nothing to do here.
    return () => es.close();
  }, [qc]);
}

export function useUsenetNzbFiles(hash: string | null) {
  return useQuery({
    queryKey: [...ROOT, 'library', 'files', hash],
    enabled: !!hash,
    queryFn: () =>
      api<{ hash: string; name?: string; files: LibraryFile[] }>(
        `/dashboard/usenet/library/${encodeURIComponent(hash as string)}/files`
      ),
  });
}

export function useAddNzb() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { url: string; name?: string }) =>
      api<LibraryEntry>('POST /dashboard/usenet/library', { body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ROOT, 'library'] }),
  });
}

/** Import a raw .nzb file (uploaded via the dropzone) as multipart. */
export function useUploadNzb() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { file: File; name?: string }) => {
      const fd = new FormData();
      fd.append('file', input.file, input.file.name);
      if (input.name) fd.append('name', input.name);
      return api<LibraryEntry>('POST /dashboard/usenet/library/upload', {
        body: fd,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ROOT, 'library'] }),
  });
}

/** Fetch a short-lived play (or download) URL for a library file. */
export function usePlayUrl() {
  return useMutation({
    mutationFn: (input: {
      hash: string;
      fileSel?: string;
      download?: boolean;
    }) => {
      const action = input.download ? 'download' : 'play';
      const sel = input.fileSel ? `/${encodeURIComponent(input.fileSel)}` : '';
      return api<{ url: string; filename: string }>(
        `/dashboard/usenet/library/${encodeURIComponent(input.hash)}/${action}${sel}`
      );
    },
  });
}

/**
 * Same-origin URL that downloads the raw NZB for a library entry (dashboard
 * session cookie authorises it). Handy for entries that failed because their
 * articles are missing on every provider.
 */
export function usenetNzbExportUrl(hash: string): string {
  return `/api/v1/dashboard/usenet/library/${encodeURIComponent(hash)}/nzb`;
}

export function useDeleteLibraryEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (hash: string) =>
      api(`DELETE /dashboard/usenet/library/${encodeURIComponent(hash)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ROOT, 'library'] }),
  });
}

export function useDeleteAllLibraryEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('DELETE /dashboard/usenet/library'),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ROOT, 'library'] }),
  });
}
