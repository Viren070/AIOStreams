import { plural, t } from '@lingui/core/macro';
import React from 'react';
import {
  LuPause,
  LuPictureInPicture2,
  LuPlay,
  LuRotateCcw,
  LuRotateCw,
  LuSkipForward,
  LuVolume2,
  LuVolumeX,
  LuX,
} from 'react-icons/lu';
import { LoadingSpinner } from '@aiostreams/ui/loading-spinner';
import { cn } from '@aiostreams/ui/core/styling';
import type { PlayerController } from '@/lib/playback/controller';
import { settings, useSetting } from '@/lib/settings';
import { PlayerAction } from './buttons';
import { PlayerTime, useLiftSubtitles } from './controls';
import { Notice, SpeedPill, useNotice, useSeekFlash } from './feedback';
import { useBurstSeek } from './hooks';
import { usePlayerKeys } from './keys';
import { SeekBar } from './seek-bar';
import { skipLabel, type SegmentSkip } from './segments';
import { useHeldSpeed } from './speed';

const PRESSABLE = 'button, [role="slider"]';
/** How long a shortcut shows the controls for. */
const AWAKE_MS = 2000;

/** The player in a small window: the desktop app's own, shrunk, or the browser's picture-in-picture one. */
export function PictureInPicture({
  player,
  skipping,
  live,
  onClose,
  onLeave,
  onDrag,
}: {
  player: PlayerController;
  skipping: SegmentSkip;
  live: boolean;
  onClose(): void;
  /** Back to the full player. */
  onLeave(): void;
  onDrag?(): void;
}) {
  const root = React.useRef<HTMLDivElement>(null);
  const [stepSeconds] = useSetting(settings.controls.seekStep);
  const [seekBy] = useBurstSeek(player);
  const [seekFlash, showSeekFlash] = useSeekFlash();
  const [notice, showNotice] = useNotice();
  const speed = useHeldSpeed(player);
  const { paused, started, waiting, durationMs, muted, volume } = player.state;
  const loading = !started || (waiting && !paused);

  const [awake, setAwake] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const wake = React.useCallback(() => {
    clearTimeout(timer.current);
    setAwake(true);
    timer.current = setTimeout(() => setAwake(false), AWAKE_MS);
  }, []);
  const hide = React.useCallback(() => {
    clearTimeout(timer.current);
    setAwake(false);
  }, []);
  const [hovered, setHovered] = React.useState(false);
  const visible = paused || awake || hovered;
  const bottomBar = React.useRef<HTMLDivElement>(null);
  useLiftSubtitles(player, bottomBar, visible);

  const skip = (deltaMs: number) => {
    if (live) return;
    seekBy(deltaMs);
    showSeekFlash(deltaMs);
  };
  usePlayerKeys({
    player,
    root,
    ready: started,
    visible: () => visible,
    wake,
    glance: wake,
    glancing: () => false,
    hide,
    notice: showNotice,
    togglePlay: () => player.togglePlay(),
    seekBy: (deltaMs) => {
      skip(deltaMs);
      return false;
    },
    endScrub: () => false,
    onBack: onLeave,
    skipSegment: skipping.skip,
    speedUp: speed.start,
  });

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as Element).closest(PRESSABLE)) return;
    e.preventDefault();
    if (e.detail === 2) onLeave();
    else onDrag?.();
  };

  return (
    <div
      ref={root}
      data-ui="picture-in-picture"
      className="fixed inset-0 select-none"
      onMouseDown={onMouseDown}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <LoadingSpinner className="size-8" />
        </div>
      )}
      {seekFlash}
      {notice ||
        skipping.notice ||
        (player.state.reconnecting && <Notice text={t`Reconnecting…`} />)}
      {speed.held && <SpeedPill rate={speed.held} />}
      <div
        data-ui="picture-in-picture-controls"
        className={cn(
          'absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-black/60 via-transparent to-black/70 transition-opacity duration-200',
          !visible && 'opacity-0'
        )}
      >
        <div className="flex justify-between gap-1 p-1.5">
          <PipButton
            name="mute"
            label={muted ? t`Unmute` : t`Mute`}
            onClick={() => player.toggleMute()}
          >
            {muted || volume === 0 ? <LuVolumeX /> : <LuVolume2 />}
          </PipButton>
          <div className="flex gap-1">
            <PipButton
              name="leave"
              label={t`Exit picture-in-picture`}
              onClick={onLeave}
            >
              <LuPictureInPicture2 />
            </PipButton>
            <PipButton name="close" label={t`Close`} onClick={onClose}>
              <LuX />
            </PipButton>
          </div>
        </div>
        <div className="flex items-center justify-center gap-3">
          {!live && (
            <PipButton
              name="back"
              label={plural(stepSeconds, {
                one: 'Back # second',
                other: 'Back # seconds',
              })}
              onClick={() => skip(-stepSeconds * 1000)}
            >
              <LuRotateCcw />
            </PipButton>
          )}
          <PipButton
            big
            name={paused ? 'play' : 'pause'}
            label={paused ? t`Play` : t`Pause`}
            className={cn(loading && 'invisible')}
            onClick={() => player.togglePlay()}
          >
            {paused ? <LuPlay className="ms-0.5" /> : <LuPause />}
          </PipButton>
          {!live && (
            <PipButton
              name="forward"
              label={plural(stepSeconds, {
                one: 'Forward # second',
                other: 'Forward # seconds',
              })}
              onClick={() => skip(stepSeconds * 1000)}
            >
              <LuRotateCw />
            </PipButton>
          )}
        </div>
        <div ref={bottomBar} className="px-3 pb-1.5 [--time:0.75rem]">
          {!live && durationMs > 0 && (
            <>
              <PlayerTime
                durationMs={durationMs}
                playhead={player.playhead}
                atMs={null}
              />
              <SeekBar
                playhead={player.playhead}
                durationMs={durationMs}
                segments={skipping.segments}
                chapters={player.chapters ?? []}
                previewMs={null}
                previewPicture={false}
                handle={false}
                thumbnails={player.thumbnails}
                onSeek={player.seek}
                onStep={(direction) => skip(direction * stepSeconds * 1000)}
                onTogglePlay={() => player.togglePlay()}
              />
            </>
          )}
        </div>
      </div>
      {skipping.segment && (
        <div
          data-ui="skip-segment"
          data-visible={visible || skipping.fresh || undefined}
          className={cn(
            'absolute end-3 transition-[bottom,opacity] duration-300',
            visible ? 'bottom-16' : 'bottom-3',
            !visible && !skipping.fresh && 'pointer-events-none opacity-0'
          )}
        >
          <PlayerAction
            primary
            size="sm"
            rightIcon={<LuSkipForward />}
            onClick={skipping.skip}
          >
            {skipLabel(skipping.segment)}
          </PlayerAction>
        </div>
      )}
    </div>
  );
}

function PipButton({
  name,
  label,
  big = false,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  name: string;
  label: string;
  big?: boolean;
}) {
  return (
    <button
      type="button"
      data-ui="picture-in-picture-button"
      data-name={name}
      aria-label={label}
      title={label}
      className={cn(
        'flex flex-none items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15 hover:text-white',
        big ? 'size-12 bg-black/40 text-2xl' : 'size-9 text-lg',
        className
      )}
      {...props}
    />
  );
}
