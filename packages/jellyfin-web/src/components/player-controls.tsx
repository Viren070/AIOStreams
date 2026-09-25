import React from 'react';
import { motion } from 'motion/react';
import { PiPauseDuotone, PiPlayDuotone } from 'react-icons/pi';
import {
  LuActivity,
  LuArrowLeft,
  LuAudioLines,
  LuCaptions,
  LuCaptionsOff,
  LuCheck,
  LuCrop,
  LuRatio,
  LuStretchHorizontal,
  LuEar,
  LuGauge,
  LuLayers,
  LuListVideo,
  LuLoaderCircle,
  LuMinus,
  LuPlus,
  LuUndo2,
  LuMaximize,
  LuMinimize,
  LuPause,
  LuPlay,
  LuRotateCcw,
  LuRotateCw,
  LuSkipBack,
  LuSkipForward,
  LuVolume1,
  LuVolume2,
  LuVolumeX,
} from 'react-icons/lu';
import { Button } from '@aiostreams/ui/button';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@aiostreams/ui/dropdown-menu';
import { LoadingSpinner } from '@aiostreams/ui/loading-spinner';
import { cn } from '@aiostreams/ui/core/styling';
import { clock, itemSubtitle, itemTitle, ticksToMs } from '../lib/format';
import type { PlayerController, PlayerState, Track } from '../lib/player';
import { playbackHost } from '../lib/hosts';
import { delayLabel } from '../lib/subtitle-lines';
import {
  useSeekStep,
  useVideoFit,
  VIDEO_FITS,
  type VideoFit,
} from '../lib/settings';
import { SyncByEar, SyncToLine } from './subtitle-sync';
import type { BaseItemDto, MediaSegmentDto } from '../lib/types';

const IDLE_MS = 2000;
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SEGMENT_LABEL: Record<string, string> = {
  Intro: 'Skip intro',
  Recap: 'Skip recap',
  Outro: 'Skip credits',
  Preview: 'Skip preview',
  Commercial: 'Skip ad',
};

interface Segment {
  type: string;
  startMs: number;
  endMs: number;
}

function segmentsOf(items: MediaSegmentDto[] | null | undefined): Segment[] {
  return (items ?? [])
    .map((s) => ({
      type: String(s.Type),
      startMs: ticksToMs(s.StartTicks),
      endMs: ticksToMs(s.EndTicks),
    }))
    .filter((s) => s.endMs > s.startMs);
}

function useIdle(ms: number): [boolean, () => void] {
  const [idle, setIdle] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const wake = React.useCallback(() => {
    setIdle(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), ms);
  }, [ms]);
  React.useEffect(() => {
    wake();
    return () => clearTimeout(timer.current);
  }, [wake]);
  return [idle, wake];
}

function ControlButton({
  name,
  label,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Stays the same as the label changes, for custom CSS. */
  name: string;
  label: string;
}) {
  return (
    <button
      type="button"
      data-ui="player-button"
      data-name={name}
      aria-label={label}
      title={label}
      className={cn(
        'flex size-10 flex-none items-center justify-center rounded-full text-[1.4rem] text-white/85 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40',
        className
      )}
      {...props}
    />
  );
}

