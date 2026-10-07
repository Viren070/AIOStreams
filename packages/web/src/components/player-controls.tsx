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
  LuFilePlus,
  LuGauge,
  LuLayers,
  LuListOrdered,
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
import { useLatest } from '../lib/use-latest';
import type {
  PlayerController,
  PlayerState,
  Track,
} from '../lib/playback/controller';
import { currentHost } from '../lib/hosts';
import { delayLabel, SUBTITLE_DELAY_STEP_MS } from '../lib/subtitles/delay';
import {
  settings,
  useSetting,
  type SegmentType,
  SUBTITLE_POSITION_MAX,
  SUBTITLE_SIZES,
  VIDEO_FITS,
  type VideoFit,
} from '../lib/settings';
import {
  stepSubtitleHeight,
  stepSubtitleSize,
  SUBTITLE_SIZE_LABELS,
} from '../lib/subtitles/style';
import { SyncByEar, SyncToLine } from './subtitle-sync';
import { RATES, usePlayerKeys } from './player-keys';
import { usePlayerGestures } from './player-gestures';
import { chapterAt, type Chapter } from '../lib/playback/chapters';
import type { BaseItemDto, MediaSegmentDto } from '../lib/types';
import { appBridge } from '../lib/hosts/shell/bridge';

const IDLE_MS = 2000;
const SKIP_BUTTON_MS = 8000;
/** Skips this close together add up to one seek. */
const SEEK_BURST_MS = 400;
const SEGMENT_NAME: Record<string, string> = {
  Intro: 'intro',
  Recap: 'recap',
  Outro: 'credits',
  Preview: 'preview',
  Commercial: 'ad',
};

interface Segment {
  type: string;
  startMs: number;
  endMs: number;
}

const segmentId = (s: Segment) => `${s.type}:${s.startMs}`;

function segmentsOf(items: MediaSegmentDto[] | null | undefined): Segment[] {
  return (items ?? [])
    .map((s) => ({
      type: String(s.Type),
      startMs: ticksToMs(s.StartTicks),
      endMs: ticksToMs(s.EndTicks),
    }))
    .filter((s) => s.endMs > s.startMs);
}

/** `hide` keeps the controls hidden until the next input, even while paused. */
function useIdle(ms: number) {
  const [idle, setIdle] = React.useState(false);
  const [hidden, setHidden] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const wake = React.useCallback(() => {
    setIdle(false);
    setHidden(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), ms);
  }, [ms]);
  const hide = React.useCallback(() => {
    clearTimeout(timer.current);
    setIdle(true);
    setHidden(true);
  }, []);
  React.useEffect(() => {
    wake();
    return () => clearTimeout(timer.current);
  }, [wake]);
  return { idle, hidden, wake, hide };
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

const arrowDirection = (key: string) =>
  key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;

/** The timeline, with segments and chapters marked, a hover time and drag to seek. */
function SeekBar({
  positionMs,
  durationMs,
  bufferedMs,
  segments,
  chapters,
  onSeek,
  onStep,
}: {
  positionMs: number;
  durationMs: number;
  bufferedMs: number;
  segments: Segment[];
  chapters: Chapter[];
  onSeek(ms: number): void;
  /** The arrow keys skip as the skip buttons do. */
  onStep(direction: number): void;
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
      aria-valuetext={clock(shown)}
      tabIndex={0}
      data-ui="seek-bar"
      className="group/seek relative flex h-5 cursor-pointer touch-none items-center rounded-full"
      onKeyDown={(e) => {
        const direction = arrowDirection(e.key);
        if (!direction) return;
        e.preventDefault();
        onStep(direction);
      }}
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
        {chapters.map(
          (c) =>
            c.startMs > 0 && (
              <div
                key={c.startMs}
                data-ui="seek-bar-chapter"
                className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-black/70"
                style={{ left: percent(c.startMs) }}
              />
            )
        )}
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
          {segments.find((s) => hover >= s.startMs && hover < s.endMs)?.type ??
            chapters[chapterAt(chapters, hover)]?.title}{' '}
          {clock(hover)}
        </div>
      )}
    </div>
  );
}

