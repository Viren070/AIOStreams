/**
 * DashboardHome — the landing page. Pulls together the most important live
 * health/usage signals across the dashboard so an operator can see at a glance
 * whether anything is wrong before drilling into a subpage. Every datum is
 * sourced from an endpoint that already exists; no new server APIs added.
 */
import React from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { BiHistory, BiTerminal } from 'react-icons/bi';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { Card } from '@/components/ui/card';
import { cn } from '@/components/ui/core/styling';
import { api } from '@/lib/api';
import { useSystemStream } from '@/app/dashboard/system/use-system';
import { formatDuration } from '@/lib/format';
import { useUsenetGlance } from '@/app/dashboard/usenet/queries';
import { useCommunityItems } from '@/app/dashboard/community/queries';
import { ActiveStreamsCard } from './_components/active-streams-card';
import { BandwidthCard } from './_components/bandwidth-card';
import { SectionLinks } from './_components/section-links';
import { SystemCard } from './_components/system-card';
import { UsenetCard } from './_components/usenet-card';
import { CardNote, OverviewCard } from './_components/overview-card';

interface OverviewMetrics {
  totalUsers: number;
  newUsers: { d1: number; d7: number; d30: number };
  activeUsers: { d1: number; d7: number };
  requests24h: number;
}

interface TaskState {
  id: string;
  label: string;
  category: string;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastStatus: 'ok' | 'error' | 'skipped' | null;
  lastError: string | null;
  running: boolean;
}

interface LogRecord {
  seq: number;
  line: string;
}

function Stat({
  label,
  value,
  hint,
  intent,
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  intent?: 'ok' | 'warn' | 'err';
  className?: string;
}) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="text-xs uppercase tracking-wide text-[--muted]">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          intent === 'ok' && 'text-emerald-500',
          intent === 'warn' && 'text-amber-500',
          intent === 'err' && 'text-red-400'
        )}
      >
        {value}
      </div>
      {hint && <div className="text-xs text-[--muted] mt-0.5">{hint}</div>}
    </Card>
  );
}

const rel = (ms: number | null): string => {
  if (!ms) return 'never';
  const diff = (Date.now() - ms) / 1000;
  if (diff < 0) return `in ${formatDuration(-diff)}`;
  return `${formatDuration(diff)} ago`;
};

/**
 * Pull the human-readable bits out of a pino NDJSON log line. The full Logs
 * page has a richer parser (`use-log-stream.ts`), but the overview only needs
 * level/module/msg for the recent-warnings widget — duplicating five lines
 * here is cheaper than importing the streaming parser.
 */
function parseLogLine(line: string): {
  level: string;
  module?: string;
  msg: string;
} {
  try {
    const o = JSON.parse(line) as Record<string, unknown>;
    const level = typeof o.level === 'string' ? o.level : 'info';
    const module = typeof o.module === 'string' ? o.module : undefined;
    const msg = typeof o.msg === 'string' ? o.msg : line;
    return { level, module, msg };
  } catch {
    return { level: 'info', msg: line };
  }
}

