import React from 'react';
import {
  LuActivity,
  LuAudioLines,
  LuCaptions,
  LuCaptionsOff,
  LuCheck,
  LuCrop,
  LuEar,
  LuFilePlus,
  LuGauge,
  LuLayers,
  LuListOrdered,
  LuListVideo,
  LuMaximize,
  LuMinimize,
  LuMinus,
  LuPlus,
  LuRatio,
  LuStretchHorizontal,
  LuUndo2,
} from 'react-icons/lu';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@aiostreams/ui/dropdown-menu';
import { cn } from '@aiostreams/ui/core/styling';
import { clock } from '../../lib/format';
import { currentHost } from '../../lib/hosts';
import { appBridge } from '../../lib/hosts/shell/bridge';
import { chapterAt } from '../../lib/playback/chapters';
import type { PlayerController, Track } from '../../lib/playback/controller';
import {
  settings,
  useSetting,
  SUBTITLE_POSITION_MAX,
  SUBTITLE_SIZES,
  VIDEO_FITS,
  type VideoFit,
} from '../../lib/settings';
import { delayLabel, SUBTITLE_DELAY_STEP_MS } from '../../lib/subtitles/delay';
import {
  stepSubtitleHeight,
  stepSubtitleSize,
  SUBTITLE_SIZE_LABELS,
} from '../../lib/subtitles/style';
import { ControlButton } from './buttons';
import { RATES, rateLabel } from './keys';

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

export const FIT_LABELS: Record<VideoFit, string> = {
  fit: 'Fit',
  crop: 'Crop',
  stretch: 'Stretch',
};

const FIT_ICONS: Record<VideoFit, React.ReactNode> = {
  fit: <LuRatio />,
  crop: <LuCrop />,
  stretch: <LuStretchHorizontal />,
};

/** Whether the page decides how the picture fits; a player in its own window does that itself. */
export const canFit = (player: PlayerController) =>
  (!currentHost().usePlayer || !!appBridge()) && !player.external;

function FitButton({ notice }: { notice: (text: string) => void }) {
  const [fit, setFit] = useSetting(settings.videoFit);
  const next = VIDEO_FITS[(VIDEO_FITS.indexOf(fit) + 1) % VIDEO_FITS.length];
  return (
    <ControlButton
      name="fit"
      label={`Picture: ${FIT_LABELS[fit]}`}
      onClick={() => {
        setFit(next);
        notice(`Picture: ${FIT_LABELS[next]}`);
      }}
    >
      {FIT_ICONS[fit]}
    </ControlButton>
  );
}

const keepOpen = (e: Event) => e.preventDefault();

interface Step {
  label: string;
  /** Missing at the end of the range. */
  onClick?: () => void;
}

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

export function OptionButtons({
  player,
  onMenu,
  onVersions,
  onAddFile,
  onSyncByEar,
  onSyncToLine,
  notice,
}: {
  player: PlayerController;
  onMenu(open: boolean): void;
  onVersions?: () => void;
  onAddFile(): void;
  onSyncByEar(): void;
  onSyncToLine(): void;
  notice(text: string): void;
}) {
  const { state } = player;
  const chapters = player.chapters ?? [];
  const tv = !!currentHost().tv;
  return (
    <div className="ml-auto flex items-center sm:gap-1">
      {(player.subtitleTracks.length > 0 || player.subtitleFiles) && (
        <Menu
          name="subtitles"
          label="Subtitles"
          icon={state.subtitle ? <LuCaptions /> : <LuCaptionsOff />}
          options={[{ id: '', label: 'Off' }, ...player.subtitleTracks]}
          value={state.subtitle}
          onSelect={player.setSubtitle}
          onOpenChange={onMenu}
          action={
            player.subtitleFiles && {
              name: 'add-file',
              label: 'Add a file…',
              icon: <LuFilePlus className="flex-none" />,
              run: onAddFile,
            }
          }
          footer={
            state.subtitle && (
              <>
                {player.setSubtitleDelay && (
                  <SubtitleSync
                    delayMs={state.subtitleDelayMs}
                    onChange={player.setSubtitleDelay}
                    onSyncByEar={onSyncByEar}
                    onSyncToLine={
                      player.subtitleLines &&
                      (player.canReadSubtitle?.(state.subtitle) ?? true)
                        ? onSyncToLine
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
          onSelect={(id) => id && player.seek(chapters[Number(id)].startMs)}
          onOpenChange={onMenu}
        />
      )}
      {onVersions && (
        <ControlButton name="versions" label="Versions" onClick={onVersions}>
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
            label: rateLabel(rate),
          }))}
          value={String(state.rate)}
          onSelect={(id) => id && player.setRate?.(Number(id))}
          onOpenChange={onMenu}
        />
      )}
      {canFit(player) && <FitButton notice={notice} />}
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
      {player.toggleFullscreen && !tv && (
        <ControlButton
          name="fullscreen"
          label={state.fullscreen ? 'Exit full screen' : 'Full screen'}
          onClick={player.toggleFullscreen}
        >
          {state.fullscreen ? <LuMinimize /> : <LuMaximize />}
        </ControlButton>
      )}
    </div>
  );
}
