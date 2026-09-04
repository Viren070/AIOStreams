import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

export type SettingsUiKind =
  | 'boolean'
  | 'number'
  | 'string'
  | 'enum'
  | 'list'
  | 'map'
  | 'boolOrList'
  | 'duration'
  | 'size'
  | 'json';

export interface SettingsUiHint {
  /** Auto-classified or schema-overridden kind. May be forced by a schema's
   *  `ui.kind` override when the zod union doesn't classify cleanly. */
  kind: SettingsUiKind;
  options?: string[];
  mapValueKind?:
    | 'string'
    | 'number'
    | 'boolean'
    | 'numberOrBool'
    | 'size'
    | 'json';
  /** Hint for `KeyValueListField` column ratio (default `equal`). */
  mapWidth?: 'equal' | 'wide-key' | 'wide-value';
  /** When `kind === 'string'`, render a textarea instead of single-line input
   *  (e.g. multi-line env-style credentials). */
  multiline?: boolean;
  /** For `number` fields - minimum allowed value (default: 0). */
  min?: number;
  /** For `number` fields - maximum allowed value (default: unbounded). */
  max?: number;
  /** For `number` fields - step size (default: 1). */
  step?: number;
}

export interface SettingsKey {
  key: string;
  label: string;
  description: string;
  env: string | null;
  requiresRestart: boolean;
  secret: boolean;
  valueType: string;
  default: unknown;
  source: 'environment' | 'database' | 'default';
  value: unknown;
  secretSet: boolean;
  ui: SettingsUiHint;
  /** Present when the field is deprecated (only served while an override is
   *  active); the migration guidance to show. */
  deprecated?: string;
}

/**
 * A key owned by a bespoke editor (`SETTINGS_EDITORS`). It never renders as
 * a field, so the payload carries no value, only whether it still matches
 * its default, which is all the reset modal needs to offer it.
 */
export interface ManagedSettingsKey {
  key: string;
  label: string;
  source: SettingsKey['source'];
  requiresRestart: boolean;
  isDefault: boolean;
}

/** Query key for the generic settings page. */
export const SETTINGS_QUERY_KEY = ['dashboard', 'settings'] as const;
const KEY = SETTINGS_QUERY_KEY;

const DASHBOARD_SCOPE = ['dashboard'] as const;

export function useSettings(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: KEY,
    queryFn: () =>
      api<{ keys: SettingsKey[]; managed?: ManagedSettingsKey[] }>(
        '/dashboard/settings'
      ),
    staleTime: 10_000,
    enabled: opts?.enabled ?? true,
  });
}

export interface PatchResult {
  updated: string[];
  requiresRestart: boolean;
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api<PatchResult>('PATCH /dashboard/settings', { body: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: DASHBOARD_SCOPE }),
  });
}

export interface ResetResult {
  reset: string[];
  skipped: { key: string; reason: string }[];
  requiresRestart: boolean;
}

/**
 * @param invalidate Query keys to refetch after a successful reset.
 */
export function useResetSettings(invalidate: QueryKey[] = [DASHBOARD_SCOPE]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keys: string[]) =>
      api<ResetResult>('POST /dashboard/settings/reset', {
        body: { keys },
      }),
    onSuccess: () =>
      invalidate.forEach((queryKey) => qc.invalidateQueries({ queryKey })),
  });
}

export interface ImportEnvResult {
  imported: string[];
  skippedAsDefault: string[];
  failed: { key: string; reason: string }[];
  totalEnvKeys: number;
}

export function useImportEnv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<ImportEnvResult>('POST /dashboard/settings/import/env'),
    onSuccess: () => qc.invalidateQueries({ queryKey: DASHBOARD_SCOPE }),
  });
}

export interface ImportSettingsResult {
  imported: string[];
  skipped: { key: string; reason: string }[];
  failed: { key: string; reason: string }[];
  requiresRestart: boolean;
}

/**
 * @param invalidate Query keys to refetch after a successful import.
 */
export function useImportSettings(invalidate: QueryKey[] = [DASHBOARD_SCOPE]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: Record<string, unknown>) =>
      api<ImportSettingsResult>('POST /dashboard/settings/import/json', {
        body: { settings },
      }),
    onSuccess: () =>
      invalidate.forEach((queryKey) => qc.invalidateQueries({ queryKey })),
  });
}

