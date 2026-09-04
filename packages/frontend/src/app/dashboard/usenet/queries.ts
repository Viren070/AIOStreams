import React from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

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
  throttled: boolean;
  isBackup: boolean;
  freeSlots: number;
  throughput: number;
  /** Requests waiting in the pool's queues (not yet on a connection). */
  queued: number;
  /** Epoch ms of the last successful dial; undefined if never dialed. */
  lastDialOkAt?: number;
  /** Most recent failed dial attempt (not cleared by later successes). */
  lastDialError?: { at: number; kind: string; message: string };
}

export interface PoolInfo {
  providers: ProviderPoolInfo[];
  globalDownloadsInUse: number;
  globalDownloadMax: number;
  /** In-use permits whose transfer has actually started on a connection. */
  globalDownloadsOnWire: number;
  /** Fetches still waiting for a semaphore permit (e.g. prefetch bursts). */
  globalDownloadsWaiting: number;
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
  avgLatencyMs: number | null;
  avgArticleMs: number;
  avgBytesPerSec: number;
  errorRate: number;
  missRate: number;
  articleShare: number;
  removed: boolean;
}

export interface UsenetThroughputPoint {
  bucketMs: number;
  articles: number;
  bytes: number;
  errors: number;
  missing: number;
  avgLatencyMs: number | null;
  avgBytesPerSec: number;
}

/** Per-indexer grab aggregates over the window (import-time outcomes only). */
export interface UsenetIndexerStatRow {
  indexer: string;
  grabs: number;
  ok: number;
  degraded: number;
  failed: number;
  failedMissing: number;
  failedFetch: number;
  fetchAuth: number;
  fetchLimited: number;
  successRate: number;
  grabShare: number;
  avgGrabMs: number | null;
  avgImportMs: number | null;
  lastError?: { status?: number; message: string; atMs: number };
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
    avgLatencyMs: number | null;
    avgArticleMs: number;
    avgBytesPerSec: number;
  };
  providers: UsenetProviderStatRow[];
  indexers: UsenetIndexerStatRow[];
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
  /**
   * The server's sampling interval, present only on streamed frames.
   */
  tickMs?: number;
}

/** Ease window when no frame has arrived yet. */
export const LIVE_FRAME_FALLBACK_MS = 500;

/** How long the UI should take to ease from the last live frame to this one. */
export function liveFrameMs(d: LiveStats | undefined): number {
  return d?.tickMs ?? LIVE_FRAME_FALLBACK_MS;
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
  releaseKey?: string;
  blocked?: boolean;
  origin: 'playback' | 'dashboard' | 'sabnzbd';
  /** Earliest NZB post date, epoch seconds. */
  postedAt?: number;
  completedAt?: number;
  lastCheckedAt?: number;
  nextCheckAt?: number;
  checkCount: number;
  /** Set once an arr imported the entry and removed it from its queue. */
  hiddenAt?: number;
  /** Which arr grabbed this, and how replacing it has gone. */
  arrLink?: ArrLink;
}

export type ArrRepairState =
  | 'pending'
  | 'blocklisted'
  | 'searched'
  | 'done'
  | 'failed';

export interface ArrRepair {
  state: ArrRepairState;
  reason: 'failed' | 'degraded';
  attempts: number;
  lastAt?: number;
  nextAt: number;
  lastError?: string;
}

export interface ArrLink {
  instanceId: string;
  downloadId: string;
  grabId?: number;
  parentId?: number;
  linkedAt: number;
  importedAt?: number;
  importedPaths?: string[];
  repair?: ArrRepair;
}

/** Outcomes `POST /dashboard/arr/repairs/:hash` can report. */
export type RepairOutcome =
  | 'repaired'
  | 'already-handled'
  | 'not-linked'
  | 'deferred'
  | 'failed';

/**
 * Every blocklist key a library entry is known by: the portable `wd1:`
 * fingerprint (when the search recorded one) plus the exact-post `nh1:`
 * content hash that parsed rows are keyed under.
 */
export function releaseBlocklistKeys(e: LibraryEntry): string[] {
  const keys: string[] = [];
  if (e.releaseKey) keys.push(e.releaseKey);
  if (/^[0-9a-f]{40}$/.test(e.nzbHash)) keys.push(`nh1:${e.nzbHash}`);
  return keys;
}

const ROOT = ['dashboard', 'usenet'] as const;

const USENET_PERFORMANCE_PROFILES_QUERY_KEY = [...ROOT, 'settings'] as const;

export type UsenetStatsResetTarget = 'providers' | 'indexers' | 'all';

export interface UsenetStatsResetInput {
  target: UsenetStatsResetTarget;
  /** Provider id or indexer label; omit to reset every row of that kind. */
  id?: string;
  /** Inclusive lower bound on the hour bucket. */
  sinceMs?: number;
  /** Report what would be removed without removing it. */
  dryRun?: boolean;
}

export interface UsenetStatsResetResult {
  dryRun: boolean;
  providerRows: number;
  providerArticles: number;
  providerBytes: number;
  indexerRows: number;
  indexerGrabs: number;
  lastErrorRows: number;
}

