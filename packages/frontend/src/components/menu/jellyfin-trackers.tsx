import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, History } from 'lucide-react';
import { FiExternalLink } from 'react-icons/fi';
import { useUserData } from '@/context/userData';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { watchStateTrackersQuery } from '@/lib/queries';
import { DOCS_BASE_URL } from '@/lib/changelog';
import { relativeTime } from '@/lib/format';
import type { TrackerExchange, WatchStateTracker } from '@/lib/api';

const RESOURCE_DOCS_URL = `${DOCS_BASE_URL}/reference/addon-protocol/watch-state`;

function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <History className="h-10 w-10 text-[--muted]" />
      <p className="text-lg font-semibold">{title}</p>
      <p className="max-w-sm text-sm text-[--muted]">{children}</p>
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

function ExchangeLine({
  icon,
  label,
  exchange,
  verb,
  idle,
}: {
  icon: React.ReactNode;
  label: string;
  exchange: TrackerExchange;
  verb: string;
  idle: string;
}) {
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-xs">
      <span className="shrink-0 text-gray-500">{icon}</span>
      <span className="shrink-0 text-gray-300">{label}</span>
      <span
        className={
          exchange.error ? 'truncate text-[--orange]' : 'truncate text-gray-500'
        }
        title={exchange.error ?? undefined}
      >
        ·{' '}
        {exchange.error
          ? `Failed: ${exchange.error}`
          : exchange.lastAt
            ? `${verb} ${relativeTime(exchange.lastAt)}`
            : idle}
      </span>
    </p>
  );
}

function TrackerRow({
  tracker,
  owner,
}: {
  tracker: WatchStateTracker;
  owner?: string;
}) {
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm text-white">
          {tracker.addon}
          {owner && <span className="text-[--muted]"> · {owner}</span>}
        </p>
        {tracker.push && (
          <ExchangeLine
            icon={<ArrowUpRight className="h-3.5 w-3.5" />}
            label="Records your plays"
            exchange={tracker.push}
            verb="Last sent"
            idle="Nothing played yet"
          />
        )}
        {tracker.pull && (
          <ExchangeLine
            icon={<ArrowDownLeft className="h-3.5 w-3.5" />}
            label="Imports your history"
            exchange={tracker.pull}
            verb="Last read"
            idle="Read when a client opens"
          />
        )}
      </div>
      {tracker.status !== 'connected' && (
        <span
          className="shrink-0 rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300"
          title={
            tracker.status === 'auth_expired'
              ? 'The addon rejected its credentials. Sign in to it again, then save.'
              : 'Paused after repeated failures. It is retried every so often.'
          }
        >
          {tracker.status === 'auth_expired' ? 'Reconnect' : 'Paused'}
        </span>
      )}
    </li>
  );
}

export function JellyfinTrackers() {
  const { uuid, password, userData } = useUserData();
  const credentials = React.useMemo(
    () => (uuid ? { uuid, password } : null),
    [uuid, password]
  );
  const { data, isPending, isError, refetch, isFetching } = useQuery(
    watchStateTrackersQuery(credentials)
  );

  if (!credentials) {
    return (
      <EmptyState title="Save to see your trackers">
        Trackers are found from your saved configuration.
      </EmptyState>
    );
  }

  if (isPending) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load your trackers"
        action={
          <Button
            intent="gray-outline"
            size="sm"
            loading={isFetching}
            onClick={() => refetch()}
          >
            Try again
          </Button>
        }
      >
        Your addons may be slow to answer.
      </EmptyState>
    );
  }

  if (!data.push && !data.pull) {
    return (
      <EmptyState title="Watch state sync is off">
        This instance doesn&apos;t exchange watch state with addons.
      </EmptyState>
    );
  }

  if (!data.trackers.length) {
    return (
      <EmptyState
        title="No tracker addons"
        action={
          <Button
            intent="gray-outline"
            size="sm"
            rightIcon={<FiExternalLink />}
            onClick={() =>
              window.open(RESOURCE_DOCS_URL, '_blank', 'noopener,noreferrer')
            }
          >
            Build one
          </Button>
        }
      >
        An addon that supports Watch State can record what you play in Jellyfin
        and bring in what you watched elsewhere. None of yours do yet.
      </EmptyState>
    );
  }

  const personas = userData.jellyfin?.personas ?? [];
  const primaryName =
    userData.jellyfin?.primary?.name || userData.addonName || 'Primary user';
  // Only worth naming whose trackers they are once there is more than one history.
  const named = data.trackers.some((t) => t.persona);

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        {data.push && data.pull
          ? 'Addons that record what you play here and bring in what you watched elsewhere, for Continue Watching and Next Up.'
          : data.push
            ? 'Addons that record what you play here. This instance does not import history from them.'
            : 'Addons that bring in what you watched elsewhere, for Continue Watching and Next Up. This instance does not send them your plays.'}
      </p>
      <ul className="divide-y divide-gray-800 rounded-md border border-gray-800">
        {data.trackers.map((tracker) => (
          <TrackerRow
            key={`${tracker.persona ?? ''}|${tracker.addon}`}
            tracker={tracker}
            owner={
              !named
                ? undefined
                : tracker.persona
                  ? (personas.find((p) => p.id === tracker.persona)?.name ??
                    tracker.persona)
                  : primaryName
            }
          />
        ))}
      </ul>
      <p className="text-xs text-gray-500">
        From your saved configuration. To choose which trackers each user syncs
        with, edit them under Users. To stop an addon syncing, untick Watch
        State in its Resources option.
      </p>
    </div>
  );
}