/** The volume; past 100%, where the player can boost, the level turns red. */
function VolumeBar({
  level,
  max,
  onChange,
}: {
  level: number;
  max: number;
  onChange(volume: number): void;
}) {
  const [step] = useSetting(settings.volumeStep);
  const bar = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const at = (clientX: number) => {
    const rect = bar.current?.getBoundingClientRect();
    if (!rect) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(ratio * max * 100) / 100;
  };
  const share = (volume: number) => (Math.min(volume, max) / max) * 100;

  return (
    <div
      ref={bar}
      role="slider"
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={Math.round(max * 100)}
      aria-valuenow={Math.round(level * 100)}
      tabIndex={0}
      // Arrows pass over it: it keeps Left and Right, and the volume has its own keys.
      data-nav="skip"
      data-ui="volume-bar"
      className="relative flex h-5 w-20 flex-none cursor-pointer touch-none items-center rounded-full"
      onKeyDown={(e) => {
        const direction = arrowDirection(e.key);
        if (!direction) return;
        e.preventDefault();
        const next = Math.round((level + (direction * step) / 100) * 100) / 100;
        onChange(Math.min(max, Math.max(0, next)));
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        onChange(at(e.clientX));
      }}
      onPointerMove={(e) => {
        if (dragging) onChange(at(e.clientX));
      }}
      onPointerUp={() => setDragging(false)}
    >
      <div
        data-ui="volume-track"
        className="relative h-1 w-full overflow-hidden rounded-full bg-white/20"
      >
        {max > 1 && (
          <div
            data-ui="volume-boost"
            className="absolute inset-y-0 right-0 bg-white/15"
            style={{ left: `${share(1)}%` }}
          />
        )}
        <div
          data-ui="volume-level"
          className="absolute inset-y-0 left-0 bg-white"
          style={{ width: `${share(level)}%` }}
        />
        {level > 1 && max > 1 && (
          <div
            data-ui="volume-boost-level"
            className="absolute inset-y-0 left-0 bg-red-400"
            style={{
              width: `${share(level)}%`,
              opacity: (Math.min(level, max) - 1) / (max - 1),
            }}
          />
        )}
      </div>
      <div
        data-ui="volume-thumb"
        className="absolute size-3 -translate-x-1/2 rounded-full bg-white shadow"
        style={{ left: `${share(level)}%` }}
      />
    </div>
  );
}

