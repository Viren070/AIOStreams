import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type Trust = 'full' | 'corroborate' | 'observe';
export type SourceKind = 'local' | 'remote' | 'imported';

export interface ScreenerSource {
  id: string;
  kind: SourceKind;
  name: string;
  url: string | null;
  enabled: boolean;
  trust: Trust;
  refreshHours: number;
  lastChecked: number;
  lastUpdated: number;
  status: string | null;
  count: number;
}

export interface ScreenerSnapshot {
  counts: { total: number; local: number };
  sources: ScreenerSource[];
}

const ROOT = ['screener'] as const;

export function useScreener() {
  return useQuery({
    queryKey: ROOT,
    queryFn: () => api<ScreenerSnapshot>('/screener'),
    staleTime: 10_000,
  });
}

function useScreenerMutation<TArgs>(
  fn: (args: TArgs) => Promise<unknown>
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      // Every mutation returns a fresh snapshot; seed the cache with it.
      if (data && typeof data === 'object' && 'sources' in (data as object)) {
        qc.setQueryData(ROOT, data);
      } else {
        qc.invalidateQueries({ queryKey: ROOT });
      }
    },
  });
}

export interface AddRemoteArgs {
  url: string;
  name?: string;
  trust?: Trust;
  refreshHours?: number;
}
export function useAddRemoteSource() {
  return useScreenerMutation((args: AddRemoteArgs) =>
    api<ScreenerSnapshot & { id: string; status: string }>(
      'POST /screener/sources/remote',
      { body: args as unknown as Record<string, unknown> }
    )
  );
}

export interface UpdateSourceArgs {
  id: string;
  enabled?: boolean;
  trust?: Trust;
  refreshHours?: number;
  name?: string;
}
export function useUpdateSource() {
  return useScreenerMutation(({ id, ...patch }: UpdateSourceArgs) =>
    api<ScreenerSnapshot>(`PATCH /screener/sources/${encodeURIComponent(id)}`, {
      body: patch as Record<string, unknown>,
    })
  );
}

export function useRemoveSource() {
  return useScreenerMutation(({ id, clear }: { id: string; clear?: boolean }) =>
    api<ScreenerSnapshot>(
      `DELETE /screener/sources/${encodeURIComponent(id)}${clear ? '?action=clear' : ''}`
    )
  );
}

export function useRefreshSource() {
  return useScreenerMutation((id: string) =>
    api<ScreenerSnapshot & { status: string }>(
      `POST /screener/sources/${encodeURIComponent(id)}/refresh`
    )
  );
}

export interface ImportArgs {
  content: string;
  target: 'merge' | 'separate';
  name?: string;
  trust?: Trust;
}
export function useImportList() {
  return useScreenerMutation((args: ImportArgs) =>
    api<ScreenerSnapshot & { added: number; invalid: number }>(
      'POST /screener/import',
      { body: args as unknown as Record<string, unknown> }
    )
  );
}

export interface MarkArgs {
  key: string;
  verdict: 'dead' | 'fake' | 'mislabeled';
}
export function useMarkVerdict() {
  return useScreenerMutation((args: MarkArgs) =>
    api<ScreenerSnapshot>('POST /screener/mark', {
      body: args as unknown as Record<string, unknown>,
    })
  );
}

/** Direct download URL for an export (auth cookie rides along). */
export function exportUrl(
  scope: 'local' | 'all',
  format: 'native' | 'davex',
  dedup: boolean
): string {
  const params = new URLSearchParams({
    scope,
    format,
    dedup: dedup ? '1' : '0',
  });
  return `/api/v1/screener/export?${params.toString()}`;
}
