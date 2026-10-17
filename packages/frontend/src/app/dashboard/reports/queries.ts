import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { AppReport, AppReportListing } from '@aiostreams/core';
import { api } from '@/lib/api';

export type { AppReport, AppReportListing };

const ROOT = ['dashboard', 'reports'] as const;

export function useReports(page: number) {
  return useQuery({
    queryKey: [...ROOT, 'page', page],
    queryFn: () =>
      api<{ items: AppReportListing[]; total: number; pageSize: number }>(
        `/dashboard/reports?page=${page}`
      ),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useReport(code: string | null) {
  return useQuery({
    queryKey: [...ROOT, 'one', code],
    enabled: !!code,
    queryFn: () =>
      api<AppReport>(`/dashboard/reports/${encodeURIComponent(code!)}`),
  });
}

/** Those codes, or every report with `all`. */
export function useDeleteReports() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (target: { codes: string[] } | { all: true }) =>
      api<{ removed: number }>('DELETE /dashboard/reports', { body: target }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ROOT }),
  });
}
