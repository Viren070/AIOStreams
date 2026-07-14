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
  mapValueKind?: 'string' | 'number' | 'boolean' | 'numberOrBool' | 'json';
  /** Hint for `KeyValueListField` column ratio (default `equal`). */
  mapWidth?: 'equal' | 'wide-key' | 'wide-value';
  /** When `kind === 'string'`, render a textarea instead of single-line input
   *  (e.g. multi-line env-style credentials). */
  multiline?: boolean;
  /** For `number` fields - minimum allowed value (default: 0). */
  min?: number;
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
}

/** Query key for the generic settings page. */
export const SETTINGS_QUERY_KEY = ['dashboard', 'settings'] as const;
const KEY = SETTINGS_QUERY_KEY;

const DASHBOARD_SCOPE = ['dashboard'] as const;

export function useSettings(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api<{ keys: SettingsKey[] }>('/dashboard/settings'),
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
