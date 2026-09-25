import React from 'react';
import { motion } from 'motion/react';
import { PiPauseDuotone, PiPlayDuotone } from 'react-icons/pi';
import {
  LuArrowLeft,
  LuAudioLines,
  LuCaptions,
  LuCaptionsOff,
  LuCheck,
  LuGauge,
  LuLayers,
  LuListVideo,
  LuMinus,
  LuPlus,
  LuUndo2,
  LuMaximize,
  LuMinimize,
  LuPause,
  LuPlay,
  LuRotateCcw,
  LuRotateCw,
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
import type { PlayerController, Track } from '../lib/player';
import { useSeekStep } from '../lib/settings';
import { SyncToLine } from './subtitle-sync';
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
  label,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
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
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-[height] group-hover/seek:h-1.5">
        <div
          className="absolute inset-y-0 left-0 bg-white/30"
          style={{ width: percent(bufferedMs) }}
        />
        {segments.map((s) => (
          <div
            key={`${s.type}-${s.startMs}`}
            className="absolute inset-y-0 bg-amber-300/60"
            style={{
              left: percent(s.startMs),
              width: percent(s.endMs - s.startMs),
            }}
          />
        ))}
        <div
          className="absolute inset-y-0 left-0 bg-brand-400"
          style={{ width: percent(shown) }}
        />
      </div>
      <div
        className="absolute size-3.5 -translate-x-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover/seek:opacity-100"
        style={{ left: percent(shown), opacity: drag !== null ? 1 : undefined }}
      />
      {hover !== null && durationMs > 0 && (
        <div
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
    <div className="group/volume hidden items-center sm:flex">
      <ControlButton
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
  label,
  icon,
  options,
  value,
  onSelect,
  onOpenChange,
  footer,
}: {
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
      trigger={<ControlButton label={label}>{icon}</ControlButton>}
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

function delayLabel(ms: number): string {
  if (!ms) return 'In sync';
  return `${ms > 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(1)}s`;
}

/** Nudges subtitles earlier or later without closing the menu. */
function SubtitleSync({
  delayMs,
  onChange,
  onSyncToLine,
}: {
  delayMs: number;
  onChange(ms: number): void;
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
    <div className="pointer-events-none absolute inset-x-0 top-20 flex justify-center">
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
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <Icon className="size-10 text-white lg:size-24" />
    </motion.div>
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
  offeringNext = false,
}: {
  item: BaseItemDto;
  player: PlayerController;
  segments: MediaSegmentDto[] | null | undefined;
  onBack(): void;
  onVersions?: () => void;
  /** The next episode's card covers skipping the credits. */
  offeringNext?: boolean;
}) {
  const { state } = player;
  const [idle, wake] = useIdle(IDLE_MS);
  const [menus, setMenus] = React.useState(0);
  const pointerType = React.useRef('mouse');
  const segments = React.useMemo(() => segmentsOf(rawSegments), [rawSegments]);
  // Set while picking the line heard at this position.
  const [heardAt, setHeardAt] = React.useState<number | null>(null);
  const visible =
    !idle || state.paused || menus > 0 || !state.started || heardAt !== null;
  const latest = React.useRef(player);
  latest.current = player;
  const loadLines = React.useCallback(
    () => latest.current.subtitleLines?.() ?? Promise.resolve(null),
    []
  );
  const [flash, showFlash] = useToggleFlash();
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

  const [seekStep] = useSeekStep();
  const stepMs = React.useRef(seekStep * 1000);
  stepMs.current = seekStep * 1000;
  const seekBy = (delta: number) => {
    const { positionMs, durationMs } = latest.current.state;
    const target = Math.max(0, positionMs + delta);
    latest.current.seek(durationMs ? Math.min(durationMs, target) : target);
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

  return (
    <div
      className={cn(
        'fixed inset-0 z-10 select-none',
        !visible && 'cursor-none'
      )}
      onPointerMove={wake}
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
        className={cn(
          'absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent pb-12 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[calc(0.75rem+env(safe-area-inset-top))] transition-opacity duration-300 sm:pl-[max(1.25rem,env(safe-area-inset-left))] sm:pr-[max(1.25rem,env(safe-area-inset-right))] sm:pt-[calc(1.25rem+env(safe-area-inset-top))]',
          fade
        )}
      >
        <ControlButton label="Back" onClick={onBack}>
          <LuArrowLeft />
        </ControlButton>
        <div className="min-w-0">
          <p className="truncate font-semibold">{itemTitle(item)}</p>
          {item.Type === 'Episode' && (
            <p className="truncate text-sm text-gray-300">
              {itemSubtitle(item)}
            </p>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {state.waiting && !state.error ? (
          <LoadingSpinner />
        ) : (
          pointerType.current === 'touch' && (
            <button
              type="button"
              aria-label={state.paused ? 'Play' : 'Pause'}
              onClick={togglePlay}
              className={cn(
                'pointer-events-auto flex size-16 items-center justify-center rounded-full bg-black/50 text-3xl transition-opacity duration-300',
                fade
              )}
            >
              {state.paused ? <LuPlay /> : <LuPause />}
            </button>
          )
        )}
      </div>

      {flash}
      {notice}
      {heardAt !== null && player.setSubtitleDelay && (
        <SyncToLine
          heardAtMs={heardAt}
          delayMs={state.subtitleDelayMs}
          load={loadLines}
          onPick={(ms) => {
            player.setSubtitleDelay?.(ms);
            setHeardAt(null);
            showNotice(`Subtitles ${delayLabel(ms).toLowerCase()}`);
          }}
          onClose={() => setHeardAt(null)}
        />
      )}

      {segment && !offeringNext && (
        // Above the bottom bar: its padding reaches up past this button.
        <div
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
        className={cn(
          'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent pb-[calc(0.5rem+env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-16 transition-opacity duration-300 sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pl-[max(1.25rem,env(safe-area-inset-left))] sm:pr-[max(1.25rem,env(safe-area-inset-right))]',
          fade
        )}
      >
        <SeekBar
          positionMs={state.positionMs}
          durationMs={state.durationMs}
          bufferedMs={state.bufferedMs}
          segments={segments}
          onSeek={player.seek}
        />
        <div className="flex items-center gap-1">
          <ControlButton
            label={state.paused ? 'Play' : 'Pause'}
            onClick={togglePlay}
          >
            {state.paused ? <LuPlay /> : <LuPause />}
          </ControlButton>
          <ControlButton
            label={`Back ${seekStep} seconds`}
            onClick={() => seekBy(-stepMs.current)}
          >
            <LuRotateCcw />
          </ControlButton>
          <ControlButton
            label={`Forward ${seekStep} seconds`}
            onClick={() => seekBy(stepMs.current)}
          >
            <LuRotateCw />
          </ControlButton>
          <Volume player={player} />
          <span className="ml-2 whitespace-nowrap text-sm tabular-nums text-gray-200">
            {clock(state.positionMs)}
            {state.durationMs > 0 && (
              <span className="text-gray-400">
                {' '}
                / {clock(state.durationMs)}
              </span>
            )}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {player.subtitleTracks.length > 0 && (
              <Menu
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
                      onSyncToLine={
                        player.subtitleLines
                          ? () => setHeardAt(state.positionMs)
                          : undefined
                      }
                    />
                  )
                }
              />
            )}
            {onVersions && (
              <ControlButton label="Versions" onClick={onVersions}>
                <LuLayers />
              </ControlButton>
            )}
            {player.audioTracks.length > 1 && (
              <Menu
                label="Audio"
                icon={<LuAudioLines />}
                options={player.audioTracks}
                value={state.audio}
                onSelect={(id) => id && player.setAudio(id)}
                onOpenChange={onMenu}
              />
            )}
            <Menu
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
            <ControlButton
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
