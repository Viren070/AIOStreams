import React from 'react';
import { toast } from 'sonner';
import { BiPlay, BiStopCircle } from 'react-icons/bi';
import { Card } from '@/components/ui/card';
import { Stat } from '@/components/ui/charts';
import { IconButton } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/components/ui/core/styling';
import {
  useUsenetLive,
  useStopStream,
  liveFrameMs,
  type LiveStreamInfo,
} from './queries';
import { AnimatedNumber } from '@/components/shared/animated-number';
import { formatBytes, formatSpeed, formatClock } from '@/lib/format';

/** Progress = (range start + bytes served) / file size, clamped to [0, 1]. */
function progressOf(s: LiveStreamInfo): number {
  if (!s.size) return 0;
  return Math.min(1, Math.max(0, (s.start + s.bytesServed) / s.size));
}

function StreamRow({
  stream,
  now,
  frameMs,
}: {
  stream: LiveStreamInfo;
  now: number;
  frameMs: number;
}) {
  const pct = progressOf(stream);
  const active = stream.bytesPerSec > 0;
  const stop = useStopStream();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <BiPlay className="text-[--muted] shrink-0" />
        <span className="flex-1 text-sm font-medium break-all">
          {stream.filename || stream.nzbHash}
        </span>
        <span className="text-xs tabular-nums text-[--muted] shrink-0">
          <AnimatedNumber
            value={stream.bytesPerSec}
            format={formatSpeed}
            durationSec={frameMs / 1000}
          />
        </span>
        <Tooltip
          trigger={
            <IconButton
              size="sm"
              intent="alert-subtle"
              icon={<BiStopCircle />}
              aria-label="Stop stream"
              disabled={stop.isPending}
              onClick={() =>
                stop
                  .mutateAsync(stream.id)
                  .then(() => toast.success('Stream stopped'))
                  .catch((e: any) =>
                    toast.error(e?.message ?? 'Failed to stop stream')
                  )
              }
            />
          }
        >
          Stop stream
        </Tooltip>
      </div>
      <div className="h-1.5 w-full rounded-full bg-[--subtle] overflow-hidden">
        <div
          className={cn(
            'h-full bg-brand',
            'transition-[width] ease-linear motion-reduce:transition-none',
            active && 'animate-pulse'
          )}
          style={{
            width: `${pct * 100}%`,
            transitionDuration: `${frameMs}ms`,
          }}
        />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[--muted] tabular-nums">
        <span>
          <AnimatedNumber
            value={pct * 100}
            format={(n) => `${Math.round(n)}%`}
            durationSec={frameMs / 1000}
            ease="linear"
          />
        </span>
        <span>
          <AnimatedNumber
            value={stream.start + stream.bytesServed}
            format={formatBytes}
            durationSec={frameMs / 1000}
            ease="linear"
          />
          {stream.size ? ` / ${formatBytes(stream.size)}` : ''}
        </span>
        <span>
          <AnimatedNumber
            value={stream.bytesServed}
            format={formatBytes}
            durationSec={frameMs / 1000}
            ease="linear"
          />{' '}
          this session
        </span>
        <span>{formatClock(now - stream.openedAt)} elapsed</span>
      </div>
    </div>
  );
}

/**
 * Live "Streams" view: one row per in-flight read stream (active playback or
 * download range), with progress, current speed and elapsed time. Backed by the
 * engine's per-stream registry surfaced on `/dashboard/usenet/live`.
 */
export function UsenetStreamsPage() {
  const live = useUsenetLive();
  const streams = live.data?.streams ?? [];
  const frameMs = liveFrameMs(live.data);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const totalSpeed = streams.reduce((s, x) => s + x.bytesPerSec, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Active streams" value={String(streams.length)} />
        <Stat
          label="Combined speed"
          value={
            <AnimatedNumber
              value={totalSpeed}
              format={formatSpeed}
              durationSec={frameMs / 1000}
            />
          }
        />
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Ongoing streams</h3>
        {streams.length === 0 ? (
          <p className="text-sm text-[--muted]">
            No active streams — connections open on demand when streaming.
          </p>
        ) : (
          <div className="space-y-4">
            {streams.map((s) => (
              <StreamRow key={s.id} stream={s} now={now} frameMs={frameMs} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
