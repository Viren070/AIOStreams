import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { toast } from 'sonner';
import {
  LuCast,
  LuPause,
  LuPlay,
  LuRotateCcw,
  LuRotateCw,
  LuSkipBack,
  LuSkipForward,
  LuSquare,
} from 'react-icons/lu';
import { Drawer } from '@aiostreams/ui/drawer';
import { Button, IconButton } from '@aiostreams/ui/button';
import { Select } from '@aiostreams/ui/select';
import { Slider } from '@aiostreams/ui/slider';
import { LoadingSpinner } from '@aiostreams/ui/loading-spinner';
import { cn } from '@aiostreams/ui/core/styling';
import { clock, itemSubtitle, itemTitle, ticksToMs } from '../lib/format';
import { landscapeUrl, posterUrl } from '../lib/images';
import { useRestoreFocus } from '../lib/input';
import { trackLabel } from '../lib/playback/controller';
import { itemPath, navigate } from '../lib/paths';
import { useRemoteDevices } from '../lib/queries';
import { useRemoteControl, type RemotePlaystate } from '../lib/remote/control';
import type { TrackKind } from '../lib/remote/tracks';
import { useSession } from '../lib/session';
import { storage } from '../lib/storage';
import type { BaseItemDto, SessionInfoDto } from '../lib/types';

interface Opening {
  /** What picking a device plays there. */
  play?: { item: BaseItemDto; startMs: number };
  device?: string;
}

interface Sheet {
  open: boolean;
  opening: Opening;
  /** The device last sent a title, which the pill follows while it plays, across reloads. */
  following: { id: string; at: number } | null;
}

const FOLLOWING_KEY = 'aiostreams-web-remote-following';

let sheet: Sheet = {
  open: false,
  opening: {},
  following: storage.get<Sheet['following']>(FOLLOWING_KEY),
};
const listeners = new Set<() => void>();

function setSheet(next: Partial<Sheet>): void {
  sheet = { ...sheet, ...next };
  if (next.following) storage.set(FOLLOWING_KEY, next.following);
  else if (next.following === null) storage.remove(FOLLOWING_KEY);
  for (const listener of listeners) listener();
}

export const openRemote = (opening: Opening = {}) =>
  setSheet({ open: true, opening });

const closeRemote = () => setSheet({ open: false });

function useSheet() {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => sheet
  );
}

const OPEN_POLL_MS = 5_000;
const FOLLOW_POLL_MS = 20_000;
/** A device given a title may take this long to start it. */
const STARTING_MS = 60_000;

const GUTTER = 'ps-4 pe-[max(1rem,env(safe-area-inset-right))]';

export function RemoteSheet() {
  const { open, opening, following } = useSheet();
  const restoreFocus = useRestoreFocus(open);
  const devices = useRemoteDevices({
    pollMs: open ? OPEN_POLL_MS : following ? FOLLOW_POLL_MS : undefined,
    enabled: open || !!following,
  });
  const control = useRemoteControl();
  const [device, setDevice] = React.useState<string | null>(null);
  const [shown, setShown] = React.useState(opening);
  if (shown !== opening) {
    setShown(opening);
    setDevice(opening.device ?? null);
  }
  const session = devices.data?.find((s) => s.Id === device);

  const pick = (target: SessionInfoDto) => {
    setDevice(target.Id!);
    const play = opening.play;
    if (!play) return;
    setSheet({ opening: { device: target.Id! } });
    control.play(target.Id!, play.item, { startMs: play.startMs }).then(
      () => setSheet({ following: { id: target.Id!, at: Date.now() } }),
      () => toast.error(t`The other device could not be reached`)
    );
  };

  return (
    <>
      <Drawer
        data-ui="dialog"
        data-name="remote"
        open={open}
        onOpenChange={(next) => !next && closeRemote()}
        onCloseAutoFocus={restoreFocus}
        title={session?.DeviceName || t`Play on another device`}
        side="right"
        size="sm"
        contentClass="flex flex-col gap-0 overflow-hidden p-0"
        headerClass={cn(
          GUTTER,
          'pb-3 pt-[calc(1rem+env(safe-area-inset-top))]'
        )}
        closeClass="end-[max(0.5rem,env(safe-area-inset-right))] top-[calc(0.75rem+env(safe-area-inset-top))]"
      >
        <div
          data-nav-group
          className={cn(
            GUTTER,
            'min-h-0 flex-1 overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]'
          )}
        >
          {session ? (
            <Remote
              session={session}
              starting={
                !!following &&
                following.id === session.Id &&
                Date.now() - following.at < STARTING_MS
              }
              onDevices={() => setDevice(null)}
            />
          ) : devices.isLoading ? (
            <LoadingSpinner />
          ) : (
            <Devices devices={devices.data ?? []} onPick={pick} />
          )}
        </div>
      </Drawer>
      <FollowingPill
        session={devices.data?.find((s) => s.Id === following?.id)}
        hidden={open}
      />
    </>
  );
}

