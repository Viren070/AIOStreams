import { BiCloudDownload } from 'react-icons/bi';
import { formatCompact, formatPercent, formatSpeed } from '@/lib/format';
import type { LiveStats } from '@/app/dashboard/usenet/queries';
import { OverviewCard } from './overview-card';

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] uppercase tracking-wide text-[--muted]">
        {label}
      </dt>
      <dd className="truncate text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * The built-in engine at a glance. Provider health is deliberately absent: a
 * cold pool reports every provider as offline, which would read as an outage
 * on an instance that is simply idle.
 */
export function UsenetCard({ data }: { data: LiveStats }) {
  const { live, pool, cache } = data;
  const providers = pool.providers.length;

  return (
    <OverviewCard
      to="/dashboard/usenet/stats"
      icon={BiCloudDownload}
      title="Usenet activity"
      aside={`${providers} ${providers === 1 ? 'provider' : 'providers'}`}
    >
      <div>
        <div className="text-2xl font-semibold tabular-nums">
          {formatSpeed(live.currentBytesPerSec)}
        </div>
        <div className="text-xs text-[--muted]">
          peak {formatSpeed(live.peakBytesPerSec)}
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2">
        <Metric label="Streams" value={String(live.activeStreams)} />
        <Metric
          label="Articles/min"
          value={formatCompact(live.articlesLastMinute)}
        />
        <Metric label="Cache hits" value={formatPercent(cache.hitRate)} />
      </dl>

      {/* Permits, not sockets: a connection with a pipeline depth of 2 carries
          two of these at once. */}
      {pool.globalDownloadMax > 0 && (
        <div className="text-xs tabular-nums text-[--muted]">
          {pool.globalDownloadsInUse} / {pool.globalDownloadMax} concurrent
          downloads
        </div>
      )}

      {live.errorsLastMinute > 0 && (
        <p className="text-xs text-amber-500">
          {live.errorsLastMinute} article
          {live.errorsLastMinute === 1 ? '' : 's'} failed in the last minute
        </p>
      )}
    </OverviewCard>
  );
}
