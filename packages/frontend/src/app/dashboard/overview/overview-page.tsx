/**
 * DashboardHome — the landing page. Pulls together the most important live
 * health/usage signals across the dashboard so an operator can see at a glance
 * whether anything is wrong before drilling into a subpage. Every datum is
 * sourced from an endpoint that already exists; no new server APIs added.
 */
import React from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  BiBarChartAlt2,
  BiChip,
  BiCog,
  BiData,
  BiGroup,
  BiHistory,
  BiLineChart,
  BiServer,
  BiTask,
  BiTerminal,
} from 'react-icons/bi';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { Card } from '@/components/ui/card';
import { cn } from '@/components/ui/core/styling';
import { api } from '@/lib/api';
import { useSystemStream } from '@/app/dashboard/system/use-system';
import { formatDuration } from '@/lib/format';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';

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

const LINKS: Array<{
  to: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    to: '/dashboard/analytics',
    label: 'Analytics',
    desc: 'User & request trends',
    icon: BiBarChartAlt2,
  },
  {
    to: '/dashboard/users',
    label: 'Users',
    desc: 'Browse user configs',
    icon: BiGroup,
  },
  {
    to: '/dashboard/tasks',
    label: 'Tasks',
    desc: 'Scheduled & manual work',
    icon: BiTask,
  },
  {
    to: '/dashboard/system',
    label: 'System',
    desc: 'CPU, memory, lifecycle',
    icon: BiChip,
  },
  {
    to: '/dashboard/logs',
    label: 'Logs',
    desc: 'Live log stream',
    icon: BiTerminal,
  },
  {
    to: '/dashboard/cache',
    label: 'Cache',
    desc: 'Cache stats & flush',
    icon: BiData,
  },
  {
    to: '/dashboard/proxy',
    label: 'Proxy',
    desc: 'Built-in proxy',
    icon: BiLineChart,
  },
  {
    to: '/dashboard/settings',
    label: 'Settings',
    desc: 'Runtime configuration',
    icon: BiCog,
  },
];

function Stat({
  label,
  value,
  hint,
  intent,
}: {
  label: string;
  value: string | number;
  hint?: string;
  intent?: 'ok' | 'warn' | 'err';
}) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-[--muted]">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          intent === 'ok' && 'text-emerald-500',
          intent === 'warn' && 'text-amber-500',
          intent === 'err' && 'text-red-500'
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

function fmtUptime(s: number): string {
  if (!s) return '0m';
  return formatDuration(s);
}

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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
      </div>

      {/* Live status strip */}
      {metrics && (
        <Card className="p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-[--muted]">uptime</span>
            <span>{fmtUptime(metrics.process.uptimeSec)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[--muted]">CPU</span>
            <span className="tabular-nums">{metrics.cpu.total}%</span>
            {metrics.cpu.process != null && (
              <span className="text-xs text-[--muted]">
                (proc {metrics.cpu.process}%)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[--muted]">memory</span>
            <span className="tabular-nums">
              {Math.round((metrics.memory.used / metrics.memory.total) * 100)}%
            </span>
          </div>
          {metrics.lifecycleEnabled && (
            <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
              lifecycle enabled
            </span>
          )}
        </Card>
      )}

      {/* Activity / logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <BiHistory /> Recent task runs
            </h3>
            <Link
              to="/dashboard/tasks"
              className="text-xs text-[--muted] hover:text-[--foreground]"
            >
              View all →
            </Link>
          </div>
          <DashboardQueryBoundary
            query={tasks}
            errorTitle="Failed to load tasks"
          >
            {() =>
              recentTasks.length === 0 ? (
                <p className="text-xs text-[--muted] italic">
                  No task runs yet.
                </p>
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
                            t.lastStatus === 'error' && 'bg-red-500',
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
              )
            }
          </DashboardQueryBoundary>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <BiTerminal /> Recent warnings & errors
            </h3>
            <Link
              to="/dashboard/logs"
              className="text-xs text-[--muted] hover:text-[--foreground]"
            >
              View all →
            </Link>
          </div>
          <DashboardQueryBoundary
            query={recentLogs}
            errorTitle="Failed to load recent logs"
          >
            {(d) =>
              !d.logs.length ? (
                <p className="text-xs text-[--muted] italic">
                  No recent warnings.
                </p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {d.logs.slice(0, 8).map((r) => {
                    const parsed = parseLogLine(r.line);
                    return (
                      <li key={r.seq} className="truncate" title={r.line}>
                        <span
                          className={cn(
                            'inline-block w-1.5 h-1.5 rounded-full align-middle mr-1.5',
                            parsed.level === 'error' || parsed.level === 'fatal'
                              ? 'bg-red-500'
                              : 'bg-amber-500'
                          )}
                        />
                        {parsed.module && (
                          <span className="text-[--muted-highlight] font-mono">
                            [{parsed.module}]{' '}
                          </span>
                        )}
                        <span className="text-[--foreground]">
                          {parsed.msg}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )
            }
          </DashboardQueryBoundary>
        </Card>
      </div>

      {/* Quick links */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Sections</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {LINKS.map(({ to, label, desc, icon: Icon }) => (
            <Link key={to} to={to} className="block group">
              <Card className="p-4 h-full transition-colors group-hover:border-brand/40 group-hover:bg-brand/5">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="text-[--muted] group-hover:text-brand" />
                  <span className="font-medium">{label}</span>
                </div>
                <p className="text-xs text-[--muted]">{desc}</p>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </PageWrapper>
  );
}
