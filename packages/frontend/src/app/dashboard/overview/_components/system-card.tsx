import { BiChip } from 'react-icons/bi';
import { formatBytes, formatDuration } from '@aiostreams/ui/core/format';
import type { SystemMetrics } from '@/app/dashboard/system/use-system';
import { OverviewCard, Reading } from './overview-card';

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
