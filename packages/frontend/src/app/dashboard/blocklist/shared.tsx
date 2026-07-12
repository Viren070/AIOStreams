import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/components/ui/core/styling';
import { api } from '@/lib/api';

export type Verdict = 'dead' | 'defective' | 'fake' | 'mislabeled';
export type Trust = 'full' | 'corroborate' | 'observe';

export interface BlocklistSource {
  id: string;
  kind: 'local' | 'remote' | 'imported';
  name: string;
  url: string | null;
  enabled: boolean;
  trust: Trust;
  refreshSeconds: number;
  lastChecked: number;
  lastUpdated: number;
  status: string | null;
  count: number;
}

export interface Snapshot {
  counts: { total: number; overrides: number };
  sources: BlocklistSource[];
  settings: {
    quorum: number;
    backboneScope: string;
    backboneGrouping: string;
    trustedBackbones: string[];
    publicExport: boolean;
    publicExportScope: string;
    publicExportPassword: string;
  };
  backbones: { mine: string[]; observed: string[] };
}

export interface AggregatedEntry {
  key: string;
  kind: 'torrent' | 'usenet';
  verdict: Verdict;
  lastAt: number;
  overridden: boolean;
  /** Backbones across all flagging sources, normalized per the instance's grouping setting. */
  backbones: string[];
  sources: Array<{
    id: string;
    name: string;
    trust: Trust;
    verdict: Verdict;
    n: number;
    lastAt: number;
    backbones: string[];
  }>;
}

export interface EntriesPage {
  entries: AggregatedEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export const VERDICTS: Verdict[] = ['dead', 'defective', 'fake', 'mislabeled'];
export const TRUSTS: Trust[] = ['full', 'corroborate', 'observe'];

export const VERDICT_BADGE: Record<Verdict, string> = {
  dead: 'bg-red-500/10 text-red-500 border-red-500/20',
  defective: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  fake: 'bg-fuchsia-500/10 text-fuchsia-500 border-fuchsia-500/20',
  mislabeled: 'bg-sky-500/10 text-sky-500 border-sky-500/20',
};

export const KIND_BADGE: Record<string, string> = {
  usenet: 'bg-violet-500/10 text-violet-500 border-violet-500/20',
  torrent: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  local: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  remote: 'bg-sky-500/10 text-sky-500 border-sky-500/20',
  imported: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
};

export const TRUST_BADGE: Record<Trust, string> = {
  full: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  corroborate: 'bg-sky-500/10 text-sky-500 border-sky-500/20',
  observe: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

export function Badge({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'text-[10px] uppercase px-1.5 py-0.5 rounded border whitespace-nowrap',
        className
      )}
    >
      {children}
    </span>
  );
}

export function formatUnix(seconds: number): string {
  if (!seconds) return '—';
  return new Date(seconds * 1000).toLocaleString();
}

export function formatInterval(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export function useBlocklistSnapshot() {
  return useQuery({
    queryKey: ['dashboard', 'blocklist', 'snapshot'],
    queryFn: () => api<Snapshot>('/dashboard/blocklist'),
    refetchInterval: 30_000,
  });
}

export function useInvalidateBlocklist() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['dashboard', 'blocklist'] });
}