function Volume({ player }: { player: PlayerController }) {
  const { volume, muted, maxVolume } = player.state;
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
      <div className="w-0 overflow-hidden transition-[width] duration-200 group-focus-within/volume:w-24 group-hover/volume:w-24 md:group-focus-within/volume:w-36 md:group-hover/volume:w-36">
        <div className="flex w-24 items-center gap-2 px-2 md:w-36">
          <VolumeBar
            level={level}
            max={maxVolume}
            onChange={player.setVolume}
          />
          <span
            data-ui="volume-value"
            className="hidden text-xs tabular-nums text-white/85 md:inline"
          >
            {Math.round(level * 100)}%
          </span>
        </div>
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
  action,
  footer,
}: {
  name: string;
  label: string;
  icon: React.ReactNode;
  options: Track[];
  value: string | null;
  onSelect(id: string | null): void;
  onOpenChange(open: boolean): void;
  action?: { name: string; label: string; icon: React.ReactNode; run(): void };
  footer?: React.ReactNode;
}) {
  return (
    <DropdownMenu
      data-ui="player-menu"
      data-name={name}
      side="top"
      align="end"
      sideOffset={8}
      onOpenChange={onOpenChange}
      className="flex max-h-[60vh] min-w-[12rem] max-w-[min(22rem,90vw)] flex-col bg-gray-950/95"
      trigger={
        <ControlButton name={name} label={label}>
          {icon}
        </ControlButton>
      }
    >
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      {/* The list scrolls under a pinned footer; a short screen scrolls both together. */}
      <div className="-mx-2 flex min-h-0 flex-col overflow-x-hidden px-2 [@media(max-height:640px)]:overflow-y-auto">
        <div className="min-h-0 overflow-y-auto [@media(max-height:640px)]:shrink-0 [@media(max-height:640px)]:overflow-y-visible">
          {options.map((option) => (
            <DropdownMenuItem
              key={option.id}
              data-ui="player-menu-item"
              data-selected={(value ?? '') === option.id || undefined}
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
          {action && (
            <DropdownMenuItem
              data-ui="player-menu-action"
              data-name={action.name}
              onClick={action.run}
            >
              {action.icon}
              {action.label}
            </DropdownMenuItem>
          )}
        </div>
        {footer && (
          <div className="-mx-2 mt-1 shrink-0 border-t px-2">{footer}</div>
        )}
      </div>
    </DropdownMenu>
  );
}

const FIT_BUTTON: Record<VideoFit, { label: string; icon: React.ReactNode }> = {
  fit: { label: 'Fit', icon: <LuRatio /> },
  crop: { label: 'Crop', icon: <LuCrop /> },
  stretch: { label: 'Stretch', icon: <LuStretchHorizontal /> },
};

function FitButton() {
  const [fit, setFit] = useSetting(settings.videoFit);
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

const keepOpen = (e: Event) => e.preventDefault();

interface Step {
  label: string;
  /** Missing at the end of the range. */
  onClick?: () => void;
}

/** A value with a button either side, which leave the menu open. */
function Stepper({
  label,
  value,
  less,
  more,
}: {
  label?: string;
  value: string;
  less: Step;
  more: Step;
}) {
  const button = (step: Step, icon: React.ReactNode) => (
    <DropdownMenuItem
      onSelect={keepOpen}
      onClick={step.onClick}
      disabled={!step.onClick}
      className="justify-center"
      aria-label={step.label}
    >
      {icon}
    </DropdownMenuItem>
  );
  return (
    <div className="flex items-center gap-1 px-1 pb-1">
      {label && <span className="flex-1 px-1 text-sm">{label}</span>}
      {button(less, <LuMinus />)}
      <span
        className={cn(
          'min-w-16 text-center text-sm tabular-nums',
          !label && 'flex-1'
        )}
      >
        {value}
      </span>
      {button(more, <LuPlus />)}
    </div>
  );
}

/** Size and height, which every video on this device keeps. */
function SubtitleStyleSteppers() {
  const [size] = useSetting(settings.subtitle.size);
  const [height] = useSetting(settings.subtitle.position);
  const at = SUBTITLE_SIZES.indexOf(size);
  return (
    <>
      <DropdownMenuLabel className="pt-3">Style</DropdownMenuLabel>
      <Stepper
        label="Size"
        value={SUBTITLE_SIZE_LABELS[size]}
        less={{
          label: 'Smaller subtitles',
          onClick: at > 0 ? () => stepSubtitleSize(-1) : undefined,
        }}
        more={{
          label: 'Bigger subtitles',
          onClick:
            at < SUBTITLE_SIZES.length - 1
              ? () => stepSubtitleSize(1)
              : undefined,
        }}
      />
      <Stepper
        label="Height"
        value={`${height}%`}
        less={{
          label: 'Lower subtitles',
          onClick: height > 0 ? () => stepSubtitleHeight(-1) : undefined,
        }}
        more={{
          label: 'Raise subtitles',
          onClick:
            height < SUBTITLE_POSITION_MAX
              ? () => stepSubtitleHeight(1)
              : undefined,
        }}
      />
    </>
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
  return (
    <>
      <DropdownMenuLabel className="pt-3">Sync</DropdownMenuLabel>
      <Stepper
        value={delayLabel(delayMs)}
        less={{
          label: 'Show subtitles earlier',
          onClick: () => onChange(delayMs - SUBTITLE_DELAY_STEP_MS),
        }}
        more={{
          label: 'Show subtitles later',
          onClick: () => onChange(delayMs + SUBTITLE_DELAY_STEP_MS),
        }}
      />
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

/** Seeks at once, then gathers the skips that follow into one seek once they stop. */
function useBurstSeek(player: PlayerController): (deltaMs: number) => void {
  const latest = useLatest(player);
  const burst = React.useRef<{
    target: number;
    sent: boolean;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  React.useEffect(() => () => clearTimeout(burst.current?.timer), []);
  return React.useCallback(
    (deltaMs: number) => {
      const { state, seek } = latest.current;
      const last = burst.current;
      clearTimeout(last?.timer);
      const to = Math.max(0, (last?.target ?? state.positionMs) + deltaMs);
      const target = state.durationMs ? Math.min(state.durationMs, to) : to;
      const settle = () => {
        const current = burst.current;
        if (!current || current.sent) {
          burst.current = null;
          return;
        }
        latest.current.seek(current.target);
        current.sent = true;
        current.timer = setTimeout(settle, SEEK_BURST_MS);
      };
      if (!last) seek(target);
      burst.current = {
        target,
        sent: !last,
        timer: setTimeout(settle, SEEK_BURST_MS),
      };
    },
    [latest]
  );
}

function useFileDrop(onDrop: ((file: File) => void) | undefined): boolean {
  const [over, setOver] = React.useState(false);
  const latest = useLatest(onDrop);
  const enabled = !!onDrop;
  React.useEffect(() => {
    if (!enabled) return;
    // Entering a child leaves its parent, so only the count says when it left the page.
    let depth = 0;
    const files = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const handlers: Record<string, (e: DragEvent) => void> = {
      dragenter: (e) => {
        if (!files(e)) return;
        depth++;
        setOver(true);
      },
      dragleave: (e) => {
        if (!files(e)) return;
        depth = Math.max(0, depth - 1);
        if (!depth) setOver(false);
      },
      dragover: (e) => {
        if (files(e)) e.preventDefault();
      },
      drop: (e) => {
        if (!files(e)) return;
        e.preventDefault();
        depth = 0;
        setOver(false);
        const file = e.dataTransfer?.files[0];
        if (file) latest.current?.(file);
      },
    };
    for (const [event, handler] of Object.entries(handlers))
      window.addEventListener(event, handler as EventListener);
    return () => {
      for (const [event, handler] of Object.entries(handlers))
        window.removeEventListener(event, handler as EventListener);
    };
  }, [enabled, latest]);
  return over && enabled;
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
  const { idle, hidden, wake, hide } = useIdle(IDLE_MS);
  const root = React.useRef<HTMLDivElement>(null);
  const [menus, setMenus] = React.useState(0);
  const pointerType = React.useRef('mouse');
  const [touch, setTouch] = React.useState(
    () => matchMedia('(pointer: coarse)').matches
  );
  const segments = React.useMemo(() => segmentsOf(rawSegments), [rawSegments]);
  // Set while picking the line heard; playback waits, then resumes if it ran.
  const [picking, setPicking] = React.useState<{
    heardAtMs: number;
    resume: boolean;
  } | null>(null);
  const [byEar, setByEar] = React.useState(false);
  // A player in its own window is watched there, so its controls here stay.
  const visible =
    !!player.external ||
    (!hidden &&
      (!idle ||
        state.paused ||
        menus > 0 ||
        !state.started ||
        picking !== null ||
        byEar));
  // macOS draws its window buttons over the video, so they hide with the controls.
  React.useEffect(() => {
    const shell = appBridge();
    if (shell?.platform === 'macos')
      shell.send({ type: 'window-buttons', visible });
  }, [visible]);
  React.useEffect(
    () => () => {
      const shell = appBridge();
      if (shell?.platform === 'macos')
        shell.send({ type: 'window-buttons', visible: true });
    },
    []
  );
  // Hidden controls let go of focus, so the arrow keys seek again.
  React.useEffect(() => {
    const el = document.activeElement;
    if (!visible && el instanceof HTMLElement && root.current?.contains(el))
      el.blur();
  }, [visible]);
  const positionNow = usePositionClock(state);
  const latest = useLatest(player);
  const loadLines = React.useCallback(
    () => latest.current.subtitleLines?.() ?? Promise.resolve(null),
    [latest]
  );
  const [flash, showFlash] = useToggleFlash();
  const [seekFlash, showSeekFlash] = useSeekFlash();
  const [notice, showNotice] = useNotice();
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

  const fileInput = React.useRef<HTMLInputElement>(null);
  const addSubtitleFile = (file: File) =>
    latest.current.subtitleFiles?.add(file).then(
      () => showNotice(`Added ${file.name}`),
      (e: Error) => showNotice(e.message)
    );
  const dragging = useFileDrop(
    player.subtitleFiles ? addSubtitleFile : undefined
  );

  const [seekStep] = useSetting(settings.seekStep);
  const burstSeek = useBurstSeek(player);
  const seekBy = (deltaMs: number) => {
    burstSeek(deltaMs);
    showSeekFlash(deltaMs);
  };
  const shown = useLatest(visible);
  const gestures = usePlayerGestures({
    player,
    seekBy,
    seekStepMs: seekStep * 1000,
    notice: showNotice,
    onTap: () => (shown.current ? hide() : wake()),
  });

  const [segmentActions] = useSetting(settings.segmentActions);
  const inside = segments.filter(
    (s) => state.positionMs >= s.startMs && state.positionMs < s.endMs - 1000
  );
  const actionOf = (s: Segment) =>
    segmentActions[s.type as SegmentType] ?? 'ask';
  // Each segment skips once; seeking back into one offers the button instead.
  const skipped = React.useRef(new Set<string>());
  const segment = inside.find(
    (s) =>
      actionOf(s) === 'ask' ||
      (actionOf(s) === 'skip' && skipped.current.has(segmentId(s)))
  );
  const autoSkip = inside.find(
    (s) => actionOf(s) === 'skip' && !skipped.current.has(segmentId(s))
  );
  React.useEffect(() => {
    if (!autoSkip || !state.started) return;
    skipped.current.add(segmentId(autoSkip));
    if (offeringNext) return;
    latest.current.seek(autoSkip.endMs);
    showNotice(`Skipped ${SEGMENT_NAME[autoSkip.type] ?? 'segment'}`);
  }, [autoSkip, state.started, offeringNext, showNotice]);
  const [segmentFresh, setSegmentFresh] = React.useState(false);
  const shownSegment = segment && segmentId(segment);
  React.useEffect(() => {
    if (!shownSegment) return;
    setSegmentFresh(true);
    const timer = setTimeout(() => setSegmentFresh(false), SKIP_BUTTON_MS);
    return () => clearTimeout(timer);
  }, [shownSegment]);
  const skipSegment =
    segment && !offeringNext ? () => player.seek(segment.endMs) : undefined;
  usePlayerKeys({
    player,
    root,
    wake,
    hide,
    notice: showNotice,
    togglePlay,
    seekBy,
    onBack,
    onPrevious,
    onNext,
    skipSegment,
  });
  const onMenu = (open: boolean) => setMenus((n) => n + (open ? 1 : -1));
  const subtitleOptions = [{ id: '', label: 'Off' }, ...player.subtitleTracks];
  const chapters = player.chapters ?? [];
  const fade = visible ? 'opacity-100' : 'pointer-events-none opacity-0';
  // The bars' shaded space passes taps through to the video.
  const barFade = cn(
    'pointer-events-none',
    visible ? 'opacity-100 [&>*]:pointer-events-auto' : 'opacity-0'
  );
  const isEpisode = item.Type === 'Episode';
  // Below lg the bar has no room for these, so they move to the middle.
  const middle = touch ? '' : 'lg:hidden';
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
    // Touch seeks with a double tap on either side instead.
    back: !touch && {
      name: 'back',
      label: `Back ${seekStep} seconds`,
      icon: <LuRotateCcw />,
      onClick: () => seekBy(-seekStep * 1000),
    },
    forward: !touch && {
      name: 'forward',
      label: `Forward ${seekStep} seconds`,
      icon: <LuRotateCw />,
      onClick: () => seekBy(seekStep * 1000),
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
      ref={root}
      data-ui="player-controls"
      data-visible={visible || undefined}
      data-paused={state.paused || undefined}
      data-waiting={(state.waiting && !state.error) || undefined}
      // The next episode card is its peer, moving above the bar while it shows.
      className={cn(
        'peer fixed inset-0 z-10 select-none',
        !visible && 'cursor-none'
      )}
      onFocus={wake}
      onKeyDown={wake}
      onPointerMove={wake}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        pointerType.current = e.pointerType;
        setTouch(e.pointerType === 'touch');
        // A tap on hidden controls only shows them, so it can't land on a button that appears under it.
        if (e.pointerType !== 'touch' || visible) wake();
      }}
    >
      {/* A click plays or pauses; touch has its own gestures. */}
      <div
        className="absolute inset-0 touch-none"
        {...gestures}
        onClick={() => {
          if (pointerType.current !== 'touch') togglePlay();
        }}
        onDoubleClick={() => {
          if (pointerType.current !== 'touch') player.toggleFullscreen?.();
        }}
      />

      <div
        data-ui="player-top-bar"
        className={cn(
          'absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent pb-12 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[calc(0.75rem+env(safe-area-inset-top))] transition-opacity duration-300 sm:pl-[max(1.25rem,env(safe-area-inset-left))] sm:pr-[max(1.25rem,env(safe-area-inset-right))] sm:pt-[calc(1.25rem+env(safe-area-inset-top))]',
          barFade
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
      {dragging && (
        <div
          data-ui="subtitle-drop"
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-6"
        >
          <div className="rounded-2xl border-2 border-dashed border-white/40 px-10 py-8 text-center">
            <LuCaptions className="mx-auto mb-2 text-4xl" />
            <p className="text-lg font-semibold">Drop to add subtitles</p>
          </div>
        </div>
      )}
      {player.subtitleFiles && (
        <input
          ref={fileInput}
          type="file"
          hidden
          accept={player.subtitleFiles.types.map((t) => `.${t}`).join(',')}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void addSubtitleFile(file);
          }}
        />
      )}
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
          data-type={segment.type}
          data-visible={visible || segmentFresh || undefined}
          className={cn(
            'absolute right-[max(1rem,env(safe-area-inset-right))] z-20 transition-[bottom,opacity] duration-300 sm:right-[max(2rem,env(safe-area-inset-right))]',
            visible
              ? 'bottom-[calc(7rem+env(safe-area-inset-bottom))] sm:bottom-[calc(8rem+env(safe-area-inset-bottom))]'
              : 'bottom-[calc(2rem+env(safe-area-inset-bottom))]',
            !visible && !segmentFresh && 'pointer-events-none opacity-0'
          )}
        >
          <Button
            intent="white"
            className="rounded-full shadow-lg"
            rightIcon={<LuSkipForward />}
            onClick={skipSegment}
          >
            {SEGMENT_NAME[segment.type]
              ? `Skip ${SEGMENT_NAME[segment.type]}`
              : 'Skip'}
          </Button>
        </div>
      )}

      <div
        data-ui="player-bottom-bar"
        className={cn(
          'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent pb-[calc(0.5rem+env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-16 transition-opacity duration-300 sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pl-[max(1.25rem,env(safe-area-inset-left))] sm:pr-[max(1.25rem,env(safe-area-inset-right))]',
          barFade
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
          chapters={chapters}
          onSeek={player.seek}
          onStep={(direction) => seekBy(direction * seekStep * 1000)}
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
            {(player.subtitleTracks.length > 0 || player.subtitleFiles) && (
              <Menu
                name="subtitles"
                label="Subtitles"
                icon={state.subtitle ? <LuCaptions /> : <LuCaptionsOff />}
                options={subtitleOptions}
                value={state.subtitle}
                onSelect={player.setSubtitle}
                onOpenChange={onMenu}
                action={
                  player.subtitleFiles && {
                    name: 'add-file',
                    label: 'Add a file…',
                    icon: <LuFilePlus className="flex-none" />,
                    run: () => fileInput.current?.click(),
                  }
                }
                footer={
                  state.subtitle && (
                    <>
                      {player.setSubtitleDelay && (
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
                      )}
                      {!player.external && <SubtitleStyleSteppers />}
                    </>
                  )
                }
              />
            )}
            {chapters.length > 1 && (
              <Menu
                name="chapters"
                label="Chapters"
                icon={<LuListOrdered />}
                options={chapters.map((c, i) => ({
                  id: String(i),
                  label: `${c.title || `Chapter ${i + 1}`} · ${clock(c.startMs)}`,
                }))}
                value={String(chapterAt(chapters, state.positionMs))}
                onSelect={(id) =>
                  id && player.seek(chapters[Number(id)].startMs)
                }
                onOpenChange={onMenu}
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
            {player.setRate && (
              <Menu
                name="speed"
                label="Speed"
                icon={<LuGauge />}
                options={RATES.map((rate) => ({
                  id: String(rate),
                  label: rate === 1 ? 'Normal' : `${rate}×`,
                }))}
                value={String(state.rate)}
                onSelect={(id) => id && player.setRate?.(Number(id))}
                onOpenChange={onMenu}
              />
            )}
            {(!currentHost().usePlayer || appBridge()) && !player.external && (
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
            {player.toggleFullscreen && (
              <ControlButton
                name="fullscreen"
                label={state.fullscreen ? 'Exit full screen' : 'Full screen'}
                onClick={player.toggleFullscreen}
              >
                {state.fullscreen ? <LuMinimize /> : <LuMaximize />}
              </ControlButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
