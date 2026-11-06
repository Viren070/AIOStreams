import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { Drawer } from '@aiostreams/ui/drawer';
import { cn } from '@aiostreams/ui/core/styling';
import { airTime, clock } from '../../lib/format';
import {
  airedShare,
  airingAt,
  caughtUp,
  rememberChannel,
  startOf,
  useChannelByNumber,
  useLineup,
  useNow,
  useSchedules,
} from '../../lib/live-tv';
import { party } from '../../lib/party/party';
import { lastVersions } from '../../lib/playback/play';
import { zapTo } from '../../lib/playback/session';
import type { PlayerController } from '../../lib/playback/controller';
import { useRestoreFocus } from '../../lib/input';
import type { BaseItemDto } from '../../lib/types';
import { ChannelList, useRowSchedules } from '../channel-list';

/** The channel zapped away from, which the sheet offers to go back to. */
let previousChannel: string | null = null;

function zap(from: string, to: string) {
  previousChannel = from;
  rememberChannel(to);
  zapTo({ itemId: to, sourceId: lastVersions.get(to) ?? '', startMs: 0 });
}

export interface Zap {
  /** Missing where the channel isn't in the list the live page showed. */
  step?: (sign: number) => void;
  /** False when no channel has that number. */
  toNumber(number: string): Promise<boolean>;
  lineup: BaseItemDto[];
  play(channel: BaseItemDto): void;
  previous?: () => void;
}

/** The channels around the playing one, from the live page's list. */
export function useZap(itemId: string, enabled: boolean): Zap | undefined {
  const lineup = useLineup();
  const byNumber = useChannelByNumber();
  if (!enabled) return undefined;
  // A party plays one title for everyone.
  const solo = party.state()?.status !== 'live';
  const at = lineup.findIndex((c) => c.Id === itemId);
  const play = (channel: BaseItemDto) => {
    if (solo && channel.Id !== itemId) zap(itemId, channel.Id!);
  };
  return {
    step:
      solo && at >= 0 && lineup.length > 1
        ? (sign) => play(lineup[(at + sign + lineup.length) % lineup.length])
        : undefined,
    // The list is the live page's group; numbers run through the whole lineup.
    toNumber: async (number) => {
      const found =
        lineup.find((c) => c.ChannelNumber === number) ??
        (await byNumber(number));
      if (found) play(found);
      return !!found;
    },
    lineup,
    play,
    previous:
      solo && previousChannel && previousChannel !== itemId
        ? () => zap(itemId, previousChannel!)
        : undefined,
  };
}

export interface LiveChannel extends Zap {
  programme?: BaseItemDto;
  next?: BaseItemDto;
  /** Plays a programme from its start, where its channel keeps it. */
  fromStart(programme: BaseItemDto): void;
}

/** What is on the playing channel, and the channels to zap to. */
export function useLiveChannel(
  item: BaseItemDto,
  enabled: boolean
): LiveChannel | undefined {
  const now = useNow();
  const schedules = useSchedules([[item.Id!]], { enabled });
  const zapping = useZap(item.Id!, enabled);
  if (!zapping) return undefined;
  const programmes = schedules.get(item.Id!) ?? [];
  return {
    ...zapping,
    fromStart: (programme) =>
      zapTo({ itemId: programme.Id!, sourceId: '', startMs: 0 }),
    programme:
      airingAt(programmes, now) ??
      (item.CurrentProgram && airingAt([item.CurrentProgram], now)),
    next: programmes.find((p) => startOf(p) > now),
  };
}

/** How far a pause left a live source behind its edge, by the clock. */
export function useBehindLive(player: PlayerController) {
  const { paused, reconnecting } = player.state;
  const [behindMs, setBehindMs] = React.useState(0);
  const [pausedAt, setPausedAt] = React.useState<number | null>(null);
  /** Pauses before the source last joined its edge don't count. */
  const joinedAt = React.useRef(0);
  React.useEffect(() => {
    if (!paused) return;
    const at = Date.now();
    setPausedAt(at);
    return () => {
      setPausedAt(null);
      const from = Math.max(at, joinedAt.current);
      setBehindMs((ms) => ms + Math.max(0, Date.now() - from));
    };
  }, [paused]);
  const join = React.useCallback(() => {
    joinedAt.current = Date.now();
    setBehindMs(0);
  }, []);
  React.useEffect(() => {
    if (reconnecting) join();
  }, [reconnecting, join]);
  const now = useNow(1000, pausedAt !== null);
  const goLive = () => {
    join();
    player.goLive?.();
  };
  return {
    behindMs: behindMs + (pausedAt === null ? 0 : Math.max(0, now - pausedAt)),
    goLive,
  };
}