/** The timeline, with segments marked, a hover time and drag to seek. */
function SeekBar({
  positionMs,
  durationMs,
  bufferedMs,
  segments,
  onSeek,
}: {
  positionMs: number;
  durationMs: number;
  bufferedMs: number;
  segments: Segment[];
  onSeek(ms: number): void;
}) {
  const bar = React.useRef<HTMLDivElement>(null);
  const [hover, setHover] = React.useState<number | null>(null);
  const [drag, setDrag] = React.useState<number | null>(null);
  const at = (clientX: number) => {
    const rect = bar.current?.getBoundingClientRect();
    if (!rect || !durationMs) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * durationMs;
  };
  const percent = (ms: number) =>
    durationMs ? `${Math.min(100, (ms / durationMs) * 100)}%` : '0%';
  const shown = drag ?? positionMs;

  return (
    <div
      ref={bar}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(durationMs / 1000)}
      aria-valuenow={Math.round(shown / 1000)}
      data-ui="seek-bar"
      className="group/seek relative flex h-5 cursor-pointer touch-none items-center"
      onPointerDown={(e) => {
        if (!durationMs) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(at(e.clientX));
      }}
      onPointerMove={(e) => {
        const ms = at(e.clientX);
        setHover(ms);
        if (drag !== null) setDrag(ms);
      }}
      onPointerUp={() => {
        if (drag !== null) onSeek(drag);
        setDrag(null);
      }}
      onPointerLeave={() => setHover(null)}
    >
      <div
        data-ui="seek-bar-track"
        className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-[height] group-hover/seek:h-1.5"
      >
        <div
          data-ui="seek-bar-buffered"
          className="absolute inset-y-0 left-0 bg-white/30"
          style={{ width: percent(bufferedMs) }}
        />
        {segments.map((s) => (
          <div
            key={`${s.type}-${s.startMs}`}
            data-ui="seek-bar-segment"
            data-type={s.type}
            className="absolute inset-y-0 bg-amber-300/60"
            style={{
              left: percent(s.startMs),
              width: percent(s.endMs - s.startMs),
            }}
          />
        ))}
        <div
          data-ui="seek-bar-progress"
          className="absolute inset-y-0 left-0 bg-brand-400"
          style={{ width: percent(shown) }}
        />
      </div>
      <div
        data-ui="seek-bar-thumb"
        className="absolute size-3.5 -translate-x-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover/seek:opacity-100"
        style={{ left: percent(shown), opacity: drag !== null ? 1 : undefined }}
      />
      {hover !== null && durationMs > 0 && (
        <div
          data-ui="seek-bar-tooltip"
          className="pointer-events-none absolute bottom-6 -translate-x-1/2 rounded-md bg-black/80 px-2 py-1 text-xs tabular-nums"
          style={{ left: percent(hover) }}
        >
          {segments.find((s) => hover >= s.startMs && hover < s.endMs)?.type}{' '}
          {clock(hover)}
        </div>
      )}
    </div>
  );
}

function Volume({ player }: { player: PlayerController }) {
  const { volume, muted } = player.state;
  const level = muted ? 0 : volume;
  const Icon = level === 0 ? LuVolumeX : level < 0.5 ? LuVolume1 : LuVolume2;
  return (
    <div data-ui="volume" className="group/volume hidden items-center sm:flex">
      <ControlButton
        name="mute"
        label={muted ? 'Unmute' : 'Mute'}
        onClick={player.toggleMute}
      >
        <Icon />
      </ControlButton>
      <div className="w-0 overflow-hidden transition-[width] duration-200 group-focus-within/volume:w-24 group-hover/volume:w-24">
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(level * 100)}
          onChange={(e) => player.setVolume(Number(e.target.value) / 100)}
          aria-label="Volume"
          className="mx-2 w-20 cursor-pointer accent-white"
        />
      </div>
    </div>
  );
}

function Menu({
  name,
  label,
  icon,
  options,
  value,
  onSelect,
  onOpenChange,
  footer,
}: {
  name: string;
  label: string;
  icon: React.ReactNode;
  options: Track[];
  value: string | null;
  onSelect(id: string | null): void;
  onOpenChange(open: boolean): void;
  footer?: React.ReactNode;
}) {
  return (
    <DropdownMenu
      side="top"
      align="end"
      sideOffset={8}
      onOpenChange={onOpenChange}
      className="max-h-[60vh] min-w-[12rem] max-w-[min(22rem,90vw)] overflow-y-auto bg-gray-950/95"
      trigger={
        <ControlButton name={name} label={label}>
          {icon}
        </ControlButton>
      }
    >
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      {options.map((option) => (
        <DropdownMenuItem
          key={option.id}
          onClick={() => onSelect(option.id === '' ? null : option.id)}
        >
          <LuCheck
            className={cn(
              'flex-none',
              (value ?? '') === option.id ? 'opacity-100' : 'opacity-0'
            )}
          />
          <span className="[overflow-wrap:anywhere]">{option.label}</span>
        </DropdownMenuItem>
      ))}
      {footer}
    </DropdownMenu>
  );
}

const DELAY_STEP_MS = 100;

