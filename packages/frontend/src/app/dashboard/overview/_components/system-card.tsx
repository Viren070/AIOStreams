import { BiChip } from 'react-icons/bi';
import { cn } from '@/components/ui/core/styling';
import { formatBytes, formatDuration } from '@/lib/format';
import type { SystemMetrics } from '@/app/dashboard/system/use-system';
import { OverviewCard } from './overview-card';

/**
 * One reading. `ratio` only colours the figure once it is worth noticing; the
 * value itself carries the detail, so there is no track to read against.
 */
function Reading({
  label,
  value,
  hint,
  ratio,
}: {
  label: string;
  value: string;
  hint?: string;
  ratio?: number;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-xs uppercase tracking-wide text-[--muted]">
        {label}
      </div>
      <div
        className={cn(
          'truncate text-lg font-semibold tabular-nums',
          ratio != null && ratio >= 0.95 && 'text-red-400',
          ratio != null && ratio >= 0.85 && ratio < 0.95 && 'text-amber-500'
        )}
      >
        {value}
      </div>
      {hint && <div className="truncate text-xs text-[--muted]">{hint}</div>}
    </div>
  );
}

/**
 * Resource use in absolute terms: a percentage alone doesn't say whether an
 * instance is near its ceiling, and the process figure is the one an operator
 * can actually act on.
 */
export function SystemCard({ metrics }: { metrics: SystemMetrics }) {
  const { cpu, memory, process: proc } = metrics;
  const memRatio = memory.total > 0 ? memory.used / memory.total : 0;

  return (
    <OverviewCard
      to="/dashboard/system"
      icon={BiChip}
      title="System"
      aside={`up ${formatDuration(proc.uptimeSec)}`}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Reading
          label="CPU"
          value={`${Math.round(cpu.total)}%`}
          hint={`${Math.round(cpu.process)}% this process · ${cpu.cores} cores`}
          ratio={cpu.total / 100}
        />
        <Reading
          label="Memory"
          value={`${formatBytes(memory.used)} / ${formatBytes(memory.total)}`}
          hint={`${Math.round(memRatio * 100)}% used · ${formatBytes(
            memory.free
          )} free`}
          ratio={memRatio}
        />
        <Reading
          label="Process memory"
          value={formatBytes(memory.rss)}
          hint={`${formatBytes(memory.heapUsed)} of ${formatBytes(
            memory.heapTotal
          )} heap`}
        />
      </div>
    </OverviewCard>
  );
}
