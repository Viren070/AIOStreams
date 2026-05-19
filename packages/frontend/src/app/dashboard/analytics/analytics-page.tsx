import React from 'react';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { Card } from '@/components/ui/card';
import { cn } from '@/components/ui/core/styling';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import { AreaChart, BarChart, DonutChart, Stat } from '@/components/ui/charts';
import {
  useOverview,
  useUsersAnalytics,
  useRequestsAnalytics,
  useAddonsAnalytics,
  useFeaturesAnalytics,
  type Range,
  type FeatureEntry,
} from './queries';

const RANGES: Range[] = ['24h', '7d', '30d', 'all'];

function RangeToggle({
  value,
  onChange,
}: {
  value: Range;
  onChange: (r: Range) => void;
}) {
  return (
    <div className="flex gap-1">
      {RANGES.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={cn(
            'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
            value === r
              ? 'border-brand bg-brand/10 text-brand'
              : 'border-[--border] text-[--muted] hover:text-[--foreground]'
          )}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

/**
 * Sorted, capped list of feature keys with their distinct-user counts. The
 * dashboard uses three of these side-by-side (service / formatter / preset).
 */
function FeatureList({ title, rows }: { title: string; rows: FeatureEntry[] }) {
  const top = rows.slice(0, 12);
  const max = top[0]?.count ?? 0;
  return (
    <div>
      <h4 className="text-xs font-semibold text-[--muted] uppercase tracking-wide mb-2">
        {title}
      </h4>
      {top.length === 0 ? (
        <p className="text-sm text-[--muted]">No data for this range.</p>
      ) : (
        <ul className="space-y-1.5">
          {top.map((r) => (
            <li key={r.key} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{r.key}</span>
                <span className="tabular-nums text-[--muted]">
                  {r.count.toLocaleString()}
                </span>
              </div>
              <div className="h-1 rounded-full bg-[--subtle] overflow-hidden">
                <div
                  className="h-full bg-brand"
                  style={{
                    width: max ? `${(r.count / max) * 100}%` : '0%',
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AnalyticsPage() {
  const [range, setRange] = React.useState<Range>('7d');
  const overview = useOverview();
  const users = useUsersAnalytics(range);
  const requests = useRequestsAnalytics(range);
  const addons = useAddonsAnalytics(range);
  const features = useFeaturesAnalytics(range);

  const o = overview.data;

  return (
    <PageWrapper className="p-4 sm:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2>Analytics</h2>
          <p className="text-[--muted]">
            Usage, requests and addon health. No IP data is collected.
          </p>
        </div>
        <RangeToggle value={range} onChange={setRange} />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Configured users"
          value={o ? o.totalUsers : '—'}
          hint={o ? `+${o.newUsers.d7} this week` : ''}
        />
        <Stat
          label="New users (24h)"
          value={o ? o.newUsers.d1 : '—'}
          hint={o ? `${o.newUsers.d30} in 30d` : ''}
        />
        <Stat
          label="Active users (24h)"
          value={o ? o.activeUsers.d1 : '—'}
          hint={o ? `${o.activeUsers.d7} in 7d` : ''}
        />
        <Stat
          label="Requests (24h)"
          value={o ? o.requests24h.toLocaleString() : '—'}
        />
      </div>

      {/* User growth */}
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold">User growth</h3>
        <DashboardQueryBoundary
          query={users}
          errorTitle="Failed to load user analytics"
        >
          {(d) => (
            <AreaChart
              data={d.growth as any}
              xKey="day"
              series={[
                { key: 'total', label: 'Total', color: 'var(--brand)' },
                { key: 'new', label: 'New' },
              ]}
              height={260}
            />
          )}
        </DashboardQueryBoundary>
      </Card>

      {/* Requests by resource */}
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold">Requests by resource</h3>
        <DashboardQueryBoundary
          query={requests}
          errorTitle="Failed to load request analytics"
        >
          {(d) => (
            <BarChart
              data={d.series as any}
              xKey="day"
              stacked
              series={d.resources.map((r) => ({ key: r }))}
              height={260}
            />
          )}
        </DashboardQueryBoundary>
      </Card>

      {/* Addons */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Addon usage &amp; errors{' '}
            <span className="text-[--muted] font-normal">
              (marketplace defaults only)
            </span>
          </h3>
          {addons.data && (
            <span className="text-xs text-[--muted]">
              {addons.data.customEndpoints} custom endpoint
              {addons.data.customEndpoints === 1 ? '' : 's'} excluded
            </span>
          )}
        </div>
        <DashboardQueryBoundary
          query={addons}
          errorTitle="Failed to load addon analytics"
        >
          {(d) =>
            !d.addons.length ? (
              <p className="text-sm text-[--muted]">
                No addon data for this range.
              </p>
            ) : (
              <div className="grid lg:grid-cols-[1fr,260px] gap-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-[--muted] text-xs uppercase">
                      <tr className="text-left border-b border-[--border]">
                        <th className="py-2">Addon</th>
                        <th className="py-2 text-right">Requests</th>
                        <th className="py-2 text-right">Share</th>
                        <th className="py-2 text-right">Errors</th>
                        <th className="py-2 text-right">Err %</th>
                        <th className="py-2 text-right">Avg ms</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.addons.map((a) => (
                        <tr
                          key={a.presetId}
                          className="border-b border-[--border]/50"
                        >
                          <td className="py-2 font-medium">{a.presetId}</td>
                          <td className="py-2 text-right tabular-nums">
                            {a.requests.toLocaleString()}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {a.share}%
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {a.errors}
                          </td>
                          <td
                            className={cn(
                              'py-2 text-right tabular-nums',
                              a.errorRate > 10 && 'text-red-500'
                            )}
                          >
                            {a.errorRate}%
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {a.avgLatencyMs ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <DonutChart
                  data={d.addons.slice(0, 6).map((a) => ({
                    name: a.presetId,
                    value: a.requests,
                  }))}
                  centerLabel="requests"
                  centerValue={d.total.toLocaleString()}
                />
              </div>
            )
          }
        </DashboardQueryBoundary>
      </Card>

      {/* Feature usage — what users have configured. Counts are distinct
          users (uuid_hashes) per day per key, summed across the window.
          Drives roadmap decisions: which services/presets actually get used. */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Feature usage</h3>
          <span className="text-xs text-[--muted]">
            distinct users per day, summed
          </span>
        </div>
        <DashboardQueryBoundary
          query={features}
          errorTitle="Failed to load feature analytics"
        >
          {(d) => (
            <div className="grid lg:grid-cols-3 gap-6">
              <FeatureList title="Services" rows={d.service} />
              <FeatureList title="Formatters" rows={d.formatter} />
              <FeatureList title="Presets" rows={d.preset} />
            </div>
          )}
        </DashboardQueryBoundary>
      </Card>

      {/* Top users */}
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold">
          Most active users (hashed)
        </h3>
        <DashboardQueryBoundary
          query={users}
          errorTitle="Failed to load top users"
        >
          {(d) =>
            !d.topUsers.length ? (
              <p className="text-sm text-[--muted]">No data for this range.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {d.topUsers.map((u) => (
                    <tr
                      key={u.uuidHash}
                      className="border-b border-[--border]/50"
                    >
                      <td className="py-1.5 font-mono text-xs text-[--muted]">
                        {u.uuidHash.slice(0, 16)}…
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {u.requests.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </DashboardQueryBoundary>
      </Card>
    </PageWrapper>
  );
}
