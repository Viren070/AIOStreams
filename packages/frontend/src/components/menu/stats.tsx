import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageWrapper } from '../shared/page-wrapper';
import { SettingsCard } from '../shared/settings-card';
import { useStatus } from '@/context/status';
import { useUserData } from '@/context/userData';
import {
  fetchUserAnalytics,
  type UserAnalyticsResponse,
  type UserAnalyticsAddon,
} from '@/lib/api';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent } from '../ui/card';
import { cn } from '../ui/core/styling';

/**
 * Per-user request stats for the configure-page Stats tab.
 *
 * Reads the live `addon_contribution` events for the signed-in user only —
 * the API hashes the uuid server-side, so a user can never request another
 * user's data.
 *
 * Data window is clamped server-side to whatever raw retention is configured
 * (typically 7d). If the instance owner disables analytics globally OR
 * per-user, the API returns 403 and we fall back to a friendly message.
 */
export function StatsMenu() {
  return (
    <PageWrapper className="space-y-4 p-4 sm:p-8">
      <Content />
    </PageWrapper>
  );
}

function Content() {
  const { status } = useStatus();
  const user = useUserData();
  const [range, setRange] = React.useState<'24h' | '7d'>('7d');

  const isSignedIn = Boolean(user.uuid && user.password);
  const enabledOnInstance = status?.settings.userAnalyticsEnabled === true;

  const query = useQuery({
    queryKey: ['user-analytics', user.uuid, range],
    queryFn: () => fetchUserAnalytics(user.uuid!, user.password!, range),
    enabled: isSignedIn && enabledOnInstance,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  return (
    <>
      <div className="flex items-center w-full">
        <div>
          <h2>Stats</h2>
          <p className="text-[--muted]">
            Per-user breakdown of how your addons performed across recent stream
            requests. Data window is up to{' '}
            <strong>{range === '24h' ? '24 hours' : '7 days'}</strong>; older
            events are pruned automatically.
          </p>
        </div>
      </div>

      {!isSignedIn && (
        <Alert
          intent="info"
          title="Sign in to see your stats"
          description="The Stats tab queries data attributed to your config UUID. Sign in to your config to view it."
        />
      )}

      {isSignedIn && !enabledOnInstance && (
        <Alert
          intent="warning"
          title="Per-user analytics is disabled"
          description="The owner of this instance has disabled per-user analytics. Ask them to enable it in Settings → Analytics."
        />
      )}

      {isSignedIn && enabledOnInstance && (
        <>
          <Tabs
            value={range}
            onValueChange={(v) => setRange((v as '24h' | '7d') ?? '7d')}
          >
            <TabsList>
              <TabsTrigger value="24h">Last 24h</TabsTrigger>
              <TabsTrigger value="7d">Last 7 days</TabsTrigger>
            </TabsList>
            <TabsContent value={range} className="space-y-4 mt-4">
              {query.isLoading && <LoadingSkeleton />}
              {query.error && (
                <Alert
                  intent="alert"
                  title="Failed to load analytics"
                  description={(query.error as Error).message}
                />
              )}
              {query.data && <StatsView data={query.data} />}
            </TabsContent>
          </Tabs>
        </>
      )}
    </>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-md" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-md" />
    </div>
  );
}

function StatsView({ data }: { data: UserAnalyticsResponse }) {
  const { status } = useStatus();
  const user = useUserData();

  // Build a name lookup for known presets so the table shows friendly labels
  // and we can detect addons that were removed from the user's config but
  // still have stats in the retention window.
  const presetNameByType = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const p of status?.settings.presets ?? []) {
      m.set(p.ID, p.NAME);
    }
    return m;
  }, [status?.settings.presets]);
  const currentTypes = React.useMemo(() => {
    const s = new Set<string>();
    for (const p of user.userData.presets ?? []) s.add(p.type);
    return s;
  }, [user.userData.presets]);

  if (data.totals.requests === 0) {
    return (
      <Alert
        intent="info"
        title="No stream requests yet"
        description="Once Stremio plays something, your stats will start populating. You can refresh this page after watching a few items."
      />
    );
  }

  // Split rows into current vs removed (preset type no longer in config).
  const current: UserAnalyticsAddon[] = [];
  const removed: UserAnalyticsAddon[] = [];
  for (const row of data.perAddon) {
    if (currentTypes.has(row.presetType)) current.push(row);
    else removed.push(row);
  }

  return (
    <div className="space-y-4">
      <KpiRow data={data} />

      <SettingsCard
        title="Per-addon performance"
        description="One row per (preset, addon instance). Quality metrics use only requests that contributed to your final list — addons whose results were dropped because the exit condition fired aren't penalised."
      >
        <AddonTable rows={current} presetNameByType={presetNameByType} />
      </SettingsCard>

      {removed.length > 0 && (
        <SettingsCard
          title="Removed addons (still in retention)"
          description="These addons used to be in your config and still have stats within the retention window. They will disappear naturally once their data ages out."
          titleClassName="text-[--muted]"
        >
          <AddonTable
            rows={removed}
            presetNameByType={presetNameByType}
            muted
          />
        </SettingsCard>
      )}

      {data.perService.length > 0 && (
        <SettingsCard
          title="Per-service breakdown"
          description="Surviving streams attributed to each debrid/cdn service across all merged contributions."
        >
          <ServiceTable rows={data.perService} />
        </SettingsCard>
      )}

      {data.latencyLeaderboard.length > 0 && (
        <SettingsCard
          title="Slowest addons"
          description="Average response time across the window. Only includes addons with at least 3 successful requests."
        >
          <ul className="text-sm divide-y divide-[--border]">
            {data.latencyLeaderboard.map((r, i) => (
              <li
                key={`${r.presetType}-${r.instanceHash}-${i}`}
                className="flex justify-between py-2"
              >
                <span>
                  {r.addonName?.trim() ||
                    presetNameByType.get(r.presetType) ||
                    r.presetType}
                </span>
                <span className="font-mono text-[--muted]">
                  {(r.avgLatencyMs / 1000).toFixed(2)}s
                </span>
              </li>
            ))}
          </ul>
        </SettingsCard>
      )}
    </div>
  );
}

