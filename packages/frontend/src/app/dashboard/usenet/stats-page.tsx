import React from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/components/ui/core/styling';
import { AreaChart, DonutChart, Stat } from '@/components/ui/charts';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import {
  useUsenetStats,
  useUsenetLive,
  type UsenetWindow,
  type ProviderState,
  type UsenetProviderStatRow,
  type UsenetStatsOverview,
} from './queries';
import {
  formatBytes,
  formatSpeed,
  formatPercent,
  formatCompact,
} from '@/lib/format';

// ---------------------------------------------------------------------------
// formatting helpers
// ---------------------------------------------------------------------------

/** Chart axis label for a bucket timestamp, varying granularity by window. */
function fmtBucketLabel(ms: number, window: UsenetWindow): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  if (window === '24h') return `${p(d.getHours())}:00`;
  if (window === '7d')
    return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}h`;
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

const WINDOWS: UsenetWindow[] = ['24h', '7d', '30d', 'all'];

function WindowToggle({
  value,
  onChange,
}: {
  value: UsenetWindow;
  onChange: (w: UsenetWindow) => void;
}) {
  return (
    <div className="flex gap-1">
      {WINDOWS.map((w) => (
        <button
          key={w}
          onClick={() => onChange(w)}
          className={cn(
            'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
            value === w
              ? 'border-brand bg-brand/10 text-brand'
              : 'border-[--border] text-[--muted] hover:text-[--foreground]'
          )}
        >
          {w}
        </button>
      ))}
    </div>
  );
}

const STATE_DOT: Record<ProviderState, string> = {
  online: 'bg-emerald-500',
  connecting: 'bg-amber-500',
  offline: 'bg-[--muted]',
  auth_failed: 'bg-red-500',
  disabled: 'bg-[--muted]/40',
};

// ---------------------------------------------------------------------------
// Live "now" panel
// ---------------------------------------------------------------------------

function LivePanel() {
  const live = useUsenetLive();
  const d = live.data;
  const tiles = d?.live;
  const pool = d?.pool;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Active streams"
          value={tiles ? String(tiles.activeStreams) : '—'}
          hint={
            pool
              ? `${pool.globalDownloadsInUse}/${pool.globalDownloadMax} download budget used`
              : ''
          }
        />
        <Stat
          label="Download speed"
          value={tiles ? formatSpeed(tiles.currentBytesPerSec) : '—'}
          hint={tiles ? `peak ${formatSpeed(tiles.peakBytesPerSec)}` : ''}
        />
        <Stat
          label="Articles / min"
          value={tiles ? formatCompact(tiles.articlesLastMinute) : '—'}
          hint={tiles ? `${tiles.errorsLastMinute} errors` : ''}
        />
        <Stat
          label="Cache hit rate"
          value={d ? formatPercent(d.cache.hitRate) : '—'}
          hint={
            d
              ? `mem ${formatBytes(d.cache.memBytes)} · disk ${formatBytes(
                  d.cache.diskBytes
                )}`
              : ''
          }
        />
      </div>

      <Card className="p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-semibold">Live connections</h3>
          <span className="text-xs text-[--muted]">
            per provider account · {pool?.globalDownloadsInUse ?? 0}/
            {pool?.globalDownloadMax ?? 0} global budget
          </span>
        </div>
        {!pool || pool.providers.length === 0 ? (
          <p className="text-sm text-[--muted]">
            No active provider pools. Connections open on demand when streaming.
          </p>
        ) : (
          <div className="space-y-2.5">
            {pool.providers.map((p) => (
              <div key={p.id} className="flex items-center gap-3">
                <span
                  className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    STATE_DOT[p.state]
                  )}
                  title={p.state}
                />
                <span className="text-sm font-medium w-40 truncate">
                  {p.name || p.id}
                  {p.isBackup && (
                    <span className="ml-1.5 text-xs text-[--muted]">
                      backup
                    </span>
                  )}
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-[--subtle] overflow-hidden">
                  <div
                    className={cn(
                      'h-full',
                      p.tripped ? 'bg-red-500' : 'bg-brand'
                    )}
                    style={{
                      width: p.max
                        ? `${Math.min(100, (p.acquired / p.max) * 100)}%`
                        : '0%',
                    }}
                  />
                </div>
                <span
                  className="text-xs tabular-nums w-24 text-right text-[--foreground]"
                  title={`per-connection download-rate EWMA the load-balancer splits group traffic by · ${p.freeSlots} free pipeline slots · aggregate ≈ this × active connections (see the windowed table for total speed)`}
                >
                  {p.throughput ? `${formatSpeed(p.throughput)}/conn` : '—'}
                </span>
                <span className="text-xs text-[--muted] tabular-nums w-20 text-right">
                  {p.acquired}/{p.max} busy
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Historical provider performance (windowed)
// ---------------------------------------------------------------------------

function ProviderTable({ providers }: { providers: UsenetProviderStatRow[] }) {
  if (providers.length === 0) {
    return (
      <p className="text-sm text-[--muted]">
        No provider activity recorded in this window yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto -mx-4 px-4 lg:mx-0 lg:px-0">
      <table className="w-full text-sm min-w-[720px]">
        <thead className="text-[--muted] text-xs uppercase">
          <tr className="text-left border-b border-[--border]">
            <th className="py-2 pr-3">Provider</th>
            <th className="py-2 px-3 text-right">Share</th>
            <th className="py-2 px-3 text-right">Data</th>
            <th className="py-2 px-3 text-right">Avg speed</th>
            <th className="py-2 px-3 text-right">Articles</th>
            <th className="py-2 px-3 text-right">Avg latency</th>
            <th className="py-2 px-3 text-right">Errors</th>
            <th className="py-2 pl-3 text-right">Missing</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => (
            <tr key={p.id} className="border-b border-[--border]/50">
              <td className="py-2 pr-3">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      STATE_DOT[p.live.state]
                    )}
                    title={p.live.state}
                  />
                  <span className="font-medium">{p.name || p.host}</span>
                  {p.isBackup && (
                    <span className="text-xs text-[--muted]">backup</span>
                  )}
                  {!p.enabled && (
                    <span className="text-xs text-[--muted]">(disabled)</span>
                  )}
                </div>
              </td>
              <td className="py-2 px-3 text-right">
                <div className="flex items-center justify-end gap-2">
                  <div className="w-16 h-1 rounded-full bg-[--subtle] overflow-hidden">
                    <div
                      className="h-full bg-brand"
                      style={{ width: `${p.articleShare * 100}%` }}
                    />
                  </div>
                  <span className="tabular-nums w-10 text-right">
                    {formatPercent(p.articleShare)}
                  </span>
                </div>
              </td>
              <td className="py-2 px-3 text-right tabular-nums">
                {formatBytes(p.bytes)}
              </td>
              <td className="py-2 px-3 text-right tabular-nums">
                {p.avgBytesPerSec ? formatSpeed(p.avgBytesPerSec) : '—'}
              </td>
              <td className="py-2 px-3 text-right tabular-nums">
                {formatCompact(p.articles)}
              </td>
              <td className="py-2 px-3 text-right tabular-nums">
                {p.articles ? `${p.avgLatencyMs}ms` : '—'}
              </td>
              <td
                className={cn(
                  'py-2 px-3 text-right tabular-nums',
                  p.errorRate > 0.1 && 'text-red-500'
                )}
              >
                {formatPercent(p.errorRate)}
              </td>
              <td className="py-2 pl-3 text-right tabular-nums text-[--muted]">
                {formatPercent(p.missRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatsSection({ data }: { data: UsenetStatsOverview }) {
  const chartData = data.throughput.map((b) => ({
    t: fmtBucketLabel(b.bucketMs, data.window),
    bytes: b.bytes,
  }));
  const share = data.providers
    .filter((p) => p.articles > 0)
    .slice(0, 6)
    .map((p) => ({ name: p.name || p.host, value: p.articles }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="Data downloaded" value={formatBytes(data.totals.bytes)} />
        <Stat
          label="Avg download speed"
          value={
            data.totals.avgBytesPerSec
              ? formatSpeed(data.totals.avgBytesPerSec)
              : '—'
          }
          hint={`avg while streaming · ${data.window}`}
        />
        <Stat label="Articles" value={formatCompact(data.totals.articles)} />
        <Stat
          label="Avg latency"
          value={data.totals.articles ? `${data.totals.avgLatencyMs}ms` : '—'}
        />
        <Stat
          label="Error rate"
          value={formatPercent(
            data.totals.articles + data.totals.errors > 0
              ? data.totals.errors / (data.totals.articles + data.totals.errors)
              : 0
          )}
        />
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Data downloaded</h3>
        {chartData.length === 0 ? (
          <p className="text-sm text-[--muted]">No data for this window yet.</p>
        ) : (
          <AreaChart
            data={chartData}
            xKey="t"
            series={[
              { key: 'bytes', label: 'Downloaded', color: 'var(--brand)' },
            ]}
            height={240}
            valueFormatter={(v) => formatBytes(Number(v))}
            yTickFormatter={(v) => formatBytes(Number(v))}
          />
        )}
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Provider performance</h3>
        {share.length > 0 ? (
          <div className="grid lg:grid-cols-[1fr,240px] gap-6 items-center">
            <ProviderTable providers={data.providers} />
            <div className="mx-auto w-full max-w-[240px] aspect-square">
              <DonutChart
                data={share}
                centerLabel="articles"
                centerValue={formatCompact(data.totals.articles)}
                height={240}
              />
            </div>
          </div>
        ) : (
          <ProviderTable providers={data.providers} />
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * Stats section: live "now" tiles + connections, plus windowed historical
 * provider performance and throughput.
 */
export function UsenetStatsPage() {
  const [window, setWindow] = React.useState<UsenetWindow>('24h');
  const stats = useUsenetStats(window);
  return (
    <div className="space-y-6">
      {/* Window selector lives here (not the page header) so it never squishes
          the heading on narrow screens. */}
      <div className="flex justify-end">
        <WindowToggle value={window} onChange={setWindow} />
      </div>
      <LivePanel />
      <DashboardQueryBoundary
        query={stats}
        errorTitle="Failed to load usenet stats"
      >
        {(d) => <StatsSection data={d} />}
      </DashboardQueryBoundary>
    </div>
  );
}
