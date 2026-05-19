import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

const KEY = ['dashboard', 'settings'] as const;

export function useSettings() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api<{ keys: SettingsKey[] }>('/dashboard/settings'),
    staleTime: 10_000,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
