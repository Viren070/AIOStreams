import React from 'react';
import { FiInfo } from 'react-icons/fi';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/components/ui/core/styling';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import { AreaChart, BarChart, DonutChart, Stat } from '@/components/ui/charts';
import { formatBytes, formatCompact } from '@/lib/format';

/**
 * A number shown in compact form (`1.2M`) with the exact value revealed in a
 * tooltip on hover. Values below 1,000 aren't abbreviated, so no tooltip.
 */
function CompactNumber({ value }: { value: number }) {
  const compact = formatCompact(value);
  const full = value.toLocaleString();
  if (compact === full) return <span className="tabular-nums">{compact}</span>;
  return (
    <Tooltip
      trigger={
        <span className="tabular-nums cursor-default border-b border-dotted border-[--muted]/40">
          {compact}
        </span>
      }
    >
      {full}
    </Tooltip>
  );
}
import {
  useOverview,
  useUsersAnalytics,
  useRequestsAnalytics,
  useAddonsAnalytics,
  useAddonPerformanceAnalytics,
  useFeaturesAnalytics,
  useUserActivity,
  type Range,
  type FeatureEntry,
  type AddonPerformanceRow,
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
                <span className="text-[--muted]">
                  <CompactNumber value={r.count} />
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

/**
 * Drill-down for one row of the "most active users" table: request split by
 * resource plus every anonymized IP prefix the (hashed) user was seen from.
 */
function UserActivityModal({
  uuidHash,
  range,
  onClose,
}: {
  uuidHash: string | null;
  range: Range;
  onClose: () => void;
}) {
  const activity = useUserActivity(uuidHash, range);
  const d = activity.data;
  const maxResource = d ? Math.max(1, ...d.resources.map((r) => r.count)) : 1;

  return (
    <Modal
      open={!!uuidHash}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="User activity"
      description={
        uuidHash
          ? `Hashed config ${uuidHash.slice(0, 16)} · ${range}`
          : undefined
      }
      contentClass="max-w-xl"
    >
      {activity.isLoading ? (
        <p className="text-sm text-[--muted]">Loading…</p>
      ) : activity.isError ? (
        <p className="text-sm text-red-500">Failed to load user activity.</p>
      ) : !d ? null : (
        <div className="space-y-5">
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[--muted]">
              Requests by resource
            </h4>
            {d.resources.length === 0 ? (
              <p className="text-sm text-[--muted]">
                No requests in this range.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {d.resources.map((r) => (
                  <li key={r.resource} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{r.resource}</span>
                      <span className="text-[--muted]">
                        <CompactNumber value={r.count} />
                      </span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-[--subtle]">
                      <div
                        className="h-full bg-brand"
                        style={{
                          width: `${(r.count / maxResource) * 100}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[--muted]">
              IP addresses ({d.ips.length})
            </h4>
            {d.ips.length === 0 ? (
              <p className="text-sm text-[--muted]">
                No IP data recorded for this user.
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-[--muted]">
                    <tr className="border-b border-[--border] text-left">
                      <th className="py-1.5 pr-3">Anonymized IP</th>
                      <th className="py-1.5 px-3 text-right">Requests</th>
                      <th className="py-1.5 pl-3 text-right">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.ips.map((ip) => (
                      <tr
                        key={ip.ipPrefix}
                        className="border-b border-[--border]/50"
                      >
                        <td className="py-1.5 pr-3 font-mono text-xs">
                          {ip.ipPrefix}
                        </td>
                        <td className="py-1.5 px-3 text-right">
                          <CompactNumber value={ip.count} />
                        </td>
                        <td className="py-1.5 pl-3 text-right whitespace-nowrap text-[--muted]">
                          {new Date(ip.lastSeen).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

type PerformanceSortKey =
  | 'score'
  | 'requests'
  | 'availabilityRate'
  | 'finalResults'
  | 'finalShare'
  | 'topRankRate'
  | 'largestSourceRate'
  | 'avgSizeBytes'
  | 'maxSizeBytes'
  | 'errorRate'
  | 'avgLatencyMs';

const PERFORMANCE_COLUMNS: Array<{
  key: PerformanceSortKey;
  label: string;
  title: string;
}> = [
  { key: 'score', label: 'Score', title: 'Size-neutral overall score' },
  { key: 'requests', label: 'Samples', title: 'Requests measured' },
  {
    key: 'availabilityRate',
    label: 'Found %',
    title: 'Requests where the addon returned at least one source',
  },
  {
    key: 'finalResults',
    label: 'Final',
    title: 'Sources surviving the complete AIOStreams pipeline',
  },
  {
    key: 'finalShare',
    label: 'Share %',
    title: 'Share of all surviving sources in this range',
  },
  {
    key: 'topRankRate',
    label: '#1 %',
    title: 'Requests where this addon supplied the first-ranked result',
  },
  {
    key: 'largestSourceRate',
    label: 'Largest %',
    title: 'Requests where this addon supplied the largest known-size result',
  },
  {
    key: 'avgSizeBytes',
    label: 'Avg size',
    title: 'Average known source size',
  },
  {
    key: 'maxSizeBytes',
    label: 'Max size',
    title: 'Largest known source size',
  },
  { key: 'errorRate', label: 'Err %', title: 'Addon request error rate' },
  {
    key: 'avgLatencyMs',
    label: 'Avg ms',
    title: 'Average addon response latency',
  },
];

function numericPerformanceValue(
  row: AddonPerformanceRow,
  key: PerformanceSortKey
): number {
  return Number(row[key] ?? -1);
}

function AddonPerformanceTable({ rows }: { rows: AddonPerformanceRow[] }) {
  const [sortKey, setSortKey] = React.useState<PerformanceSortKey>('score');
  const [ascending, setAscending] = React.useState(false);
  const sorted = React.useMemo(
    () =>
      [...rows].sort((a, b) => {
        const delta =
          numericPerformanceValue(a, sortKey) -
          numericPerformanceValue(b, sortKey);
        return (ascending ? delta : -delta) || b.requests - a.requests;
      }),
    [ascending, rows, sortKey]
  );
  const selectSort = (key: PerformanceSortKey) => {
    if (key === sortKey) setAscending((value) => !value);
    else {
      setSortKey(key);
      setAscending(key === 'avgLatencyMs' || key === 'errorRate');
    }
  };

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full min-w-[1180px] text-sm">
        <thead className="text-xs uppercase text-[--muted]">
          <tr className="border-b border-[--border] text-left">
            <th className="py-2 pr-3">Rank / addon</th>
            {PERFORMANCE_COLUMNS.map((column) => (
              <th key={column.key} className="py-2 px-2 text-right">
                <button
                  type="button"
                  title={column.title}
                  className={cn(
                    'whitespace-nowrap hover:text-[--foreground]',
                    sortKey === column.key && 'text-brand'
                  )}
                  onClick={() => selectSort(column.key)}
                >
                  {column.label}
                  {sortKey === column.key ? (ascending ? ' ↑' : ' ↓') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr
              key={`${row.presetId}:${row.instanceHash}`}
              className="border-b border-[--border]/50 align-top"
            >
              <td className="py-2.5 pr-3">
                <div className="flex gap-2">
                  <span className="w-6 shrink-0 text-right font-semibold text-[--muted]">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="font-medium">{row.addonName}</div>
                    <div className="text-[10px] text-[--muted]">
                      {row.presetId} · {row.instanceHash.slice(0, 8)} · cached{' '}
                      {row.streamTypes.cached} · uncached{' '}
                      {row.streamTypes.uncached} · p2p {row.streamTypes.p2p} ·
                      usenet {row.streamTypes.usenet}
                    </div>
                  </div>
                </div>
              </td>
              <td className="py-2.5 px-2 text-right font-semibold tabular-nums">
                {row.score}
                <div
                  className="text-[10px] font-normal text-[--muted]"
                  title="Confidence reaches 100% at 25 measured requests"
                >
                  {row.confidence}% conf.
                </div>
              </td>
              <td className="py-2.5 px-2 text-right">
                <CompactNumber value={row.requests} />
              </td>
              <td className="py-2.5 px-2 text-right tabular-nums">
                {row.availabilityRate}%
              </td>
              <td className="py-2.5 px-2 text-right">
                <CompactNumber value={row.finalResults} />
                <div className="text-[10px] text-[--muted]">
                  {row.survivalRate}% survived
                </div>
              </td>
              <td className="py-2.5 px-2 text-right tabular-nums">
                {row.finalShare}%
              </td>
              <td className="py-2.5 px-2 text-right tabular-nums">
                {row.topRankRate}%
              </td>
              <td className="py-2.5 px-2 text-right tabular-nums">
                {row.largestSourceRate}%
              </td>
              <td className="py-2.5 px-2 text-right whitespace-nowrap">
                {row.avgSizeBytes ? formatBytes(row.avgSizeBytes) : '—'}
              </td>
              <td className="py-2.5 px-2 text-right whitespace-nowrap">
                {row.maxSizeBytes ? formatBytes(row.maxSizeBytes) : '—'}
              </td>
              <td
                className={cn(
                  'py-2.5 px-2 text-right tabular-nums',
                  row.errorRate > 10 && 'text-red-500'
                )}
              >
                {row.errorRate}%
              </td>
              <td className="py-2.5 pl-2 text-right tabular-nums">
                {row.avgLatencyMs ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AnalyticsPage() {
  const [range, setRange] = React.useState<Range>('7d');
  const [selectedUser, setSelectedUser] = React.useState<string | null>(null);
  const overview = useOverview();
  const users = useUsersAnalytics(range);
  const requests = useRequestsAnalytics(range);
  const addons = useAddonsAnalytics(range);
  const addonPerformance = useAddonPerformanceAnalytics(range);
  const features = useFeaturesAnalytics(range);

  const o = overview.data;

  return (
    <PageWrapper className="p-4 sm:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2>Analytics</h2>
          <p className="text-[--muted]">
            Usage, requests and addon health. Only anonymized IP prefixes (first
            3 octets) are stored.
          </p>
        </div>
        <RangeToggle value={range} onChange={setRange} />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Configured users"
          value={o ? <CompactNumber value={o.totalUsers} /> : '—'}
          hint={o ? `+${formatCompact(o.newUsers.d7)} this week` : ''}
        />
        <Stat
          label="New users (24h)"
          value={o ? <CompactNumber value={o.newUsers.d1} /> : '—'}
          hint={o ? `${formatCompact(o.newUsers.d30)} in 30d` : ''}
        />
        <Stat
          label="Active users (24h)"
          value={o ? <CompactNumber value={o.activeUsers.d1} /> : '—'}
          hint={o ? `${formatCompact(o.activeUsers.d7)} in 7d` : ''}
        />
        <Stat
          label="Requests (24h)"
          value={o ? <CompactNumber value={o.requests24h} /> : '—'}
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

      {/* Durable addon quality evidence. One compact row per addon/day is
          stored; no titles, media ids, URLs or user identifiers. */}
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Addon performance ranking</h3>
            <p className="text-xs text-[--muted]">
              Sort any column to compare availability, surviving results,
              first-place wins, largest-source wins, size, errors and latency.
            </p>
          </div>
          {addonPerformance.data ? (
            <Tooltip
              trigger={
                <span className="inline-flex cursor-help items-center gap-1 text-xs text-[--muted]">
                  <FiInfo /> How score works
                </span>
              }
            >
              {addonPerformance.data.scoreFormula}
            </Tooltip>
          ) : null}
        </div>
        <DashboardQueryBoundary
          query={addonPerformance}
          errorTitle="Failed to load addon performance"
        >
          {(d) =>
            d.addons.length ? (
              <>
                <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat
                    label="Measured addon calls"
                    value={<CompactNumber value={d.totalRequests} />}
                  />
                  <Stat
                    label="Surviving sources"
                    value={<CompactNumber value={d.totalFinalResults} />}
                  />
                  <Stat
                    label="Top overall"
                    value={d.addons[0]?.addonName ?? '—'}
                    hint={d.addons[0] ? `score ${d.addons[0].score}` : ''}
                  />
                  <Stat
                    label="Storage model"
                    value="Daily rollup"
                    hint="compact counters only"
                  />
                </div>
                <AddonPerformanceTable rows={d.addons} />
              </>
            ) : (
              <p className="text-sm text-[--muted]">
                No stream requests have been measured for this range yet.
              </p>
            )
          }
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
              <div className="grid lg:grid-cols-[1fr,240px] gap-6 items-center">
                <div className="overflow-x-auto -mx-4 px-4 lg:mx-0 lg:px-0">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead className="text-[--muted] text-xs uppercase">
                      <tr className="text-left border-b border-[--border]">
                        <th className="py-2 pr-3">Addon</th>
                        <th className="py-2 px-3 text-right">Requests</th>
                        <th className="py-2 px-3 text-right">Share</th>
                        <th className="py-2 px-3 text-right">Errors</th>
                        <th className="py-2 px-3 text-right">Err %</th>
                        <th className="py-2 pl-3 text-right">Avg ms</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.addons.map((a) => (
                        <tr
                          key={a.presetId}
                          className="border-b border-[--border]/50"
                        >
                          <td className="py-2 pr-3 font-medium">
                            {a.presetId}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <CompactNumber value={a.requests} />
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">
                            {a.share}%
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">
                            {a.errors}
                          </td>
                          <td
                            className={cn(
                              'py-2 px-3 text-right tabular-nums',
                              a.errorRate > 10 && 'text-red-500'
                            )}
                          >
                            {a.errorRate}%
                          </td>
                          <td className="py-2 pl-3 text-right tabular-nums">
                            {a.avgLatencyMs ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mx-auto w-full max-w-[240px] aspect-square">
                  <DonutChart
                    data={d.addons.slice(0, 6).map((a) => ({
                      name: a.presetId,
                      value: a.requests,
                    }))}
                    centerLabel="requests"
                    centerValue={formatCompact(d.total)}
                    height={240}
                  />
                </div>
              </div>
            )
          }
        </DashboardQueryBoundary>
      </Card>

      {/* Feature usage — what users have configured. Counts are distinct
          users per day per key, summed across the window.
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
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {d.topUsers.map((u) => (
                      <tr
                        key={u.uuidHash}
                        className="border-b border-[--border]/50"
                      >
                        <td className="py-1.5 font-mono text-xs text-[--muted] break-all">
                          {u.uuidHash.slice(0, 16)}
                        </td>
                        <td className="py-1.5 pl-3 text-right whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <CompactNumber value={u.requests} />
                            <Tooltip
                              trigger={
                                <button
                                  onClick={() => setSelectedUser(u.uuidHash)}
                                  aria-label="View user activity"
                                  className="text-[--muted] transition-colors hover:text-brand"
                                >
                                  <FiInfo className="size-4" />
                                </button>
                              }
                            >
                              View activity
                            </Tooltip>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </DashboardQueryBoundary>
      </Card>

      <UserActivityModal
        uuidHash={selectedUser}
        range={range}
        onClose={() => setSelectedUser(null)}
      />
    </PageWrapper>
  );
}