// --- Shares: the FUSE mount is runtime state, not a setting -----------------

export type FuseMountState =
  | 'off'
  | 'unavailable'
  | 'mounting'
  | 'mounted'
  | 'unmounted'
  | 'error';

export interface FuseStatus {
  enabled: boolean;
  state: FuseMountState;
  mountPath: string;
  allowOther: boolean;
  available: boolean;
  reason?: string;
  error?: string;
  since?: number;
  arrMountDir: string;
  stats?: {
    inodes: number;
    openFiles: number;
    pendingRequests: number;
    requests: number;
    errors: number;
  };
}

export const FUSE_STATUS_QUERY_KEY = ['dashboard', 'shares', 'fuse'] as const;

export function useFuseStatus(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: FUSE_STATUS_QUERY_KEY,
    queryFn: () => api<FuseStatus>('/dashboard/shares/fuse/status'),
    refetchInterval: 5_000,
    enabled: opts?.enabled ?? true,
  });
}

export function useFuseMountAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: 'mount' | 'unmount') =>
      api<FuseStatus>(`POST /dashboard/shares/fuse/${action}`),
    onSuccess: (status) => qc.setQueryData(FUSE_STATUS_QUERY_KEY, status),
  });
}

// --- Sonarr / Radarr instances (bespoke editor: the list holds API keys) ----

/** Placeholder the server accepts in place of a stored API key. */
export const ARR_SECRET_MASK = '__stored__';

export interface MaskedArrInstance {
  id: string;
  name?: string;
  type: 'sonarr' | 'radarr';
  url: string;
  hasApiKey: boolean;
  enabled?: boolean;
  categories?: string[];
}

export interface ArrTestResult {
  ok: boolean;
  version?: string;
  appName?: string;
  error?: string;
}

export const ARR_INSTANCES_QUERY_KEY = [
  'dashboard',
  'arr',
  'instances',
] as const;

export function useArrInstances() {
  return useQuery({
    queryKey: ARR_INSTANCES_QUERY_KEY,
    queryFn: () =>
      api<{ instances: MaskedArrInstance[] }>('/dashboard/arr/instances'),
    staleTime: 10_000,
  });
}

export function useSaveArrInstances() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (instances: unknown[]) =>
      api<{ instances: MaskedArrInstance[] }>('PUT /dashboard/arr/instances', {
        body: { instances },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: DASHBOARD_SCOPE }),
  });
}

export function useTestArrInstance() {
  return useMutation({
    mutationFn: (instance: Record<string, unknown>) =>
      api<ArrTestResult>('POST /dashboard/arr/instances/test', {
        body: instance,
      }),
  });
}

// --- Queue cleanup rules (the matchers are ours; the choices are the user's) -

export type QueueCleanupAction =
  | 'remove'
  | 'blocklist'
  | 'blocklist_search'
  | 'import';

export interface QueueCleanupRule {
  id: string;
  label: string;
  phrase: string;
  action: QueueCleanupAction;
  enabled: boolean;
  note?: string;
}

export const ARR_QUEUE_RULES_QUERY_KEY = [
  'dashboard',
  'arr',
  'queue-rules',
] as const;

export function useQueueCleanupRules() {
  return useQuery({
    queryKey: ARR_QUEUE_RULES_QUERY_KEY,
    queryFn: () =>
      api<{ rules: QueueCleanupRule[] }>('/dashboard/arr/queue-rules'),
    staleTime: 10_000,
  });
}

export function useSaveQueueCleanupRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rules: { id: string; enabled: boolean; action: string }[]) =>
      api<{ rules: QueueCleanupRule[] }>('PUT /dashboard/arr/queue-rules', {
        body: { rules },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: DASHBOARD_SCOPE }),
  });
}

export interface ExportPayload {
  exportedAt: string;
  version: number;
  settings: Record<string, unknown>;
  maskedSecretKeys: string[];
}

/** Fetches the export payload (used in-memory; for direct download we hit the
 *  same endpoint with `?download=1` via a window.open call). */
export async function fetchSettingsExport(): Promise<ExportPayload> {
  return api<ExportPayload>('GET /dashboard/settings/export');
}