const FIT_BUTTON: Record<VideoFit, { label: string; icon: React.ReactNode }> = {
  fit: { label: 'Fit', icon: <LuRatio /> },
  crop: { label: 'Crop', icon: <LuCrop /> },
  stretch: { label: 'Stretch', icon: <LuStretchHorizontal /> },
};

function FitButton() {
  const [fit, setFit] = useVideoFit();
  const next = VIDEO_FITS[(VIDEO_FITS.indexOf(fit) + 1) % VIDEO_FITS.length];
  return (
    <ControlButton
      name="fit"
      label={`Picture: ${FIT_BUTTON[fit].label}`}
      onClick={() => setFit(next)}
    >
      {FIT_BUTTON[fit].icon}
    </ControlButton>
  );
}

/** Nudges subtitles earlier or later without closing the menu. */
function SubtitleSync({
  delayMs,
  onChange,
  onSyncByEar,
  onSyncToLine,
}: {
  delayMs: number;
  onChange(ms: number): void;
  onSyncByEar(): void;
  onSyncToLine?: () => void;
}) {
  const keepOpen = (e: Event) => e.preventDefault();
  return (
    <>
      <DropdownMenuLabel className="pt-3">Sync</DropdownMenuLabel>
      <div className="flex items-center gap-1 px-1 pb-1">
        <DropdownMenuItem
          onSelect={keepOpen}
          onClick={() => onChange(delayMs - DELAY_STEP_MS)}
          className="justify-center"
          aria-label="Show subtitles earlier"
        >
          <LuMinus />
        </DropdownMenuItem>
        <span className="min-w-16 flex-1 text-center text-sm tabular-nums">
          {delayLabel(delayMs)}
        </span>
        <DropdownMenuItem
          onSelect={keepOpen}
          onClick={() => onChange(delayMs + DELAY_STEP_MS)}
          className="justify-center"
          aria-label="Show subtitles later"
        >
          <LuPlus />
        </DropdownMenuItem>
      </div>
      <DropdownMenuItem onClick={onSyncByEar}>
        <LuEar className="flex-none" />
        Sync by ear…
      </DropdownMenuItem>
      {onSyncToLine && (
        <DropdownMenuItem onClick={onSyncToLine}>
          <LuListVideo className="flex-none" />
          Sync to a line…
        </DropdownMenuItem>
      )}
      {delayMs !== 0 && (
        <DropdownMenuItem onSelect={keepOpen} onClick={() => onChange(0)}>
          <LuUndo2 className="flex-none" />
          Reset
        </DropdownMenuItem>
      )}
    </>
  );
}