export function useUsenetStats(window: UsenetWindow) {
  return useQuery({
    queryKey: [...ROOT, 'stats', window],
    queryFn: () =>
      api<UsenetStatsOverview>(`/dashboard/usenet/stats?window=${window}`),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

const LIVE_QUERY_KEY = [...ROOT, 'live'] as const;

/**
 * The live stream is shared: `useUsenetLive` can mount in more than one place,
 * and browsers cap concurrent connections per host, so refcount a single
 * EventSource instead of opening one per consumer.
 */
let liveSource: EventSource | null = null;
let liveRefs = 0;

function subscribeLive(qc: QueryClient): () => void {
  liveRefs++;
  if (!liveSource) {
    liveSource = new EventSource('/api/v1/dashboard/usenet/live/stream', {
      withCredentials: true,
    });
    // Browsers auto-reconnect SSE on transient errors; nothing to do on error.
    liveSource.onmessage = (e) => {
      try {
        qc.setQueryData(LIVE_QUERY_KEY, JSON.parse(e.data) as LiveStats);
      } catch {
        /* ignore a malformed frame */
      }
    };
  }
  return () => {
    if (--liveRefs > 0) return;
    liveSource?.close();
    liveSource = null;
  };
}

export function useUsenetLive(enabled = true) {
  const qc = useQueryClient();
  React.useEffect(() => {
    if (!enabled) return;
    return subscribeLive(qc);
  }, [qc, enabled]);
  return useQuery({
    queryKey: LIVE_QUERY_KEY,
    queryFn: () => api<LiveStats>('/dashboard/usenet/live'),
    staleTime: Infinity,
    enabled,
  });
}

export function useUsenetGlance() {
  return useQuery({
    queryKey: [...ROOT, 'live', 'glance'] as const,
    queryFn: () => api<LiveStats>('/dashboard/usenet/live'),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

/**
 * Wipe recorded rollups.
 */
export function useResetUsenetStats() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UsenetStatsResetInput) =>
      api<UsenetStatsResetResult>('POST /dashboard/usenet/stats/reset', {
        body: { confirm: true, ...input },
      }),
    onSuccess: (_data, input) => {
      if (!input.dryRun) qc.invalidateQueries({ queryKey: [...ROOT, 'stats'] });
    },
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

// --- Performance profiles ----------------------------------------------------
/** Concrete values a performance profile applies (matches core PERFORMANCE_PROFILES). */
export interface UsenetProfilePreset {
  prefetchSegments: number;
  maxConcurrentDownloads: number;
  segmentDiskCacheBytes: number;
}
export type UsenetProfiles = Record<string, UsenetProfilePreset>;

export function useUsenetPerformanceProfiles(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: USENET_PERFORMANCE_PROFILES_QUERY_KEY,
    queryFn: () =>
      api<{ profiles: UsenetProfiles }>('/dashboard/usenet/settings'),
    staleTime: 10_000,
    enabled: opts?.enabled ?? true,
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

/**
 * Mark library entries' releases dead on this instance's blocklist, each under
 * every key it is known by. Entries with no blocklist key are dropped, so the
 * caller must ensure at least one entry has keys. Refetches the library (for
 * the `blocked` flag) and the blocklist pages.
 */
export function useBlockRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entries: LibraryEntry[]) =>
      api('POST /dashboard/blocklist/mark', {
        body: {
          releases: entries
            .map(releaseBlocklistKeys)
            .filter((keys) => keys.length > 0),
          verdict: 'dead',
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...ROOT, 'library'] });
      qc.invalidateQueries({ queryKey: ['dashboard', 'blocklist'] });
    },
  });
}

/**
 * The inverse of {@link useBlockRelease}: drops this instance's verdict for
 * every key the entries are known by and writes an override so remote lists
 * stop filtering them too.
 */
export function useUnblockRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entries: LibraryEntry[]) =>
      api('POST /dashboard/blocklist/unmark', {
        body: {
          releases: entries
            .map(releaseBlocklistKeys)
            .filter((keys) => keys.length > 0),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...ROOT, 'library'] });
      qc.invalidateQueries({ queryKey: ['dashboard', 'blocklist'] });
    },
  });
}

export interface RequeueResult {
  requeued: number;
  failed: number;
  /** The first failure's message, when any entry failed. */
  error?: string;
}

/**
 * Re-import library entries: each source NZB is re-fetched and pushed back
 * through the inspect queue, replacing the existing row. Partial failures come
 * back in the result rather than as a rejection.
 */
export function useRequeueEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (hashes: string[]) =>
      api<RequeueResult>('POST /dashboard/usenet/library/requeue', {
        body: { hashes },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ROOT, 'library'] }),
  });
}

/**
 * Replace a dead release through the arr that grabbed it: the imported file
 * record is removed and the grab marked failed, so the arr blocklists it and
 * looks again. Safe to run twice: every step re-reads the arr's own state.
 */
export function useRepairEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (hash: string) =>
      api<{ outcome: RepairOutcome }>(
        `POST /dashboard/arr/repairs/${encodeURIComponent(hash)}`
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ROOT, 'library'] }),
  });
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
