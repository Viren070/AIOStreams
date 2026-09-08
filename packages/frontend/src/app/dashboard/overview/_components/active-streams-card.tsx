import React from 'react';
import { BiPause, BiPlayCircle } from 'react-icons/bi';
import { cn } from '@/components/ui/core/styling';
import { AnimatedNumber } from '@/components/shared/animated-number';
import { formatSpeed } from '@/lib/format';
import {
  liveFrameMs,
  useLiveStreams,
  type LiveStreamSession,
} from '@/app/dashboard/streams/queries';
import {
  Pill,
  TransportBadge,
  displayUser,
  streamLabel,
  streamProgress,
} from '@/app/dashboard/streams/_components/shared';
import { CardNote, OverviewCard } from './overview-card';

/** Past this the card stops being a glance; the full view lists everything. */
const MAX_ROWS = 3;

function Row({
  stream,
  frameMs,
}: {
  stream: LiveStreamSession;
  frameMs: number;
}) {
  const streaming = stream.activity === 'streaming';
  const pct = streamProgress(stream);
  return (
    <li className="space-y-1">
      <div className="flex items-center gap-2">
        <TransportBadge transport={stream.transport} />
        <span
          className="min-w-0 flex-1 truncate text-sm"
          title={streamLabel(stream)}
        >
          {streamLabel(stream)}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-[--muted]">
          {streaming ? (
            <AnimatedNumber
              value={stream.bytesPerSec}
              format={formatSpeed}
              durationSec={frameMs / 1000}
            />
          ) : (
            <span className="inline-flex items-center gap-1">
              <BiPause />
              {stream.activity === 'paused' ? 'paused' : 'idle'}
            </span>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-[--subtle]">
          <div
            className="h-full bg-brand transition-[width] ease-linear motion-reduce:transition-none"
            style={{
              width: `${pct * 100}%`,
              transitionDuration: `${frameMs}ms`,
            }}
          />
        </div>
        <Pill>{displayUser(stream.username)}</Pill>
      </div>
    </li>
  );
}

/** What is being served right now, busiest first. */
export function ActiveStreamsCard() {
  const live = useLiveStreams();
  const frameMs = liveFrameMs(live.data);
  const summary = live.data?.summary;
  const streams = live.data?.streams;

  const top = React.useMemo(
    () =>
      [...(streams ?? [])]
        .sort((a, b) => b.bytesPerSec - a.bytesPerSec)
        .slice(0, MAX_ROWS),
    [streams]
  );

  const quiet = (summary?.paused ?? 0) + (summary?.idle ?? 0);
  const hidden = (streams?.length ?? 0) - top.length;

  return (
    <OverviewCard
      to="/dashboard/streams/active"
      icon={BiPlayCircle}
      title="Active streams"
      aside={
        summary && (
          <AnimatedNumber
            value={summary.totalBytesPerSec}
            format={formatSpeed}
            durationSec={frameMs / 1000}
          />
        )
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span
          className={cn(
            'text-2xl font-semibold tabular-nums',
            summary?.streaming ? undefined : 'text-[--muted]'
          )}
        >
          {summary?.streaming ?? '—'}
        </span>
        <span className="text-sm text-[--muted]">streaming</span>
        {quiet > 0 && (
          <span className="text-xs text-[--muted]">· {quiet} paused</span>
        )}
        {summary?.connectionLimit ? (
          <span className="text-xs text-[--muted]">
            · {summary.connectionLimit} allowed at once
          </span>
        ) : null}
      </div>

      {live.isError ? (
        <CardNote>Failed to load active streams.</CardNote>
      ) : top.length === 0 ? (
        <CardNote>Nothing streaming right now.</CardNote>
      ) : (
        <ul className="space-y-2">
          {top.map((s) => (
            <Row key={s.id} stream={s} frameMs={frameMs} />
          ))}
          {hidden > 0 && (
            <li className="text-xs text-[--muted]">
              +{hidden} more {hidden === 1 ? 'stream' : 'streams'}
            </li>
          )}
        </ul>
      )}
    </OverviewCard>
  );
}