/** The position at this moment, between the player's few reports a second. */
function usePositionClock(state: PlayerState): () => number {
  const last = React.useRef({ positionMs: 0, at: 0, paused: true, rate: 1 });
  const { positionMs, paused, rate } = state;
  React.useEffect(() => {
    last.current = { positionMs, at: performance.now(), paused, rate };
  }, [positionMs, paused, rate]);
  return React.useCallback(() => {
    const l = last.current;
    return l.paused
      ? l.positionMs
      : l.positionMs + (performance.now() - l.at) * l.rate;
  }, []);
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

function useNotice(): [React.ReactNode, (text: string) => void] {
  const [text, setText] = React.useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const show = React.useCallback((next: string) => {
    clearTimeout(timer.current);
    setText(next);
    timer.current = setTimeout(() => setText(null), 1200);
  }, []);
  const node = text && (
    <div
      data-ui="player-notice"
      className="pointer-events-none absolute inset-x-0 top-20 flex justify-center"
    >
      <span className="rounded-full bg-black/70 px-4 py-1.5 text-sm font-medium tabular-nums">
        {text}
      </span>
    </div>
  );
  return [node, show];
}

/** The play or pause icon that pops in the middle when either is pressed. */
function useToggleFlash(): [React.ReactNode, (paused: boolean) => void] {
  const [flash, setFlash] = React.useState<{
    key: number;
    playing: boolean;
  } | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const show = React.useCallback((wasPaused: boolean) => {
    clearTimeout(timer.current);
    setFlash({ key: Date.now(), playing: wasPaused });
    timer.current = setTimeout(() => setFlash(null), 200);
  }, []);
  const Icon = flash?.playing ? PiPlayDuotone : PiPauseDuotone;
  const node = flash && (
    <motion.div
      key={flash.key}
      initial={{ opacity: 0.2, scale: 1 }}
      animate={{ opacity: 0.5, scale: 1.6 }}
      transition={{ duration: 0.06, ease: 'easeOut' }}
      data-ui="play-flash"
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <Icon className="size-10 text-white lg:size-24" />
    </motion.div>
  );
  return [node, show];
}

/** The skip that pops on the side it went to, adding up quick presses. */
function useSeekFlash(): [React.ReactNode, (deltaMs: number) => void] {
  const [flash, setFlash] = React.useState<{ key: number; ms: number } | null>(
    null
  );
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const show = React.useCallback((deltaMs: number) => {
    clearTimeout(timer.current);
    setFlash((f) => ({
      key: Date.now(),
      ms: f && f.ms < 0 === deltaMs < 0 ? f.ms + deltaMs : deltaMs,
    }));
    timer.current = setTimeout(() => setFlash(null), 700);
  }, []);
  const back = !!flash && flash.ms < 0;
  const Icon = back ? LuRotateCcw : LuRotateCw;
  const node = flash && (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div
        className={
          back
            ? '-translate-x-[min(14rem,25vw)]'
            : 'translate-x-[min(14rem,25vw)]'
        }
      >
        <motion.div
          key={flash.key}
          initial={{ opacity: 0.4, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
          data-ui="seek-flash"
          className="flex flex-col items-center gap-1 drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]"
        >
          <Icon className="size-8 lg:size-10" />
          <span className="text-sm font-semibold tabular-nums lg:text-base">
            {Math.abs(flash.ms) / 1000}s
          </span>
        </motion.div>
      </div>
    </div>
  );
  return [node, show];
}

/**
 * The controls drawn over either player; they hide while the pointer rests and
 * playback runs.
 */
export function PlayerControls({
  item,
  player,
  segments: rawSegments,
  onBack,
  onVersions,
  onPrevious,
  onNext,
  loadingEpisode,
  offeringNext = false,
}: {
  item: BaseItemDto;
  player: PlayerController;
  segments: MediaSegmentDto[] | null | undefined;
  onBack(): void;
  onVersions?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  /** The episode button whose versions are loading. */
  loadingEpisode?: 'previous' | 'next' | null;
  /** The next episode's card covers skipping the credits. */
  offeringNext?: boolean;
}) {
  const { state } = player;
  const [idle, wake] = useIdle(IDLE_MS);
  const [menus, setMenus] = React.useState(0);
  const pointerType = React.useRef('mouse');
  const segments = React.useMemo(() => segmentsOf(rawSegments), [rawSegments]);
  // Set while picking the line heard; playback waits, then resumes if it ran.
  const [picking, setPicking] = React.useState<{
    heardAtMs: number;
    resume: boolean;
  } | null>(null);
  const [byEar, setByEar] = React.useState(false);
  const visible =
    !idle ||
    state.paused ||
    menus > 0 ||
    !state.started ||
    picking !== null ||
    byEar;
  // macOS draws its window buttons over the video, so they hide with the controls.
  React.useEffect(() => {
    const shell = window.aiostreamsDesktop;
    if (shell?.platform === 'macos')
      shell.send({ type: 'window-buttons', visible });
  }, [visible]);
  React.useEffect(
    () => () => {
      const shell = window.aiostreamsDesktop;
      if (shell?.platform === 'macos')
        shell.send({ type: 'window-buttons', visible: true });
    },
    []
  );
  const positionNow = usePositionClock(state);
  const latest = React.useRef(player);
  latest.current = player;
  const episodes = React.useRef({ onPrevious, onNext });
  episodes.current = { onPrevious, onNext };
  const loadLines = React.useCallback(
    () => latest.current.subtitleLines?.() ?? Promise.resolve(null),
    []
  );
  const [flash, showFlash] = useToggleFlash();
  const [seekFlash, showSeekFlash] = useSeekFlash();
  const [notice, showNotice] = useNotice();
  const nudgeSubtitles = (by: number) => {
    const p = latest.current;
    if (!p.setSubtitleDelay || !p.state.subtitle) return;
    const next = p.state.subtitleDelayMs + by;
    p.setSubtitleDelay(next);
    showNotice(`Subtitles ${delayLabel(next).toLowerCase()}`);
  };
  const togglePlay = () => {
    showFlash(latest.current.state.paused);
    latest.current.togglePlay();
  };
  const pickLine = () => {
    const resume = !latest.current.state.paused;
    if (resume) latest.current.togglePlay();
    setPicking({ heardAtMs: positionNow(), resume });
  };
  const closePicker = () => {
    if (picking?.resume && latest.current.state.paused)
      latest.current.togglePlay();
    setPicking(null);
  };
  const closeByEar = React.useCallback(() => setByEar(false), []);

  const [seekStep] = useSeekStep();
  const stepMs = React.useRef(seekStep * 1000);
  stepMs.current = seekStep * 1000;
  const seekBy = (delta: number) => {
    const { positionMs, durationMs } = latest.current.state;
    const target = Math.max(0, positionMs + delta);
    latest.current.seek(durationMs ? Math.min(durationMs, target) : target);
    showSeekFlash(delta);
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target) || document.querySelector('[role="dialog"]'))
        return;
      const p = latest.current;
      const actions: Record<string, () => void> = {
        ' ': togglePlay,
        k: togglePlay,
        ArrowLeft: () => seekBy(-stepMs.current),
        j: () => seekBy(-stepMs.current),
        ArrowRight: () => seekBy(stepMs.current),
        l: () => seekBy(stepMs.current),
        ArrowUp: () => p.setVolume(Math.min(1, p.state.volume + 0.05)),
        ArrowDown: () => p.setVolume(Math.max(0, p.state.volume - 0.05)),
        m: p.toggleMute,
        f: p.toggleFullscreen,
        z: () => nudgeSubtitles(-DELAY_STEP_MS),
        x: () => nudgeSubtitles(DELAY_STEP_MS),
        i: () => {
          const stats = latest.current.stats;
          stats?.show(stats.page ? null : '1');
        },
        P: () => episodes.current.onPrevious?.(),
        N: () => episodes.current.onNext?.(),
      };
      const action = actions[e.key];
      if (!action) return;
      e.preventDefault();
      action();
      wake();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wake]);

  const segment = segments.find(
    (s) => state.positionMs >= s.startMs && state.positionMs < s.endMs - 1000
  );
  const onMenu = (open: boolean) => setMenus((n) => n + (open ? 1 : -1));
  const subtitleOptions = [{ id: '', label: 'Off' }, ...player.subtitleTracks];
  const fade = visible ? 'opacity-100' : 'pointer-events-none opacity-0';
  const isEpisode = item.Type === 'Episode';
  // Below lg the bar has no room for these, so they move to the middle.
  const middle = pointerType.current === 'touch' ? '' : 'lg:hidden';
  const time = (
    <>
      {clock(state.positionMs)}
      {state.durationMs > 0 && (
        <span className="text-gray-400"> / {clock(state.durationMs)}</span>
      )}
    </>
  );
  const spinner = <LuLoaderCircle className="animate-spin" />;
  const buttons = {
    previous: isEpisode && {
      name: 'previous',
      label: 'Previous episode',
      icon: loadingEpisode === 'previous' ? spinner : <LuSkipBack />,
      onClick: onPrevious,
    },
    back: {
      name: 'back',
      label: `Back ${seekStep} seconds`,
      icon: <LuRotateCcw />,
      onClick: () => seekBy(-stepMs.current),
    },
    forward: {
      name: 'forward',
      label: `Forward ${seekStep} seconds`,
      icon: <LuRotateCw />,
      onClick: () => seekBy(stepMs.current),
    },
    next: isEpisode && {
      name: 'next',
      label: 'Next episode',
      icon: loadingEpisode === 'next' ? spinner : <LuSkipForward />,
      onClick: onNext,
    },
  };
  const middleButton = (b: (typeof buttons)[keyof typeof buttons]) =>
    b && (
      <button
        type="button"
        data-ui="player-middle-button"
        data-name={b.name}
        aria-label={b.label}
        title={b.label}
        disabled={!b.onClick}
        onClick={b.onClick}
        className={cn(
          'pointer-events-auto flex size-12 flex-none items-center justify-center rounded-full bg-black/40 text-2xl transition-opacity duration-300 disabled:text-white/30',
          middle,
          fade
        )}
      >
        {b.icon}
      </button>
    );
  const barButton = (b: (typeof buttons)[keyof typeof buttons]) =>
    b && (
      <ControlButton
        name={b.name}
        label={b.label}
        disabled={!b.onClick}
        onClick={b.onClick}
      >
        {b.icon}
      </ControlButton>
    );

  return (
    <div
      data-ui="player-controls"
      data-visible={visible || undefined}
      className={cn(
        'fixed inset-0 z-10 select-none',
        !visible && 'cursor-none'
      )}
      onPointerMove={wake}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        pointerType.current = e.pointerType;
        wake();
      }}
    >
      {/* A tap shows the controls; a click plays or pauses. */}
      <div
        className="absolute inset-0"
        onClick={() => {
          if (pointerType.current !== 'touch') togglePlay();
        }}
        onDoubleClick={() => {
          if (pointerType.current !== 'touch') player.toggleFullscreen();
        }}
      />

      <div
        data-ui="player-top-bar"
        className={cn(
          'absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent pb-12 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[calc(0.75rem+env(safe-area-inset-top))] transition-opacity duration-300 sm:pl-[max(1.25rem,env(safe-area-inset-left))] sm:pr-[max(1.25rem,env(safe-area-inset-right))] sm:pt-[calc(1.25rem+env(safe-area-inset-top))]',
          fade
        )}
      >
        <ControlButton name="exit" label="Back" onClick={onBack}>
          <LuArrowLeft />
        </ControlButton>
        <div data-ui="player-title" className="min-w-0">
          <p className="truncate font-semibold">{itemTitle(item)}</p>
          {item.Type === 'Episode' && (
            <p className="truncate text-sm text-gray-300">
              {itemSubtitle(item)}
            </p>
          )}
        </div>
      </div>

      <div
        data-ui="player-middle"
        className="pointer-events-none absolute inset-0 flex items-center justify-center gap-3 sm:gap-6"
      >
        {middleButton(buttons.previous)}
        {middleButton(buttons.back)}
        {state.waiting && !state.error ? (
          <LoadingSpinner containerClass="size-16 flex-none" iconClass="mr-0" />
        ) : (
          <button
            type="button"
            data-ui="player-middle-button"
            data-name="play"
            aria-label={state.paused ? 'Play' : 'Pause'}
            onClick={togglePlay}
            className={cn(
              'pointer-events-auto flex size-16 flex-none items-center justify-center rounded-full bg-black/50 text-3xl transition-opacity duration-300',
              middle,
              fade
            )}
          >
            {state.paused ? <LuPlay /> : <LuPause />}
          </button>
        )}
        {middleButton(buttons.forward)}
        {middleButton(buttons.next)}
      </div>

      {flash}
      {seekFlash}
      {notice}
      {picking && player.setSubtitleDelay && (
        <SyncToLine
          heardAtMs={picking.heardAtMs}
          delayMs={state.subtitleDelayMs}
          load={loadLines}
          onPick={(ms) => {
            player.setSubtitleDelay?.(ms);
            closePicker();
            showNotice(`Subtitles ${delayLabel(ms).toLowerCase()}`);
          }}
          onClose={closePicker}
        />
      )}
      {byEar && player.setSubtitleDelay && state.subtitle && (
        <SyncByEar
          delayMs={state.subtitleDelayMs}
          now={positionNow}
          onApply={player.setSubtitleDelay}
          onClose={closeByEar}
        />
      )}

      {segment && !offeringNext && (
        // Above the bottom bar: its padding reaches up past this button.
        <div
          data-ui="skip-segment"
          className={cn(
            'absolute right-[max(1rem,env(safe-area-inset-right))] z-20 transition-[bottom] duration-300 sm:right-[max(2rem,env(safe-area-inset-right))]',
            visible
              ? 'bottom-[calc(7rem+env(safe-area-inset-bottom))] sm:bottom-[calc(8rem+env(safe-area-inset-bottom))]'
              : 'bottom-[calc(2rem+env(safe-area-inset-bottom))]'
          )}
        >
          <Button
            intent="white"
            className="rounded-full shadow-lg"
            rightIcon={<LuSkipForward />}
            onClick={() => player.seek(segment.endMs)}
          >
            {SEGMENT_LABEL[segment.type] ?? 'Skip'}
          </Button>
        </div>
      )}

      <div
        data-ui="player-bottom-bar"
        className={cn(
          'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent pb-[calc(0.5rem+env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-16 transition-opacity duration-300 sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pl-[max(1.25rem,env(safe-area-inset-left))] sm:pr-[max(1.25rem,env(safe-area-inset-right))]',
          fade
        )}
      >
        <p
          data-ui="player-time"
          className="px-0.5 text-xs tabular-nums text-gray-200 sm:hidden"
        >
          {time}
        </p>
        <SeekBar
          positionMs={state.positionMs}
          durationMs={state.durationMs}
          bufferedMs={state.bufferedMs}
          segments={segments}
          onSeek={player.seek}
        />
        <div className="flex items-center gap-1">
          <div className="hidden items-center gap-1 lg:flex">
            <ControlButton
              name="play"
              label={state.paused ? 'Play' : 'Pause'}
              onClick={togglePlay}
            >
              {state.paused ? <LuPlay /> : <LuPause />}
            </ControlButton>
            {barButton(buttons.back)}
            {barButton(buttons.forward)}
            {barButton(buttons.previous)}
            {barButton(buttons.next)}
          </div>
          <Volume player={player} />
          <span
            data-ui="player-time"
            className="ml-2 hidden whitespace-nowrap text-sm tabular-nums text-gray-200 sm:inline"
          >
            {time}
          </span>
          <div className="ml-auto flex items-center sm:gap-1">
            {player.subtitleTracks.length > 0 && (
              <Menu
                name="subtitles"
                label="Subtitles"
                icon={state.subtitle ? <LuCaptions /> : <LuCaptionsOff />}
                options={subtitleOptions}
                value={state.subtitle}
                onSelect={player.setSubtitle}
                onOpenChange={onMenu}
                footer={
                  player.setSubtitleDelay &&
                  state.subtitle && (
                    <SubtitleSync
                      delayMs={state.subtitleDelayMs}
                      onChange={player.setSubtitleDelay}
                      onSyncByEar={() => setByEar(true)}
                      onSyncToLine={
                        player.subtitleLines &&
                        (player.canReadSubtitle?.(state.subtitle) ?? true)
                          ? pickLine
                          : undefined
                      }
                    />
                  )
                }
              />
            )}
            {onVersions && (
              <ControlButton
                name="versions"
                label="Versions"
                onClick={onVersions}
              >
                <LuLayers />
              </ControlButton>
            )}
            {player.audioTracks.length > 1 && (
              <Menu
                name="audio"
                label="Audio"
                icon={<LuAudioLines />}
                options={player.audioTracks}
                value={state.audio}
                onSelect={(id) => id && player.setAudio(id)}
                onOpenChange={onMenu}
              />
            )}
            <Menu
              name="speed"
              label="Speed"
              icon={<LuGauge />}
              options={RATES.map((rate) => ({
                id: String(rate),
                label: rate === 1 ? 'Normal' : `${rate}×`,
              }))}
              value={String(state.rate)}
              onSelect={(id) => id && player.setRate(Number(id))}
              onOpenChange={onMenu}
            />
            {(playbackHost() === 'browser' || playbackHost() === 'shell') && (
              <FitButton />
            )}
            {player.stats && (
              <Menu
                name="statistics"
                label="Statistics"
                icon={<LuActivity />}
                options={[{ id: '', label: 'Off' }, ...player.stats.pages]}
                value={player.stats.page}
                onSelect={player.stats.show}
                onOpenChange={onMenu}
              />
            )}
            <ControlButton
              name="fullscreen"
              label={state.fullscreen ? 'Exit full screen' : 'Full screen'}
              onClick={player.toggleFullscreen}
            >
              {state.fullscreen ? <LuMinimize /> : <LuMaximize />}
            </ControlButton>
          </div>
        </div>
      </div>
    </div>
  );
}
