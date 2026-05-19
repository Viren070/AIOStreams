import React from 'react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BiPlay, BiChevronDown } from 'react-icons/bi';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/core/styling';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@/components/shared/confirmation-dialog';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import { api } from '@/lib/api';

interface TaskState {
  id: string;
  label: string;
  description: string;
  category: string;
  kind: 'scheduled' | 'manual';
  intervalMs?: number;
  enabled: boolean;
  destructive: boolean;
  multiReplica: 'all' | 'single';
  running: boolean;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastStatus: 'ok' | 'error' | 'skipped' | null;
  lastError: string | null;
  nextRunAt: number | null;
}

/**
 * Format a duration (in seconds) using two adjacent units at most (`2h 14m`,
 * `3d 4h`, `2w 1d`). Returns a single short token for sub-minute values so
 * lists stay aligned. Negative values are formatted unsigned — callers prepend
 * "in " or append " ago" as needed.
 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 1) return '0s';
  if (s < 60) return `${s}s`;
  const units: Array<[string, number]> = [
    ['w', 604800],
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ];
  // Find the first unit with a non-zero count, emit it + the next unit.
  for (let i = 0; i < units.length; i++) {
    const [u, secs] = units[i];
    const n = Math.floor(s / secs);
    if (n > 0) {
      const rem = s - n * secs;
      const next = units[i + 1];
      if (next && rem > 0) {
        const m = Math.floor(rem / next[1]);
        if (m > 0) return `${n}${u} ${m}${next[0]}`;
      }
      return `${n}${u}`;
    }
  }
  return `${s}s`;
}

function humanInterval(ms?: number): string {
  if (!ms) return 'manual';
  return `every ${formatDuration(ms / 1000)}`;
}

const rel = (ms: number | null) => {
  if (!ms) return 'never';
  const diff = (Date.now() - ms) / 1000;
  if (diff < 0) return `in ${formatDuration(-diff)}`;
  return `${formatDuration(diff)} ago`;
};

export function TasksPage() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['dashboard', 'tasks'],
    queryFn: () => api<{ tasks: TaskState[] }>('/dashboard/tasks'),
    refetchInterval: 5000,
  });

  const run = useMutation({
    mutationFn: ({ id, confirm }: { id: string; confirm?: boolean }) =>
      api(`POST /dashboard/tasks/${id}/run`, { body: { confirm } }),
    onSuccess: (r: any) => {
      toast.success(r?.message || 'Task finished');
      qc.invalidateQueries({ queryKey: ['dashboard', 'tasks'] });
    },
    onError: (e: any) => toast.error(e?.message ?? 'Task failed'),
  });

  const [pending, setPending] = React.useState<string | null>(null);
  const confirm = useConfirmationDialog({
    title: 'Run destructive task',
    description: 'This task is destructive and cannot be undone. Run it now?',
    actionText: 'Run',
    actionIntent: 'alert-subtle',
    onConfirm: () => pending && run.mutate({ id: pending, confirm: true }),
  });

  const groupTasks = (tasks: TaskState[]) => {
    const m = new Map<string, TaskState[]>();
    for (const t of tasks)
      (m.get(t.category) ?? m.set(t.category, []).get(t.category)!).push(t);
    return [...m.entries()];
  };

  return (
    <PageWrapper className="p-4 sm:p-8 space-y-6">
      <div>
        <h2>Tasks</h2>
        <p className="text-[--muted]">
          Background &amp; scheduled work. Run manual tasks on demand.
        </p>
      </div>

      <DashboardQueryBoundary query={query} errorTitle="Failed to load tasks">
        {(data) => (
          <div className="space-y-6">
            {groupTasks(data.tasks).map(([cat, tasks]) => (
              <div key={cat} className="space-y-2">
                <h3 className="text-xs uppercase tracking-wider text-[--muted] font-semibold">
                  {cat}
                </h3>
                <div className="grid gap-2">
                  {tasks.map((t) => (
                    <Card key={t.id} className="p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{t.label}</span>
                            {t.destructive && (
                              <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 border border-red-500/20">
                                destructive
                              </span>
                            )}
                            <span
                              className={cn(
                                'text-[10px] uppercase px-1.5 py-0.5 rounded border',
                                t.enabled
                                  ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                                  : 'bg-[--subtle] text-[--muted] border-[--border]'
                              )}
                            >
                              {t.enabled ? 'enabled' : 'disabled'}
                            </span>
                          </div>
                          <p className="text-xs text-[--muted] mt-0.5">
                            {t.description}
                          </p>
                        </div>
                        <div className="text-xs text-[--muted] grid grid-cols-2 gap-x-6 gap-y-0.5 sm:min-w-[220px]">
                          <span>Schedule</span>
                          <span className="text-[--foreground]">
                            {humanInterval(t.intervalMs)}
                          </span>
                          <span>Last run</span>
                          <span
                            className={cn(
                              t.lastStatus === 'error' && 'text-red-500',
                              t.lastStatus === 'ok' && 'text-emerald-500'
                            )}
                          >
                            {rel(t.lastRunAt)}
                            {t.lastDurationMs != null &&
                              ` · ${formatDuration(t.lastDurationMs / 1000) === '0s' ? `${t.lastDurationMs}ms` : formatDuration(t.lastDurationMs / 1000)}`}
                          </span>
                          {t.kind === 'scheduled' && (
                            <>
                              <span>Next run</span>
                              <span className="text-[--foreground]">
                                {rel(t.nextRunAt)}
                              </span>
                            </>
                          )}
                        </div>
                        <Button
                          size="sm"
                          intent={
                            t.destructive ? 'alert-outline' : 'gray-outline'
                          }
                          leftIcon={t.running ? undefined : <BiPlay />}
                          loading={
                            t.running || (run.isPending && pending === t.id)
                          }
                          disabled={t.running}
                          className="w-full sm:w-auto"
                          onClick={() => {
                            setPending(t.id);
                            if (t.destructive) confirm.open();
                            else run.mutate({ id: t.id });
                          }}
                        >
                          Run now
                        </Button>
                      </div>
                      {t.lastStatus === 'error' && t.lastError && (
                        <details className="mt-3 group">
                          <summary className="cursor-pointer text-xs text-red-500 flex items-center gap-1 list-none [&::-webkit-details-marker]:hidden">
                            <BiChevronDown className="transition-transform group-open:rotate-180" />
                            Last error
                          </summary>
                          <pre className="mt-2 p-2 text-[11px] font-mono whitespace-pre-wrap break-words bg-red-500/5 border border-red-500/20 rounded text-red-500/90">
                            {t.lastError}
                          </pre>
                        </details>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </DashboardQueryBoundary>

      <ConfirmationDialog {...confirm} />
    </PageWrapper>
  );
}