/** In place of the seek bar: the programme on now, and how far it has aired. */
export function LiveBar({
  channel,
  behindMs,
  onGoLive,
}: {
  channel: LiveChannel;
  behindMs: number;
  onGoLive(): void;
}) {
  const now = useNow();
  const { programme } = channel;
  const behind = behindMs >= 1000;
  const from = programme?.StartDate ? airTime(programme.StartDate) : null;
  const to = programme?.EndDate ? airTime(programme.EndDate) : null;
  return (
    <div data-ui="player-live" className="space-y-2 px-0.5 pb-2">
      <div className="flex items-center gap-3 text-xs sm:text-[length:var(--time)]">
        <button
          type="button"
          data-ui="live-pill"
          data-behind={behind || undefined}
          disabled={!behind}
          aria-label={behind ? t`Go live` : undefined}
          title={behind ? t`Go live` : undefined}
          onClick={onGoLive}
          className={cn(
            'flex flex-none items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wide',
            behind ? 'bg-white/20 hover:bg-white/30' : 'bg-red-600'
          )}
        >
          <span
            className={cn(
              'size-1.5 rounded-full',
              behind ? 'bg-white/60' : 'bg-white'
            )}
          />
          {behind ? <Trans>Go live</Trans> : <Trans>Live</Trans>}
        </button>
        {behind && (
          <span data-name="behind" className="tabular-nums text-gray-300">
            -{clock(behindMs)}
          </span>
        )}
        {programme && (
          <span data-name="programme" className="min-w-0 truncate">
            {programme.Name}
          </span>
        )}
        {caughtUp(programme) && (
          <button
            type="button"
            data-ui="live-from-start"
            className="flex-none rounded-md bg-white/20 px-2 py-0.5 text-xs font-semibold hover:bg-white/30"
            onClick={() => channel.fromStart(programme!)}
          >
            <Trans>From the start</Trans>
          </button>
        )}
        {from && to && (
          <span className="ms-auto flex-none tabular-nums text-gray-300">
            {from} – {to}
          </span>
        )}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-white/20">
        <div
          className="h-full bg-white"
          style={{
            width: `${programme ? airedShare(programme, now) * 100 : 100}%`,
          }}
        />
      </div>
    </div>
  );
}

/** The live page's channels, to zap to from the player. */
export function ChannelsSheet({
  item,
  channel,
  open,
  onClose,
}: {
  item: BaseItemDto;
  channel: LiveChannel;
  open: boolean;
  onClose(): void;
}) {
  const { lineup } = channel;
  const now = useNow();
  const restoreFocus = useRestoreFocus(open);
  const { schedules, onRange } = useRowSchedules(lineup);
  const playingAt = Math.max(
    0,
    lineup.findIndex((c) => c.Id === item.Id)
  );
  const placed = React.useMemo(() => ({ row: playingAt }), [playingAt]);
  return (
    <Drawer
      data-ui="dialog"
      data-name="channels"
      open={open}
      onOpenChange={(next) => !next && onClose()}
      onCloseAutoFocus={restoreFocus}
      title={t`Channels`}
      headerClass="sr-only"
      side="right"
      size="md"
      contentClass="flex flex-col gap-0 overflow-hidden p-0"
      closeClass="end-2 top-[calc(0.75rem+env(safe-area-inset-top))]"
    >
      <div className="flex items-center gap-3 px-4 pb-3 pe-12 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <p className="text-xs font-semibold uppercase tracking-wider text-[--muted]">
          <Trans>Channels</Trans>
        </p>
        {channel.previous && (
          <button
            type="button"
            data-ui="previous-channel"
            className="ms-auto rounded-full bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20"
            onClick={() => {
              onClose();
              channel.previous?.();
            }}
          >
            <Trans>Previous channel</Trans>
          </button>
        )}
      </div>
      {open && (
        <ChannelList
          className="min-h-0 flex-1 px-2 pb-[env(safe-area-inset-bottom)]"
          channels={lineup}
          total={lineup.length}
          schedules={schedules}
          now={now}
          placed={placed}
          playingId={item.Id}
          onPlay={(picked) => {
            onClose();
            channel.play(picked);
          }}
          onRange={onRange}
        />
      )}
    </Drawer>
  );
}
