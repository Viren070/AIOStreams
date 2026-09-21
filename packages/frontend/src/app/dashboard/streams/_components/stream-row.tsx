import React from 'react';
import { toast } from 'sonner';
import {
  BiBlock,
  BiDotsVerticalRounded,
  BiPause,
  BiStopCircle,
  BiUserX,
} from 'react-icons/bi';
import { IconButton } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@/components/shared/confirmation-dialog';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/components/ui/core/styling';
import { AnimatedNumber } from '@/components/shared/animated-number';
import { formatBytes, formatClock, formatSpeed } from '@/lib/format';
import {
  useStopStream,
  useStopUserStreams,
  type LiveStreamSession,
} from '../queries';
import {
  ActiveReadsPill,
  ClientIpPill,
  Pill,
  TransportBadge,
  displayUser,
  streamLabel,
  streamProgress,
} from './shared';
import type { BlockTarget } from './block-modal';

export function StreamRow({
  stream,
  now,
  frameMs,
  onBlock,
}: {
  stream: LiveStreamSession;
  now: number;
  frameMs: number;
  onBlock: (target: BlockTarget) => void;
}) {
  const pct = streamProgress(stream);
  const streaming = stream.activity === 'streaming';
  const stop = useStopStream();
  const stopUser = useStopUserStreams();
  const named = Boolean(stream.username);

  const run = (p: Promise<unknown>, ok: string) =>
    p
      .then(() => toast.success(ok))
      .catch((e: any) => toast.error(e?.message ?? 'Action failed'));

  // Confirmed because the viewer cannot undo it, only the operator can.
  const confirmStop = useConfirmationDialog({
    title: 'Stop this stream',
    description: (
      <>
        End <span className="break-all">{streamLabel(stream)}</span> for{' '}
        {displayUser(stream.username)}. Their player will drop, and nothing
        prevents it reconnecting — use a block for that.
      </>
    ),
    actionText: 'Stop',
    actionIntent: 'alert-subtle',
    onConfirm: () => void run(stop.mutateAsync(stream.id), 'Stream stopped'),
  });

  const confirmStopUser = useConfirmationDialog({
    title: `Stop all streams for ${displayUser(stream.username)}`,
    description:
      'End every stream this user currently has open, across the proxy and the usenet engine. They can start new ones immediately unless you also block them.',
    actionText: 'Stop all',
    actionIntent: 'alert-subtle',
    onConfirm: () =>
      void run(
        stopUser.mutateAsync(stream.username),
        'Stopped all their streams'
      ),
  });

  return (
    <div className="space-y-1.5 rounded-lg border border-[--border] bg-[--paper] p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <TransportBadge transport={stream.transport} />
        {stream.activeReads > 1 && (
          <ActiveReadsPill reads={stream.activeReads} />
        )}
        <span
          className="order-last w-full min-w-0 truncate text-sm font-medium sm:order-none sm:w-auto sm:flex-1"
          title={streamLabel(stream)}
        >
          {streamLabel(stream)}
        </span>
        <span className="ml-auto shrink-0 text-xs tabular-nums text-[--muted]">
          {streaming ? (
            <AnimatedNumber
              value={stream.bytesPerSec}
              format={formatSpeed}
              durationSec={frameMs / 1000}
            />
          ) : (
            <span
              className="inline-flex items-center gap-1"
              title={`No bytes for ${formatClock(stream.idleMs)}`}
            >
              <BiPause />
              {stream.activity === 'paused' ? 'paused' : 'idle'}
            </span>
          )}
        </span>
        <Tooltip
          trigger={
            <IconButton
              size="sm"
              intent="alert-subtle"
              icon={<BiStopCircle />}
              aria-label="Stop stream"
              disabled={stop.isPending}
              onClick={confirmStop.open}
            />
          }
        >
          Stop this stream
        </Tooltip>
        <DropdownMenu
          align="end"
          trigger={
            <IconButton
              size="sm"
              intent="gray-subtle"
              icon={<BiDotsVerticalRounded />}
              aria-label="More actions"
            />
          }
        >
          <DropdownMenuLabel>
            {named ? displayUser(stream.username) : 'Unidentified stream'}
          </DropdownMenuLabel>
          <DropdownMenuItem
            disabled={!named}
            onSelect={() =>
              onBlock({
                scope: 'target',
                username: stream.username,
                targetKey: stream.targetKey,
                label: streamLabel(stream),
              })
            }
          >
            <BiBlock />
            Block this title…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!named || stopUser.isPending}
            onSelect={confirmStopUser.open}
          >
            <BiStopCircle />
            Stop all their streams
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!named}
            onSelect={() =>
              onBlock({ scope: 'user', username: stream.username })
            }
          >
            <BiUserX />
            Block this user…
          </DropdownMenuItem>
        </DropdownMenu>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[--subtle]">
        <div
          className={cn(
            'h-full bg-brand transition-[width] ease-linear motion-reduce:transition-none',
            streaming && 'animate-pulse'
          )}
          style={{ width: `${pct * 100}%`, transitionDuration: `${frameMs}ms` }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-[--muted]">
        <Pill>{displayUser(stream.username)}</Pill>
        {stream.clientIp && <ClientIpPill ip={stream.clientIp} />}
        {stream.size > 0 && (
          <span>
            <AnimatedNumber
              value={pct * 100}
              format={(n) => `${Math.round(n)}%`}
              durationSec={frameMs / 1000}
              ease="linear"
            />
          </span>
        )}
        <span>
          <AnimatedNumber
            value={stream.bytesServed}
            format={formatBytes}
            durationSec={frameMs / 1000}
            ease="linear"
          />
          {stream.size > 0 ? ` of ${formatBytes(stream.size)}` : ''} served
        </span>
        <span>
          {stream.requests} request{stream.requests === 1 ? '' : 's'}
        </span>
        <span>{formatClock(now - stream.startedAt)} elapsed</span>
      </div>

      <ConfirmationDialog {...confirmStop} />
      <ConfirmationDialog {...confirmStopUser} />
    </div>
  );
}