function Devices({
  devices,
  onPick,
}: {
  devices: SessionInfoDto[];
  onPick(device: SessionInfoDto): void;
}) {
  const { user } = useSession();
  if (!devices.length)
    return (
      <p className="py-4 text-sm text-[--muted]">
        <Trans>
          No other device is ready. Open the app on another device signed in
          here, and it shows up.
        </Trans>
      </p>
    );
  return (
    <ul className="space-y-2 py-2">
      {devices.map((device) => {
        const playing = device.NowPlayingItem;
        const detail = [
          device.Client,
          device.UserId !== user.Id && device.UserName,
          playing && itemTitle(playing),
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <li key={device.Id}>
            <button
              type="button"
              data-ui="remote-device"
              onClick={() => onPick(device)}
              className="flex w-full items-center gap-3 rounded-xl border border-white/10 p-3 text-start transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]"
            >
              <LuCast className="size-5 flex-none text-[--muted]" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  {device.DeviceName}
                </span>
                <span className="block truncate text-xs text-[--muted]">
                  {detail}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Where the device's player is now, moved on from its last report while it plays. */
function usePosition(session: SessionInfoDto, durationMs: number) {
  const reported = ticksToMs(session.PlayState?.PositionTicks);
  const at = Date.parse(session.LastPlaybackCheckIn ?? '') || Date.now();
  const paused = !!session.PlayState?.IsPaused;
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(timer);
  }, [paused]);
  const moved = paused ? 0 : Math.max(0, Date.now() - at);
  return Math.min(reported + moved, durationMs || Infinity);
}

function Remote({
  session,
  starting,
  onDevices,
}: {
  session: SessionInfoDto;
  starting: boolean;
  onDevices(): void;
}) {
  const { client } = useSession();
  const control = useRemoteControl();
  const item = session.NowPlayingItem;
  const id = session.Id!;
  const durationMs = ticksToMs(item?.RunTimeTicks);
  const position = usePosition(session, durationMs);
  const [seeking, setSeeking] = React.useState<number | null>(null);
  const paused = !!session.PlayState?.IsPaused;
  const commands = session.SupportedCommands ?? [];
  const send = (command: RemotePlaystate, seekMs?: number) =>
    void control
      .playstate(id, command, seekMs)
      .catch(() => toast.error(t`The other device could not be reached`));
  const setTrack = (kind: TrackKind, index: string) =>
    void control
      .track(id, kind, Number(index))
      .catch(() => toast.error(t`The other device could not be reached`));

  if (!item)
    return (
      <div className="space-y-4 py-4">
        <p className="text-sm text-[--muted]">
          {starting ? (
            <Trans>Starting…</Trans>
          ) : (
            <Trans>Nothing is playing there.</Trans>
          )}
        </p>
        <Button
          intent="gray-outline"
          className="w-full rounded-full"
          onClick={onDevices}
        >
          <Trans>Other devices</Trans>
        </Button>
      </div>
    );

  const streams = item.MediaStreams ?? [];
  const audio = streams.filter((s) => s.Type === 'Audio');
  const subtitles = streams.filter((s) => s.Type === 'Subtitle');
  const art =
    landscapeUrl(client, item, { maxWidth: 640 }) ??
    posterUrl(client, item, { maxWidth: 320 });
  const shownMs = seeking ?? position;
  return (
    <div data-ui="remote" className="space-y-5 py-2">
      <button
        type="button"
        data-ui="remote-title"
        onClick={() => {
          closeRemote();
          navigate(itemPath(item));
        }}
        className="block w-full space-y-3 rounded-xl text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]"
      >
        {art && (
          <img
            src={art}
            alt=""
            className="aspect-video w-full rounded-xl bg-gray-900 object-cover"
          />
        )}
        <span className="block min-w-0">
          <span className="block truncate font-semibold">
            {itemTitle(item)}
          </span>
          <span className="block truncate text-sm text-[--muted]">
            {itemSubtitle(item)}
          </span>
        </span>
      </button>
      {session.SupportsMediaControl && (
        <>
          {durationMs > 0 && (
            <div className="space-y-1">
              <Slider
                aria-label={t`Position`}
                min={0}
                max={durationMs}
                step={1_000}
                value={[shownMs]}
                onValueChange={([v]) => setSeeking(v)}
                onValueCommit={([v]) => {
                  setSeeking(null);
                  send('Seek', v);
                }}
              />
              <div className="flex justify-between text-xs tabular-nums text-[--muted]">
                <span>{clock(shownMs)}</span>
                <span>{clock(durationMs)}</span>
              </div>
            </div>
          )}
          <div className="flex items-center justify-center gap-2">
            <IconButton
              intent="gray-subtle"
              className="rounded-full"
              icon={<LuSkipBack />}
              aria-label={t`Previous`}
              onClick={() => send('PreviousTrack')}
            />
            <IconButton
              intent="gray-subtle"
              className="rounded-full"
              icon={<LuRotateCcw />}
              aria-label={t`Rewind`}
              onClick={() => send('Rewind')}
            />
            <IconButton
              intent="white"
              size="lg"
              className="rounded-full"
              icon={paused ? <LuPlay /> : <LuPause />}
              aria-label={paused ? t`Play` : t`Pause`}
              onClick={() => send(paused ? 'Unpause' : 'Pause')}
            />
            <IconButton
              intent="gray-subtle"
              className="rounded-full"
              icon={<LuRotateCw />}
              aria-label={t`Fast forward`}
              onClick={() => send('FastForward')}
            />
            <IconButton
              intent="gray-subtle"
              className="rounded-full"
              icon={<LuSkipForward />}
              aria-label={t`Next`}
              onClick={() => send('NextTrack')}
            />
          </div>
          <Button
            intent="gray-outline"
            className="w-full rounded-full"
            leftIcon={<LuSquare />}
            onClick={() => send('Stop')}
          >
            <Trans>Stop</Trans>
          </Button>
        </>
      )}
      {audio.length > 1 && commands.includes('SetAudioStreamIndex') && (
        <Select
          label={t`Audio`}
          options={audio.map((s, i) => ({
            value: String(s.Index),
            label: trackLabel(s, i + 1),
          }))}
          value={String(session.PlayState?.AudioStreamIndex ?? '')}
          onValueChange={(v) => setTrack('audio', v)}
        />
      )}
      {subtitles.length > 0 && commands.includes('SetSubtitleStreamIndex') && (
        <Select
          label={t`Subtitles`}
          options={[
            { value: '-1', label: t`Off` },
            ...subtitles.map((s, i) => ({
              value: String(s.Index),
              label: trackLabel(s, i + 1),
            })),
          ]}
          value={String(session.PlayState?.SubtitleStreamIndex ?? '')}
          onValueChange={(v) => setTrack('subtitle', v)}
        />
      )}
      <Button
        intent="gray-subtle"
        className="w-full rounded-full"
        onClick={onDevices}
      >
        <Trans>Other devices</Trans>
      </Button>
    </div>
  );
}

/** While a device given a title plays it, a way back to its remote. */
function FollowingPill({
  session,
  hidden,
}: {
  session: SessionInfoDto | undefined;
  hidden: boolean;
}) {
  const { following } = useSheet();
  const playing = !!session?.NowPlayingItem;
  React.useEffect(() => {
    if (!following || playing) return;
    const left = following.at + STARTING_MS - Date.now();
    const stop = () => setSheet({ following: null });
    if (left <= 0) return stop();
    const timer = setTimeout(stop, left);
    return () => clearTimeout(timer);
  }, [following, playing]);
  if (!session || !playing || hidden) return null;
  const name = session.DeviceName ?? '';
  return (
    <button
      type="button"
      data-ui="remote-pill"
      onClick={() => openRemote({ device: session.Id! })}
      className="fixed inset-x-0 bottom-[max(1rem,calc(var(--nav-bar)+0.5rem))] z-[90] mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-2 rounded-full border border-white/10 bg-gray-950/90 px-4 py-2 text-sm shadow-lg backdrop-blur duration-300 animate-in fade-in-0"
    >
      <LuCast className="flex-none" />
      <span className="truncate">
        <Trans>Playing on {name}</Trans>
      </span>
    </button>
  );
}
