import React from 'react';
import { Card } from '@aiostreams/ui/card';
import { Stat } from '@aiostreams/ui/charts';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import { AnimatedNumber } from '@/components/shared/animated-number';
import { formatSpeed } from '@aiostreams/ui/core/format';
import { useLiveStreams, liveFrameMs } from './queries';
import { StreamRow } from './_components/stream-row';
import { BlockModal, type BlockTarget } from './_components/block-modal';

/** Live view: one row per in-flight watch, across both transports. */
export function StreamsActivePage() {
  const live = useLiveStreams();
  const frameMs = liveFrameMs(live.data);
  const streams = live.data?.streams ?? [];
  const summary = live.data?.summary;
  const [blocking, setBlocking] = React.useState<BlockTarget | null>(null);

  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label="Streaming"
          value={String(summary?.streaming ?? 0)}
          hint={
            summary?.connectionLimit
              ? `Pushing bytes right now · ${summary.connectionLimit} concurrent streams allowed`
              : 'Pushing bytes right now'
          }
        />
        <Stat
          label="Paused"
          value={String((summary?.paused ?? 0) + (summary?.idle ?? 0))}
          hint="Connected or waiting, but nothing moving"
        />
        <Stat
          label="Combined speed"
          className="col-span-2 lg:col-span-1"
          value={
            <AnimatedNumber
              value={summary?.totalBytesPerSec ?? 0}
              format={formatSpeed}
              durationSec={frameMs / 1000}
            />
          }
        />
      </div>

      <DashboardQueryBoundary
        query={live}
        errorTitle="Failed to load active streams"
      >
        {() =>
          streams.length === 0 ? (
            <Card className="p-8">
              <p className="text-center text-sm text-[--muted]">
                Nothing streaming right now — rows appear as soon as a player
                starts pulling bytes through the proxy or the usenet engine.
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {streams.map((s) => (
                <StreamRow
                  key={s.id}
                  stream={s}
                  now={now}
                  frameMs={frameMs}
                  onBlock={setBlocking}
                />
              ))}
            </div>
          )
        }
      </DashboardQueryBoundary>

      <BlockModal target={blocking} onClose={() => setBlocking(null)} />
    </div>
  );
}