function KpiRow({ data }: { data: UserAnalyticsResponse }) {
  const items = [
    { label: 'Requests', value: data.totals.requests.toLocaleString() },
    {
      label: 'Avg final per request',
      value: data.totals.finalCountAvg.toFixed(1),
    },
    {
      label: 'Cut-off rate',
      value: `${data.totals.cutOffRate}%`,
      muted: data.totals.cutOffRate < 5,
    },
    {
      label: 'Error rate',
      value: `${data.totals.errorRate}%`,
      alert: data.totals.errorRate > 10,
    },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map((it) => (
        <Card key={it.label}>
          <CardContent className="p-4">
            <div className="text-xs text-[--muted] uppercase tracking-wide">
              {it.label}
            </div>
            <div
              className={cn(
                'text-2xl font-semibold mt-1',
                it.alert && 'text-red-400',
                it.muted && 'text-[--muted]'
              )}
            >
              {it.value}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AddonTable({
  rows,
  presetNameByType,
  muted,
}: {
  rows: UserAnalyticsAddon[];
  presetNameByType: Map<string, string>;
  muted?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-[--muted]">No data in this window.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table
        className={cn(
          'w-full text-sm border-collapse',
          muted && 'text-[--muted]'
        )}
      >
        <thead>
          <tr className="text-left border-b border-[--border]">
            <Th>Addon</Th>
            <Th align="right">Requests</Th>
            <Th align="right">Avg final</Th>
            <Th align="right">Final share</Th>
            <Th align="right">Cut-off</Th>
            <Th align="right">Errors</Th>
            <Th align="right">Avg latency</Th>
            <Th>Notes</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            // The user's chosen addon name is the most useful label
            // ("Torrentio (RD)"). Fall back to the preset's friendly name
            // (from /api/status) and finally the raw preset type so we
            // always render *something* readable.
            const presetName =
              presetNameByType.get(r.presetType) ?? r.presetType;
            const displayName = r.addonName?.trim() || presetName;
            const showPresetSubtitle =
              !!r.addonName && r.addonName.trim() !== presetName;
            const notes: string[] = [];
            if (r.redundant) notes.push('Redundant');
            if (r.slow) notes.push('Slow');
            if (r.errorRate > 25) notes.push('Unstable');
            return (
              <tr
                key={`${r.presetType}-${r.instanceHash}`}
                className="border-b border-[--border] last:border-0 hover:bg-[--subtle]/30"
              >
                <Td>
                  <div className="font-medium">{displayName}</div>
                  <div className="text-xs text-[--muted]">
                    {showPresetSubtitle && (
                      <span className="mr-2">{presetName}</span>
                    )}
                    <span className="font-mono">
                      {r.instanceHash.slice(0, 10)}…
                    </span>
                  </div>
                </Td>
                <Td align="right">{r.requests}</Td>
                <Td align="right">{r.avgFinalContribution.toFixed(1)}</Td>
                <Td align="right">{r.finalShare.toFixed(1)}%</Td>
                <Td align="right">
                  <span className={cn(r.cutOffRate > 30 && 'text-amber-400')}>
                    {r.cutOffRate.toFixed(0)}%
                  </span>
                </Td>
                <Td align="right">
                  <span className={cn(r.errorRate > 10 && 'text-red-400')}>
                    {r.errorRate.toFixed(0)}%
                  </span>
                </Td>
                <Td align="right">
                  {r.avgLatencyMs == null
                    ? '—'
                    : `${(r.avgLatencyMs / 1000).toFixed(2)}s`}
                </Td>
                <Td>
                  {notes.length > 0 ? (
                    <span className="text-xs">{notes.join(' · ')}</span>
                  ) : (
                    <span className="text-xs text-[--muted]">OK</span>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ServiceTable({ rows }: { rows: UserAnalyticsResponse['perService'] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b border-[--border]">
            <Th>Service</Th>
            <Th align="right">Streams</Th>
            <Th align="right">Cached</Th>
            <Th align="right">Cached share</Th>
            <Th>Contributing addons</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.serviceId}
              className="border-b border-[--border] last:border-0 hover:bg-[--subtle]/30"
            >
              <Td>
                <span className="font-medium">{r.serviceId}</span>
              </Td>
              <Td align="right">{r.finalCount}</Td>
              <Td align="right">{r.cachedCount}</Td>
              <Td align="right">{r.cachedShare.toFixed(0)}%</Td>
              <Td>
                <span className="text-xs text-[--muted]">
                  {r.contributingAddons.join(', ')}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: 'right' | 'left';
}) {
  return (
    <th
      className={cn(
        'py-2 px-3 text-xs font-semibold text-[--muted] uppercase tracking-wide',
        align === 'right' && 'text-right'
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: 'right' | 'left';
}) {
  return (
    <td className={cn('py-2 px-3', align === 'right' && 'text-right')}>
      {children}
    </td>
  );
}
