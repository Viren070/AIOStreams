import React from 'react';
import { toast } from 'sonner';
import { BiPowerOff } from 'react-icons/bi';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { cn } from '@/components/ui/core/styling';
import {
  DashboardErrorCard,
  DashboardLoading,
} from '@/components/shared/dashboard-query-boundary';
import { DonutChart, LineChart, type Series } from '@/components/ui/charts';
import { api } from '@/lib/api';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@/components/shared/confirmation-dialog';
import { useSystemStream, type CpuSample } from './use-system';

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / 1024 ** i).toFixed(1)} ${u[i]}`;
}
function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

function Gauge({
  label,
  pct,
  detail,
}: {
  label: string;
  pct: number;
  detail: string;
}) {
  const color = pct > 90 ? '#ef4444' : pct > 70 ? '#f59e0b' : 'var(--brand)';
  return (
    <Card className="p-4 flex flex-col items-center">
      <span className="text-xs uppercase tracking-wide text-[--muted] mb-2">
        {label}
      </span>
      <DonutChart
        height={150}
        data={[
          { name: label, value: pct, color },
          { name: 'free', value: 100 - pct, color: 'var(--subtle)' },
        ]}
        centerValue={`${Math.round(pct)}%`}
      />
      <span className="text-xs text-[--muted] mt-2">{detail}</span>
    </Card>
  );
}

type CpuScope = 'system' | 'process';
type CpuView = 'average' | 'per-core';

/** Small two-button segmented toggle. Avoids pulling in a new UI primitive. */
function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{
    value: T;
    label: string;
    disabled?: boolean;
    title?: string;
  }>;
}) {
  return (
    <div className="inline-flex rounded-md border border-[--border] bg-[--subtle]/30 p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => !o.disabled && onChange(o.value)}
          disabled={o.disabled}
          title={o.title}
          className={cn(
            'px-2.5 py-1 rounded-[5px] transition-colors',
            value === o.value
              ? 'bg-[--paper] text-[--foreground] shadow-sm'
              : 'text-[--muted] hover:text-[--foreground]',
            o.disabled && 'opacity-40 cursor-not-allowed hover:text-[--muted]'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface CpuChartData {
  data: Array<Record<string, number | string>>;
  series: Series[];
}

/**
 * Build the chart-friendly data + series declarations from the rolling CPU
 * history. `system + average` and `process + average` collapse to a single
 * line; `system + per-core` shows one line per core; `process + per-core` is
 * meaningless (process CPU is a single aggregate) so we fall back to average.
 */
function buildCpuChart(
  history: CpuSample[],
  scope: CpuScope,
  view: CpuView
): CpuChartData {
  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };

  if (scope === 'process' || view === 'average') {
    const key = scope === 'process' ? 'process' : 'total';
    const label = scope === 'process' ? 'Process' : 'System';
    return {
      data: history.map((s) => ({ t: fmtTime(s.ts), [key]: s[key] })),
      series: [{ key, label }],
    };
  }
  // system + per-core
  const cores = history.at(-1)?.perCore.length ?? 0;
  return {
    data: history.map((s) => {
      const row: Record<string, number | string> = { t: fmtTime(s.ts) };
      for (let i = 0; i < cores; i++) row[`c${i}`] = s.perCore[i] ?? 0;
      return row;
    }),
    series: Array.from({ length: cores }, (_, i) => ({
      key: `c${i}`,
      label: `Core ${i}`,
    })),
  };
}

export function SystemPage() {
  const {
    metrics: m,
    connected,
    history,
    windowMs,
    error,
    retry,
  } = useSystemStream();
  const [cpuScope, setCpuScope] = React.useState<CpuScope>('system');
  const [cpuView, setCpuView] = React.useState<CpuView>('average');
  const [stopping, setStopping] = React.useState(false);
  const stopConfirm = useConfirmationDialog({
    title: 'Stop AIOStreams',
    description:
      'This halts the AIOStreams process only (never the host). It stays down until something starts it again.',
    actionText: 'Stop',
    actionIntent: 'alert-subtle',
    onConfirm: () => {
      setStopping(true);
      api('POST /dashboard/system/stop', { body: { confirm: 'STOP' } })
        .then(() => {
          toast.success(
            'Process stopping — it stays down until something starts it again.'
          );
        })
        .catch((e: any) => {
          toast.error(e?.message ?? 'Failed to stop');
        })
        .finally(() => setStopping(false));
    },
  });

  if (!m) {
    if (error)
      return (
        <PageWrapper className="p-4 sm:p-8">
          <DashboardErrorCard
            title="Failed to load system metrics"
            message={error}
            onRetry={retry}
          />
        </PageWrapper>
      );
    return (
      <PageWrapper className="p-4 sm:p-8">
        <DashboardLoading />
      </PageWrapper>
    );
  }

  const memPct = (m.memory.used / m.memory.total) * 100;
  const diskPct = m.disk ? (m.disk.used / m.disk.total) * 100 : 0;
  const chart = buildCpuChart(history, cpuScope, cpuView);
  const currentCpu =
    cpuScope === 'process' ? (m.cpu.process ?? 0) : m.cpu.total;

  return (
    <PageWrapper className="p-4 sm:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2>System</h2>
          <p className="text-[--muted]">
            <span
              className={`inline-block w-2 h-2 rounded-full align-middle ${
                connected ? 'bg-emerald-500' : 'bg-[--muted]'
              }`}
            />{' '}
            <span className="text-xs">
              {connected ? 'live' : 'reconnecting'}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            intent="alert-outline"
            size="sm"
            disabled={!m.lifecycleEnabled || stopping}
            loading={stopping}
            leftIcon={<BiPowerOff />}
            onClick={stopConfirm.open}
          >
            STOP
          </Button>
          <ConfirmationDialog {...stopConfirm} />
        </div>
      </div>

      {!m.lifecycleEnabled && (
        <Alert
          intent="info"
          description="Stop is disabled. Set SYSTEM_LIFECYCLE_ENABLED=true to enable process lifecycle controls."
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Gauge
          label="CPU"
          pct={m.cpu.total}
          detail={`${m.cpu.cores} cores${m.cpu.loadavg ? ` · load ${m.cpu.loadavg[0].toFixed(2)}` : ''}`}
        />
        <Gauge
          label="Memory"
          pct={memPct}
          detail={`${fmtBytes(m.memory.used)} / ${fmtBytes(m.memory.total)}`}
        />
        <Gauge
          label="Disk (data)"
          pct={diskPct}
          detail={
            m.disk
              ? `${fmtBytes(m.disk.used)} / ${fmtBytes(m.disk.total)}`
              : 'unavailable'
          }
        />
      </div>

      <Card className="p-4">
        <div className="flex items-start sm:items-center justify-between flex-col sm:flex-row gap-2 mb-3">
          <div>
            <h3 className="text-sm font-semibold">CPU utilisation</h3>
            <p className="text-xs text-[--muted]">
              Last {Math.round(windowMs / 60000)} minutes · live · now{' '}
              <span className="text-[--foreground] tabular-nums">
                {currentCpu}%
              </span>
            </p>
          </div>
          <div className="flex gap-2">
            <Segmented
              value={cpuScope}
              onChange={(v) => {
                setCpuScope(v);
                // process CPU has no per-core variant; auto-collapse to average.
                if (v === 'process' && cpuView === 'per-core')
                  setCpuView('average');
              }}
              options={[
                { value: 'system', label: 'System' },
                { value: 'process', label: 'Process' },
              ]}
            />
            <Segmented
              value={cpuView}
              onChange={setCpuView}
              options={[
                { value: 'average', label: 'Average' },
                {
                  value: 'per-core',
                  label: 'Per-core',
                  disabled: cpuScope === 'process',
                  title:
                    cpuScope === 'process'
                      ? 'Process CPU is reported as a single aggregate — per-core is only available for system scope.'
                      : undefined,
                },
              ]}
            />
          </div>
        </div>
        <LineChart
          data={chart.data}
          xKey="t"
          series={chart.series}
          height={220}
          hideLegend={cpuView !== 'per-core' || cpuScope === 'process'}
          valueFormatter={(v) => `${v}%`}
        />
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Process</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          {[
            ['Uptime', fmtUptime(m.process.uptimeSec)],
            ['Node', m.process.nodeVersion],
            ['PID', String(m.process.pid)],
            ['Heap', fmtBytes(m.memory.heapUsed)],
            ['RSS', fmtBytes(m.memory.rss)],
            ['Platform', m.process.platform],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="text-xs text-[--muted]">{k}</div>
              <div className="font-medium break-all">{v}</div>
            </div>
          ))}
        </div>
      </Card>
    </PageWrapper>
  );
}