export function DashboardHome() {
  const overview = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: () => api<OverviewMetrics>('/dashboard/analytics/overview'),
    staleTime: 30_000,
  });
  const tasks = useQuery({
    queryKey: ['dashboard', 'tasks'],
    queryFn: () => api<{ tasks: TaskState[] }>('/dashboard/tasks'),
    refetchInterval: 10_000,
  });
  const recentLogs = useQuery({
    queryKey: ['dashboard', 'overview', 'logs'],
    queryFn: () =>
      api<{ logs: LogRecord[] }>(
        '/dashboard/logs?order=desc&limit=10&level=error,warn'
      ),
    refetchInterval: 15_000,
  });
  const { metrics } = useSystemStream();

  // Only the count is wanted, so ask for the smallest page the API will serve.
  const pending = useCommunityItems({ pending: true, limit: 1 });
  const pendingCount = pending.data?.total ?? 0;

  // An empty provider list means usenet isn't set up on this instance.
  const usenet = useUsenetGlance();
  const usenetData = usenet.data;
  const showUsenet = (usenetData?.pool.providers.length ?? 0) > 0;

  const errRate24 = React.useMemo(() => {
    // Approximation: % of recent task runs in error state (we don't store
    // request error counts separately in the overview endpoint).
    const list = tasks.data?.tasks ?? [];
    if (list.length === 0) return null;
    const err = list.filter((t) => t.lastStatus === 'error').length;
    return Math.round((err / list.length) * 100);
  }, [tasks.data]);

  const recentTasks = React.useMemo(() => {
    const list = (tasks.data?.tasks ?? []).filter((t) => t.lastRunAt);
    list.sort((a, b) => (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0));
    return list.slice(0, 5);
  }, [tasks.data]);

  return (
    <PageWrapper className="space-y-6 p-4 sm:p-8">
      <div>
        <h2>Dashboard</h2>
        <p className="text-[--muted]">
          Live overview of this AIOStreams instance.
        </p>
      </div>

      {/* Top stats */}
      <div
        className={cn(
          'grid grid-cols-2 gap-3',
          pendingCount > 0 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'
        )}
      >
        <Stat
          label="Users"
          value={overview.data?.totalUsers ?? '—'}
          hint={
            overview.data
              ? `+${overview.data.newUsers.d1} today · +${overview.data.newUsers.d7} this week`
              : undefined
          }
        />
        <Stat
          label="Active 24h"
          value={overview.data?.activeUsers.d1 ?? '—'}
          hint={
            overview.data
              ? `${overview.data.activeUsers.d7} this week`
              : undefined
          }
        />
        <Stat label="Requests 24h" value={overview.data?.requests24h ?? '—'} />
        <Stat
          label="Task failures"
          value={errRate24 == null ? '—' : `${errRate24}%`}
          intent={errRate24 == null ? undefined : errRate24 > 0 ? 'err' : 'ok'}
          hint={
            tasks.data ? `${tasks.data.tasks.length} tasks tracked` : undefined
          }
        />
        {pendingCount > 0 && (
          <Link
            to="/dashboard/community/pending"
            className="group col-span-2 block rounded-xl lg:col-span-1"
          >
            <Stat
              label="Review queue"
              value={pendingCount}
              intent="warn"
              hint="Community submissions waiting"
              className="h-full transition-colors group-hover:border-[--muted]/40 group-hover:bg-[--subtle]/50"
            />
          </Link>
        )}
      </div>

      {metrics && <SystemCard metrics={metrics} />}

      {/* What the instance is doing right now */}
      <div
        className={cn(
          'grid grid-cols-1 gap-3 sm:grid-cols-2',
          showUsenet && 'xl:grid-cols-3'
        )}
      >
        <ActiveStreamsCard />
        <BandwidthCard />
        {showUsenet && usenetData && <UsenetCard data={usenetData} />}
      </div>

      {/* Activity / logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <OverviewCard
          to="/dashboard/tasks"
          icon={BiHistory}
          title="Recent task runs"
        >
          {tasks.isError ? (
            <CardNote>Failed to load tasks.</CardNote>
          ) : recentTasks.length === 0 ? (
            <CardNote>No task runs yet.</CardNote>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {recentTasks.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-2 justify-between"
                >
                  <span className="truncate">{t.label}</span>
                  <span className="flex items-center gap-2 text-xs text-[--muted]">
                    <span
                      className={cn(
                        'inline-block w-2 h-2 rounded-full',
                        t.lastStatus === 'ok' && 'bg-emerald-500',
                        t.lastStatus === 'error' && 'bg-red-400',
                        t.lastStatus === 'skipped' && 'bg-amber-500',
                        !t.lastStatus && 'bg-[--muted]'
                      )}
                    />
                    <span>{rel(t.lastRunAt)}</span>
                    {t.lastDurationMs != null && (
                      <span>· {t.lastDurationMs}ms</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </OverviewCard>

        <OverviewCard
          to="/dashboard/logs"
          icon={BiTerminal}
          title="Recent warnings & errors"
        >
          {recentLogs.isError ? (
            <CardNote>Failed to load recent logs.</CardNote>
          ) : !recentLogs.data?.logs.length ? (
            <CardNote>No recent warnings.</CardNote>
          ) : (
            <ul className="space-y-1 text-xs">
              {recentLogs.data.logs.slice(0, 8).map((r) => {
                const parsed = parseLogLine(r.line);
                return (
                  <li key={r.seq} className="truncate" title={r.line}>
                    <span
                      className={cn(
                        'inline-block w-1.5 h-1.5 rounded-full align-middle mr-1.5',
                        parsed.level === 'error' || parsed.level === 'fatal'
                          ? 'bg-red-400'
                          : 'bg-amber-500'
                      )}
                    />
                    {parsed.module && (
                      <span className="text-[--muted-highlight] font-mono">
                        [{parsed.module}]{' '}
                      </span>
                    )}
                    <span className="text-[--foreground]">{parsed.msg}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </OverviewCard>
      </div>

      <SectionLinks />
    </PageWrapper>
  );
}
