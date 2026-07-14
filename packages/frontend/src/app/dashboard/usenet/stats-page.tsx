import React from 'react';
import { BiErrorCircle } from 'react-icons/bi';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Popover } from '@/components/ui/popover';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/components/ui/core/styling';
import { AreaChart, DonutChart, Stat } from '@/components/ui/charts';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import { AnimatedNumber } from '@/components/shared/animated-number';
import {
  useUsenetStats,
  useUsenetLive,
  liveFrameMs,
  type PoolInfo,
  type ProviderPoolInfo,
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
  formatDurationMs,
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

/** How recently a pool must have proven wire contact to still show green. */
const REACHABLE_WINDOW_MS = 90_000;

interface PoolHealth {
  /** `warn`/`bad` are the actionable tones; they surface the details icon. */
  tone: 'ok' | 'warn' | 'bad' | 'idle' | 'off';
  cls: string;
  label: string;
  /** What the condition means and what, if anything, to do about it. */
  hint?: string;
}

/**
 * Live health driven by reachability evidence, not just the state machine:
 * green means "recently proven reachable" (a pool that hasn't dialed in hours
 * must not look healthy), amber flags degraded-but-recovering conditions.
 */
function poolHealth(p: ProviderPoolInfo): PoolHealth {
  if (p.state === 'disabled') {
    return { tone: 'off', cls: 'bg-[--muted]/40', label: 'Disabled' };
  }
  if (p.state === 'auth_failed') {
    return {
      tone: 'bad',
      cls: 'bg-red-500',
      label: 'Authentication failed',
      hint: 'The provider rejected the username or password. Update the credentials on the Providers page.',
    };
  }
  const amber = (label: string, hint?: string): PoolHealth => ({
    tone: 'warn',
    cls: 'bg-amber-500',
    label,
    hint,
  });
  if (p.tripped) {
    return amber(
      'Circuit breaker tripped',
      'Too many failures in a row, so new requests skip this provider and fail over to the others. It retries automatically.'
    );
  }
  if (p.throttled) {
    return amber(
      'Connection-limit throttled',
      'The provider refused another connection, usually because the account is at its connection limit. The pool has backed off and is running below its configured maximum.'
    );
  }
  if (p.state === 'connecting') {
    return amber('Connecting');
  }
  if (p.lastDialError && p.lastDialError.at > (p.lastDialOkAt ?? 0)) {
    return amber(
      `Last dial failed (${p.lastDialError.kind})`,
      'The most recent connection attempt did not succeed. If this persists, check the host, port and TLS settings.'
    );
  }
  // Affirmative evidence only: transferring now, warm connections (which
  // survive only by passing keepalives), or a recent successful dial.
  if (
    p.acquired > 0 ||
    p.total > 0 ||
    (p.lastDialOkAt && Date.now() - p.lastDialOkAt < REACHABLE_WINDOW_MS)
  ) {
    return { tone: 'ok', cls: 'bg-emerald-500', label: 'Reachable' };
  }
  return {
    tone: 'idle',
    cls: 'bg-[--muted]',
    label: 'Idle (no recent connections)',
  };
}

function timeAgo(at: number): string {
  const ms = Date.now() - at;
  return ms < 1000 ? 'just now' : `${formatDurationMs(ms)} ago`;
}

/**
 * Details for a degraded pool.
 */
function ProviderHealthPopover({
  p,
  health,
}: {
  p: ProviderPoolInfo;
  health: PoolHealth;
}) {
  return (
    <Popover
      modal={false}
      align="start"
      className="w-80"
      trigger={
        <button
          type="button"
          aria-label={`${p.name || p.id}: ${health.label}. Show details`}
          className={cn(
            'shrink-0 -my-1 p-1 rounded-full transition-opacity hover:opacity-70',
            health.tone === 'bad' ? 'text-red-500' : 'text-amber-500'
          )}
        >
          <BiErrorCircle className="w-4 h-4" />
        </button>
      }
    >
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <span className={cn('w-2 h-2 rounded-full shrink-0', health.cls)} />
          <span className="text-sm font-semibold">{health.label}</span>
        </div>
        {health.hint && <p className="text-xs text-[--muted]">{health.hint}</p>}
        {p.lastDialError && (
          <div className="rounded-[--radius] bg-[--subtle] p-2 space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium">
                {p.lastDialError.kind}
              </span>
              <span className="text-xs text-[--muted] shrink-0">
                {timeAgo(p.lastDialError.at)}
              </span>
            </div>
            <p className="text-xs text-[--muted] break-words">
              {p.lastDialError.message}
            </p>
          </div>
        )}
        <p className="text-xs text-[--muted]">
          {p.lastDialOkAt
            ? `Last successful connection ${timeAgo(p.lastDialOkAt)}`
            : 'No successful connection recorded'}
          {p.queued > 0 && ` · ${p.queued} queued in pool`}
        </p>
      </div>
    </Popover>
  );
}

/** Downloading/queued split of the global download budget. */
function budgetSplit(pool: PoolInfo): string {
  const queued = Math.max(
    0,
    pool.globalDownloadsInUse - pool.globalDownloadsOnWire
  );
  return (
    `${pool.globalDownloadsOnWire} downloading · ${queued} queued of ` +
    `${pool.globalDownloadMax} budget` +
    (pool.globalDownloadsWaiting > 0
      ? ` · +${pool.globalDownloadsWaiting} waiting`
      : '')
  );
}

// ---------------------------------------------------------------------------
// Live "now" panel
// ---------------------------------------------------------------------------

/**
 * True once pool queues have held work for over a minute with nothing on the
 * wire
 */
function useStuckPool(pool: PoolInfo | undefined): boolean {
  const [stuck, setStuck] = React.useState(false);
  const since = React.useRef<number | null>(null);
  const queuedInPools = pool?.providers.reduce((n, p) => n + p.queued, 0) ?? 0;
  const onWire = pool?.globalDownloadsOnWire ?? 0;
  React.useEffect(() => {
    if (queuedInPools > 0 && onWire === 0) {
      since.current ??= Date.now();
      setStuck(Date.now() - since.current > 60_000);
    } else {
      since.current = null;
      setStuck(false);
    }
  }, [queuedInPools, onWire, pool]);
  return stuck;
}

function LivePanel() {
  const live = useUsenetLive();
  const d = live.data;
  const tiles = d?.live;
  const pool = d?.pool;
  const stuck = useStuckPool(pool);
  const hasBackup = pool?.providers.some((p) => p.isBackup) ?? false;
  const frameMs = liveFrameMs(d);

  return (
    <div className="space-y-4">
      {stuck && (
        <Alert
          intent="warning"
          title="Downloads are queued but no connections are transferring"
          description="Fetches have been parked for over a minute with no wire activity. If this persists, check provider reachability or re-save the provider settings to rebuild the connection pools."
        />
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Active streams"
          value={tiles ? String(tiles.activeStreams) : '—'}
          hint={pool ? budgetSplit(pool) : ''}
        />
        <Stat
          label="Download speed"
          value={
            tiles ? (
              <AnimatedNumber
                value={tiles.currentBytesPerSec}
                format={formatSpeed}
                durationSec={frameMs / 1000}
              />
            ) : (
              '—'
            )
          }
          hint={tiles ? `peak ${formatSpeed(tiles.peakBytesPerSec)}` : ''}
        />
        <Stat
          label="Articles / min"
          value={
            tiles ? (
              <AnimatedNumber
                value={tiles.articlesLastMinute}
                format={(n) => formatCompact(Math.round(n))}
                durationSec={frameMs / 1000}
              />
            ) : (
              '—'
            )
          }
          hint={tiles ? `${tiles.errorsLastMinute} errors` : ''}
        />
        <Stat
          label="Cache hit rate"
          value={
            d ? (
              <AnimatedNumber
                value={d.cache.hitRate}
                format={formatPercent}
                durationSec={frameMs / 1000}
              />
            ) : (
              '—'
            )
          }
          hint={d ? `${formatBytes(d.cache.diskBytes)} on disk` : ''}
        />
      </div>

      <Card className="p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-semibold">Live connections</h3>
          <span className="text-xs text-[--muted]">
            {pool ? budgetSplit(pool) : '0 downloading · 0 queued'}
            {hasBackup ? ' · includes backup capacity' : ''}
          </span>
        </div>
        {!pool || pool.providers.length === 0 ? (
          <p className="text-sm text-[--muted]">
            No active provider pools. Connections open on demand when streaming.
          </p>
        ) : (
          <div className="space-y-2.5">
            {pool.providers.map((p) => {
              const health = poolHealth(p);
              const degraded = health.tone === 'warn' || health.tone === 'bad';
              const pct = (n: number) =>
                p.max ? `${Math.min(100, (n / p.max) * 100)}%` : '0%';
              return (
                <div key={p.id} className="flex items-center gap-3">
                  <Tooltip
                    trigger={
                      <span
                        className={cn(
                          'w-2 h-2 rounded-full shrink-0',
                          health.cls
                        )}
                      />
                    }
                  >
                    {health.label}
                  </Tooltip>
                  <span className="text-sm font-medium w-40 truncate flex items-center gap-1.5">
                    <span className="truncate">{p.name || p.id}</span>
                    {p.isBackup && (
                      <span className="text-xs text-[--muted] shrink-0">
                        backup
                      </span>
                    )}
                    {degraded && (
                      <ProviderHealthPopover p={p} health={health} />
                    )}
                  </span>
                  {/* Faint layer = open connections (incl. idle/connecting),
                      solid layer = actively transferring. Idle-but-warm must
                      look different from no-connections-at-all. */}
                  <div className="relative flex-1 h-1.5 rounded-full bg-[--subtle] overflow-hidden">
                    <div
                      className={cn(
                        'absolute inset-y-0 left-0',
                        'transition-[width] ease-out motion-reduce:transition-none',
                        p.tripped ? 'bg-red-500/30' : 'bg-brand/30'
                      )}
                      style={{
                        width: pct(p.total),
                        transitionDuration: `${frameMs}ms`,
                      }}
                    />
                    <div
                      className={cn(
                        'absolute inset-y-0 left-0',
                        'transition-[width] ease-out motion-reduce:transition-none',
                        p.tripped ? 'bg-red-500' : 'bg-brand'
                      )}
                      style={{
                        width: pct(p.acquired),
                        transitionDuration: `${frameMs}ms`,
                      }}
                    />
                  </div>
                  <span
                    className="text-xs tabular-nums w-24 text-right text-[--foreground]"
                    title={`per-connection download-rate EWMA the load-balancer splits group traffic by · ${p.freeSlots} free pipeline slots · aggregate ≈ this × active connections (see the windowed table for total speed)`}
                  >
                    {p.throughput ? (
                      <>
                        <AnimatedNumber
                          value={p.throughput}
                          format={formatSpeed}
                          durationSec={frameMs / 1000}
                        />
                        /conn
                      </>
                    ) : (
                      '—'
                    )}
                  </span>
                  <span
                    className="text-xs text-[--muted] tabular-nums w-40 text-right"
                    title={`${p.queued} queued in pool`}
                  >
                    {p.acquired} active · {p.total} open · max {p.max}
                  </span>
                </div>
              );
            })}
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
            <th
              className="py-2 px-3 text-right"
              title="How long the provider takes to answer a request for an article, before it starts sending it. Unlike the time to fetch a whole article, this does not grow when your bandwidth is shared across more streams, so it is comparable between providers."
            >
              Avg latency
            </th>
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
              <td
                className="py-2 px-3 text-right tabular-nums"
                title={
                  p.avgArticleMs
                    ? `${p.avgArticleMs}ms to fetch a whole article on average`
                    : undefined
                }
              >
                {p.avgBytesPerSec ? formatSpeed(p.avgBytesPerSec) : '—'}
              </td>
              <td className="py-2 px-3 text-right tabular-nums">
                {formatCompact(p.articles)}
              </td>
              <td
                className="py-2 px-3 text-right tabular-nums"
                title={
                  p.avgLatencyMs == null && p.articles > 0
                    ? 'Latency is only measured on fetches that had a connection to themselves, so a provider running with pipelining enabled may report none.'
                    : undefined
                }
              >
                {p.avgLatencyMs == null ? '—' : `${p.avgLatencyMs}ms`}
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
          value={
            data.totals.avgLatencyMs == null
              ? '—'
              : `${data.totals.avgLatencyMs}ms`
          }
          hint={
            data.totals.avgArticleMs
              ? `${data.totals.avgArticleMs}ms per whole article`
              : ''
          }
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
