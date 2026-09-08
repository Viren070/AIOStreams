import { BiBarChartAlt2 } from 'react-icons/bi';
import { formatBytes, formatPercent } from '@/lib/format';
import { useBandwidth } from '@/app/dashboard/streams/queries';
import { CardNote, OverviewCard } from './overview-card';

/**
 * Bytes served over the accounting period. The `30d` window *is* that period,
 * so its total is what the caps measure; unproxied links never pass through
 * here and are not counted. The shape over time lives on the full page.
 */
export function BandwidthCard() {
  const query = useBandwidth('30d');
  const d = query.data;
  const monthly = d?.periodMode === 'monthly';

  return (
    <OverviewCard
      to="/dashboard/streams/bandwidth"
      icon={BiBarChartAlt2}
      title={monthly ? 'Bandwidth this month' : 'Bandwidth'}
      aside={
        d &&
        (monthly
          ? `since ${new Date(d.periodStart).toLocaleDateString()}`
          : 'last 30 days')
      }
    >
      <div className="space-y-0.5">
        <div className="text-2xl font-semibold tabular-nums">
          {d ? formatBytes(d.periodTotal) : '—'}
        </div>
        {d && d.globalLimit > 0 && (
          <div className="text-xs text-[--muted]">
            of {formatBytes(d.globalLimit)} allowed this period
          </div>
        )}
        {d && d.total > 0 && (
          <div className="text-xs text-[--muted]">
            {formatPercent((d.byTransport.usenet ?? 0) / d.total)} usenet ·{' '}
            {formatPercent((d.byTransport.proxy ?? 0) / d.total)} proxy
          </div>
        )}
      </div>

      {query.isError && <CardNote>Failed to load bandwidth.</CardNote>}
    </OverviewCard>
  );
}
