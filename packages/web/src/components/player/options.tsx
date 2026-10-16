import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import {
  LuActivity,
  LuAudioLines,
  LuCaptions,
  LuCaptionsOff,
  LuCheck,
  LuChevronDown,
  LuCrop,
  LuEar,
  LuFilePlus,
  LuGalleryVerticalEnd,
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
  LuUsers,
} from 'react-icons/lu';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@aiostreams/ui/dropdown-menu';
import { cn } from '@aiostreams/ui/core/styling';
import { clock } from '../../lib/format';
import { currentHost } from '../../lib/hosts';
import { chapterAt } from '../../lib/playback/chapters';
import type { PlayerController, Track } from '../../lib/playback/controller';
import {
  settings,
  useSetting,
  AUDIO_DELAY_LIMIT_MS,
  DIALOGUE_BOOSTS,
  SUBTITLE_POSITION_MAX,
  SUBTITLE_SIZES,
  VIDEO_FITS,
  type VideoFit,
} from '../../lib/settings';
import {
  audioDelayLabel,
  dialogueLabel,
  stepAudioDelay,
} from '../../lib/playback/sound';
import { delayLabel, SUBTITLE_DELAY_STEP_MS } from '../../lib/subtitles/delay';
import {
  stepSubtitleHeight,
  stepSubtitleSize,
  subtitleSizeLabel,
} from '../../lib/subtitles/style';
import { splitByLanguage } from '../../lib/subtitles/tracks';
import { subtitleLanguages, usePlaybackPrefs } from '../../lib/user-config';
import { ControlButton } from './buttons';
import { useParty } from '../../lib/party/party';
import { RATES, rateLabel } from './keys';
import { usePlayhead } from '../../lib/playback/playhead';

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
  more,
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
  /** Listed after a press on `label`, which stands in for them until the menu closes. */
  more?: { label: string; options: Track[] };
}) {
  const [expanded, setExpanded] = React.useState(false);
  const firstMore = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (expanded) firstMore.current?.focus();
  }, [expanded]);
  const item = (option: Track, ref?: React.Ref<HTMLDivElement>) => (
    <DropdownMenuItem
      key={option.id}
      ref={ref}
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
  );
  return (
    <DropdownMenu
      data-ui="player-menu"
      data-name={name}
      side="top"
      align="end"
      sideOffset={8}
      onOpenChange={(open) => {
        if (!open) setExpanded(false);
        onOpenChange(open);
      }}
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
          {options.map((option) => item(option))}
          {more &&
            more.options.length > 0 &&
            (expanded ? (
              more.options.map((option, i) =>
                item(option, i === 0 ? firstMore : undefined)
              )
            ) : (
              <DropdownMenuItem
                data-ui="player-menu-action"
                data-name="more"
                onSelect={(e) => {
                  e.preventDefault();
                  setExpanded(true);
                }}
              >
                <LuChevronDown className="flex-none" />
                {more.label}
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
          <div
            data-ui="player-menu-footer"
            className="-mx-2 mt-1 shrink-0 border-t px-2"
          >
            {footer}
          </div>
        )}
      </div>
    </DropdownMenu>
  );
}

export const fitLabel = (fit: VideoFit) =>
  ({ fit: t`Fit`, crop: t`Crop`, stretch: t`Stretch` })[fit];

const FIT_ICONS: Record<VideoFit, React.ReactNode> = {
  fit: <LuRatio />,
  crop: <LuCrop />,
  stretch: <LuStretchHorizontal />,
};

