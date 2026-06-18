import React from 'react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BiSearchAlt, BiTrash, BiRefresh } from 'react-icons/bi';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { Card } from '@/components/ui/card';
import { Button, IconButton } from '@/components/ui/button';
import { cn } from '@/components/ui/core/styling';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@/components/shared/confirmation-dialog';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/format';

interface Instance {
  name: string;
  backend: 'memory' | 'redis' | 'sql' | 'disk';
  maxSize: number | null;
  items: number | null;
  estBytes: number | null;
  expired?: number;
}
interface Describe {
  instances: Instance[];
  totals: {
    instances: number;
    items: number | null;
    estBytes: number | null;
    redisDbSize?: number;
  };
}

const BADGE: Record<string, string> = {
  memory: 'bg-sky-500/10 text-sky-500 border-sky-500/20',
  sql: 'bg-violet-500/10 text-violet-500 border-violet-500/20',
  redis: 'bg-red-500/10 text-red-500 border-red-500/20',
  disk: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
};

export function CachePage() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['dashboard', 'cache'],
    queryFn: () => api<Describe>('/dashboard/cache'),
    refetchInterval: 10_000,
  });
  const data = query.data;

  const [scanned, setScanned] = React.useState<
    Record<string, { count: number; capped: boolean }>
  >({});
  const [scanning, setScanning] = React.useState<string | null>(null);

  const scan = async (prefix: string) => {
    setScanning(prefix);
    try {
      const r = await api<{ count: number; capped: boolean }>(
        'POST /dashboard/cache/scan',
        { body: { prefix } }
      );
      setScanned((s) => ({ ...s, [prefix]: r }));
    } catch (e: any) {
      toast.error(e?.message ?? 'Scan failed');
    } finally {
      setScanning(null);
    }
  };

  const clear = useMutation({
    mutationFn: (prefix?: string) =>
      api('POST /dashboard/cache/clear', {
        body: { confirm: true, prefix },
      }),
    onSuccess: () => {
      toast.success('Cache cleared');
      qc.invalidateQueries({ queryKey: ['dashboard', 'cache'] });
    },
    onError: (e: any) => toast.error(e?.message ?? 'Clear failed'),
  });

  const clearExpired = useMutation({
    mutationFn: () =>
      api('POST /dashboard/tasks/clear-expired-cache/run', { body: {} }),
    onSuccess: (r: any) => {
      toast.success(r?.message || 'Expired keys cleared');
      qc.invalidateQueries({ queryKey: ['dashboard', 'cache'] });
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  const [pendingPrefix, setPendingPrefix] = React.useState<
    string | undefined
  >();
  const confirmClear = useConfirmationDialog({
    title: 'Clear cache',
    description:
      'This permanently removes cached entries. This cannot be undone.',
    actionText: 'Clear',
    actionIntent: 'alert-subtle',
    onConfirm: () => clear.mutate(pendingPrefix),
  });

  const t = data?.totals;

  return (
    <PageWrapper className="p-4 sm:p-8 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2>Cache</h2>
          <p className="text-[--muted]">
            {t
              ? `${t.instances} instances · ${t.items ?? '—'} items${
                  t.redisDbSize != null
                    ? ` · Redis DBSIZE ${t.redisDbSize}`
                    : ''
                }`
              : 'Cache backends & prefixes'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            intent="gray-outline"
            leftIcon={<BiRefresh />}
            loading={clearExpired.isPending}
            onClick={() => clearExpired.mutate()}
          >
            Clear expired
          </Button>
          <Button
            size="sm"
            intent="alert-outline"
            leftIcon={<BiTrash />}
            onClick={() => {
              setPendingPrefix(undefined);
              confirmClear.open();
            }}
          >
            Clear all
          </Button>
        </div>
      </div>

      <DashboardQueryBoundary query={query} errorTitle="Failed to load cache">
        {(d) => (
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[--muted] text-xs uppercase bg-[--subtle]/40">
                  <tr className="text-left">
                    <th className="p-3">Prefix</th>
                    <th className="p-3">Backend</th>
                    <th className="p-3 text-right">Items</th>
                    <th className="p-3 text-right">Max</th>
                    <th className="p-3 text-right">Est. size</th>
                    <th className="p-3 text-right">Expired</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {d.instances.map((inst) => (
                    <tr
                      key={inst.name}
                      className="border-t border-[--border]/50 hover:bg-[--subtle]/30"
                    >
                      <td className="p-3 font-mono text-xs">{inst.name}</td>
                      <td className="p-3">
                        <span
                          className={cn(
                            'text-[10px] uppercase px-1.5 py-0.5 rounded border',
                            BADGE[inst.backend]
                          )}
                        >
                          {inst.backend}
                        </span>
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {inst.items != null ? (
                          inst.items
                        ) : scanned[inst.name] ? (
                          <>
                            {scanned[inst.name].capped ? '≥' : ''}
                            {scanned[inst.name].count}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {inst.backend === 'disk'
                          ? formatBytes(inst.maxSize)
                          : (inst.maxSize ?? '—')}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {formatBytes(inst.estBytes)}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {inst.expired ?? '—'}
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-1">
                          {inst.backend === 'redis' && inst.items == null && (
                            <Button
                              size="sm"
                              intent="gray-subtle"
                              leftIcon={<BiSearchAlt />}
                              loading={scanning === inst.name}
                              onClick={() => scan(inst.name)}
                              title="May be slow on large Redis instances"
                            >
                              Scan
                            </Button>
                          )}
                          <IconButton
                            size="sm"
                            intent="alert-subtle"
                            icon={<BiTrash />}
                            aria-label="Clear prefix"
                            onClick={() => {
                              setPendingPrefix(inst.name);
                              confirmClear.open();
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </DashboardQueryBoundary>

      <p className="text-xs text-[--muted]">
        Redis per-prefix counts are opt-in (the “Scan” button) and rate-limited
        — a SCAN can be slow on large Redis instances.
      </p>

      <ConfirmationDialog {...confirmClear} />
    </PageWrapper>
  );
}