function FitButton({ notice }: { notice: (text: string) => void }) {
  const [fit, setFit] = useSetting(settings.video.fit);
  const next = VIDEO_FITS[(VIDEO_FITS.indexOf(fit) + 1) % VIDEO_FITS.length];
  const current = fitLabel(fit);
  const coming = fitLabel(next);
  return (
    <ControlButton
      name="fit"
      label={t`Picture: ${current}`}
      onClick={() => {
        setFit(next);
        notice(t`Picture: ${coming}`);
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
      <DropdownMenuLabel className="pt-3">
        <Trans>Style</Trans>
      </DropdownMenuLabel>
      <Stepper
        label={t`Size`}
        value={subtitleSizeLabel(size)}
        less={{
          label: t`Smaller subtitles`,
          onClick: at > 0 ? () => stepSubtitleSize(-1) : undefined,
        }}
        more={{
          label: t`Bigger subtitles`,
          onClick:
            at < SUBTITLE_SIZES.length - 1
              ? () => stepSubtitleSize(1)
              : undefined,
        }}
      />
      <Stepper
        label={t`Height`}
        value={t`${height}%`}
        less={{
          label: t`Lower subtitles`,
          onClick: height > 0 ? () => stepSubtitleHeight(-1) : undefined,
        }}
        more={{
          label: t`Raise subtitles`,
          onClick:
            height < SUBTITLE_POSITION_MAX
              ? () => stepSubtitleHeight(1)
              : undefined,
        }}
      />
    </>
  );
}

function SoundControls() {
  const [boost, setBoost] = useSetting(settings.audio.dialogueBoost);
  const [nightMode, setNightMode] = useSetting(settings.audio.nightMode);
  const [delay, setDelay] = useSetting(settings.audio.delayMs);
  const at = DIALOGUE_BOOSTS.indexOf(boost);
  return (
    <>
      <DropdownMenuLabel className="pt-3">
        <Trans>Sound</Trans>
      </DropdownMenuLabel>
      <Stepper
        label={t`Dialogue`}
        value={dialogueLabel(boost)}
        less={{
          label: t`Less dialogue boost`,
          onClick: at > 0 ? () => setBoost(DIALOGUE_BOOSTS[at - 1]) : undefined,
        }}
        more={{
          label: t`More dialogue boost`,
          onClick:
            at < DIALOGUE_BOOSTS.length - 1
              ? () => setBoost(DIALOGUE_BOOSTS[at + 1])
              : undefined,
        }}
      />
      <Stepper
        label={t`Delay`}
        value={audioDelayLabel(delay)}
        less={{
          label: t`Play the sound earlier`,
          onClick:
            delay > -AUDIO_DELAY_LIMIT_MS
              ? () => stepAudioDelay(-1)
              : undefined,
        }}
        more={{
          label: t`Play the sound later`,
          onClick:
            delay < AUDIO_DELAY_LIMIT_MS ? () => stepAudioDelay(1) : undefined,
        }}
      />
      <DropdownMenuItem
        onSelect={keepOpen}
        onClick={() => setNightMode(!nightMode)}
      >
        <LuCheck
          className={cn('flex-none', nightMode ? 'opacity-100' : 'opacity-0')}
        />
        <Trans>Night mode</Trans>
      </DropdownMenuItem>
      {delay !== 0 && (
        <DropdownMenuItem onSelect={keepOpen} onClick={() => setDelay(0)}>
          <LuUndo2 className="flex-none rtl:-scale-x-100" />
          <Trans>Reset delay</Trans>
        </DropdownMenuItem>
      )}
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
      <DropdownMenuLabel className="pt-3">
        <Trans>Sync</Trans>
      </DropdownMenuLabel>
      <Stepper
        value={delayLabel(delayMs)}
        less={{
          label: t`Show subtitles earlier`,
          onClick: () => onChange(delayMs - SUBTITLE_DELAY_STEP_MS),
        }}
        more={{
          label: t`Show subtitles later`,
          onClick: () => onChange(delayMs + SUBTITLE_DELAY_STEP_MS),
        }}
      />
      <DropdownMenuItem onClick={onSyncByEar}>
        <LuEar className="flex-none" />
        <Trans>Sync by ear…</Trans>
      </DropdownMenuItem>
      {onSyncToLine && (
        <DropdownMenuItem onClick={onSyncToLine}>
          <LuListVideo className="flex-none" />
          <Trans>Sync to a line…</Trans>
        </DropdownMenuItem>
      )}
      {delayMs !== 0 && (
        <DropdownMenuItem onSelect={keepOpen} onClick={() => onChange(0)}>
          <LuUndo2 className="flex-none rtl:-scale-x-100" />
          <Trans>Reset</Trans>
        </DropdownMenuItem>
      )}
    </>
  );
}

export function OptionButtons({
  player,
  onMenu,
  onVersions,
  onEpisodes,
  onAddFile,
  onSyncByEar,
  onSyncToLine,
  onParty,
  notice,
}: {
  player: PlayerController;
  onMenu(open: boolean): void;
  onParty?: () => void;
  onVersions?: () => void;
  onEpisodes?: () => void;
  onAddFile(): void;
  onSyncByEar(): void;
  onSyncToLine(): void;
  notice(text: string): void;
}) {
  const { state } = player;
  const { prefs } = usePlaybackPrefs();
  const subtitles =
    prefs.ListPreferredSubtitlesOnly === false
      ? { shown: player.subtitleTracks, hidden: [] }
      : splitByLanguage(
          player.subtitleTracks,
          subtitleLanguages(prefs),
          state.subtitle
        );
  const chapters = player.chapters ?? [];
  const chapter = usePlayhead(player.playhead, (h) =>
    chapterAt(chapters, h.positionMs)
  );
  const tv = !!currentHost().tv;
  const unread = useParty()?.unread ?? 0;
  const hidden = subtitles.hidden.length;
  return (
    <div className="ms-auto flex items-center sm:gap-1">
      {onParty && (
        <ControlButton
          name="party"
          label={
            unread
              ? plural(unread, {
                  one: 'Watch party, # new message',
                  other: 'Watch party, # new messages',
                })
              : player.shared
                ? t`Watch party`
                : t`Watch together`
          }
          onClick={onParty}
          className="relative"
        >
          <LuUsers />
          {unread > 0 && (
            <span
              data-ui="party-unread"
              className="absolute end-0.5 top-0.5 min-w-4 rounded-full bg-brand-500 px-1 text-[10px] font-semibold leading-4 text-white"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </ControlButton>
      )}
      {onEpisodes && (
        <ControlButton name="episodes" label={t`Episodes`} onClick={onEpisodes}>
          <LuGalleryVerticalEnd />
        </ControlButton>
      )}
      {(player.subtitleTracks.length > 0 || player.subtitleFiles) && (
        <Menu
          name="subtitles"
          label={t`Subtitles`}
          icon={state.subtitle ? <LuCaptions /> : <LuCaptionsOff />}
          options={[{ id: '', label: t`Off` }, ...subtitles.shown]}
          more={{
            label: t`More languages (${hidden})`,
            options: subtitles.hidden,
          }}
          value={state.subtitle}
          onSelect={player.setSubtitle}
          onOpenChange={onMenu}
          action={
            player.subtitleFiles && {
              name: 'add-file',
              label: t`Add a file…`,
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
          label={t`Chapters`}
          icon={<LuListOrdered />}
          options={chapters.map((c, i) => {
            const number = i + 1;
            const title = c.title || t`Chapter ${number}`;
            return { id: String(i), label: `${title} · ${clock(c.startMs)}` };
          })}
          value={String(chapter)}
          onSelect={(id) => id && player.seek(chapters[Number(id)].startMs)}
          onOpenChange={onMenu}
        />
      )}
      {onVersions && (
        <ControlButton name="versions" label={t`Versions`} onClick={onVersions}>
          <LuLayers />
        </ControlButton>
      )}
      {(player.audioTracks.length > 1 || player.sound) && (
        <Menu
          name="audio"
          label={t`Audio`}
          icon={<LuAudioLines />}
          options={player.audioTracks}
          value={state.audio}
          onSelect={(id) => id && player.setAudio(id)}
          onOpenChange={onMenu}
          footer={player.sound && <SoundControls />}
        />
      )}
      {player.setRate && (
        <Menu
          name="speed"
          label={t`Speed`}
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
      {player.fit && <FitButton notice={notice} />}
      {player.stats && (
        <Menu
          name="statistics"
          label={t`Statistics`}
          icon={<LuActivity />}
          options={[{ id: '', label: t`Off` }, ...player.stats.pages]}
          value={player.stats.page}
          onSelect={player.stats.show}
          onOpenChange={onMenu}
        />
      )}
      {player.toggleFullscreen && !tv && (
        <ControlButton
          name="fullscreen"
          label={state.fullscreen ? t`Exit full screen` : t`Full screen`}
          onClick={player.toggleFullscreen}
        >
          {state.fullscreen ? <LuMinimize /> : <LuMaximize />}
        </ControlButton>
      )}
    </div>
  );
}
