import React from 'react';
import { useReducedMotion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { IconType } from 'react-icons';
import {
  LuAppWindow,
  LuArrowDown,
  LuArrowUp,
  LuCaptions,
  LuCirclePlay,
  LuDatabase,
  LuDownload,
  LuHeart,
  LuInfo,
  LuKeyboard,
  LuLayoutGrid,
  LuMonitor,
  LuSmartphone,
  LuPalette,
  LuTv,
  LuUser,
  LuVolume2,
  LuX,
} from 'react-icons/lu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@aiostreams/ui/tabs';
import { Card } from '@aiostreams/ui/card';
import { Select } from '@aiostreams/ui/select';
import { Combobox } from '@aiostreams/ui/combobox';
import { Switch } from '@aiostreams/ui/switch';
import { Slider } from '@aiostreams/ui/slider';
import { ColorInput } from '@aiostreams/ui/color-input';
import { Textarea } from '@aiostreams/ui/textarea';
import {
  DEFAULT_ACCENT,
  DEFAULT_BACKGROUND,
  THEME_PRESETS,
} from '@aiostreams/ui/utils/palette';
import { TextInput } from '@aiostreams/ui/text-input';
import { Button, IconButton } from '@aiostreams/ui/button';
import { BasicField } from '@aiostreams/ui/basic-field';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@aiostreams/ui/shared/confirmation-dialog';
import { cn } from '@aiostreams/ui/core/styling';
import { formatBytes } from '@aiostreams/ui/core/format';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import { DonationModal } from '@aiostreams/ui/shared/donation-modal';
import { useDisclosure } from '@aiostreams/ui/hooks/disclosure';
import { useSession } from '../lib/session';
import { usePickableUsers, useViews } from '../lib/queries';
import { libraryLabel } from '../lib/format';
import { configureUrl } from '../lib/paths';
import { currentHost } from '../lib/hosts';
import {
  openLogs,
  requestDiagnostics,
  useShellInfo,
  shellHost,
  applyUpdate,
  checkForUpdates,
  useUpdateState,
  chooseExternalPlayer,
  useExternalPlayers,
  type ShellInfo,
  type UpdateState,
} from '../lib/hosts/shell';
import {
  checkDiscord,
  openMpvConfig,
  useDiscordStatus,
  type DiscordStatus,
} from '../lib/hosts/shell/desktop';
import { readMpvConfig, saveMpvConfig } from '../lib/hosts/shell/android';
import { appBridge } from '../lib/hosts/shell/bridge';
import { LANGUAGES } from '../lib/languages';
import { serverAddress } from '../lib/servers';
import {
  subtitleCss,
  subtitleLine,
  SUBTITLE_SIZE_LABELS,
} from '../lib/subtitles/style';
import {
  audioLanguages,
  ORIGINAL_LANGUAGE,
  subtitleLanguages,
  usePlaybackPrefs,
  type SubtitleMode,
} from '../lib/user-config';
import { focusOn } from '../lib/input';
import {
  CUSTOM_LINK,
  LAUNCHED_PLAYERS,
  linkPreset,
  playerOptions,
} from '../lib/playback/player-choice';
import {
  settings,
  useSetting,
  AUDIO_CHANNELS,
  CACHE_MAX_STALE_DAYS,
  CACHE_SIZES_MB,
  DOWNLOAD_SEARCHES,
  DOWNLOADS_AT_ONCE,
  CUSTOM_CSS_OFF,
  MAX_CUSTOM_CSS,
  MAX_FEATURED,
  NEXT_COUNTDOWNS,
  NEXT_LEADS,
  STILL_WATCHING_AFTER,
  SEEK_STEPS,
  VOLUME_STEPS,
  SEGMENT_ACTIONS,
  SEGMENT_TYPES,
  DISCORD_EVENTS,
  type DiscordEvent,
  SUBTITLE_POSITION_MAX,
  SUBTITLE_SIZES,
  type AudioChannels,
  type PlayerEngine,
  type EpisodeLayout,
  type TouchNavigation,
  type TvNavigation,
  type HeroMode,
  type NextPrompt,
  type PosterLine,
  type PosterSize,
  type SegmentAction,
  type SegmentType,
  type SubtitleOutline,
  type SubtitleSize,
} from '../lib/settings';
import { useFeature, useServerInfo } from '../lib/server-info';
import {
  CACHE_CATEGORIES,
  clearCache,
  clearCategory,
  pruneCache,
  usage as cacheUsage,
  type CacheCategory,
} from '../lib/cache';
import { downloadsHost, useDownloadFolder } from '../lib/downloads';
import { PageBody } from '../components/layout';
import { UserAvatar } from '../components/user-avatar';
import { ShortcutSettings } from '../components/shortcut-settings';
import {
  SettingsCard,
  SettingsPageHeader,
  SettingsRow,
} from '../components/settings-card';

const LANGUAGE_OPTIONS = LANGUAGES.map((l) => ({
  value: l.code,
  label: l.name,
}));
const AUDIO_LANGUAGE_OPTIONS = [
  { value: ORIGINAL_LANGUAGE, label: 'Original language' },
  ...LANGUAGE_OPTIONS,
];

/** Languages in order, each movable, with a picker for another. */
function LanguageList({
  label,
  help,
  options,
  value,
  max,
  onChange,
}: {
  label: string;
  help: string;
  options: { value: string; label: string }[];
  value: string[];
  /** One for a server that keeps only Jellyfin's single language. */
  max?: number;
  onChange: (next: string[]) => void;
}) {
  const list = React.useRef<HTMLOListElement>(null);
  const add = React.useRef<HTMLButtonElement>(null);
  const nameOf = (code: string) =>
    options.find((o) => o.value === code)?.label ?? code;
  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    next.splice(to, 0, ...next.splice(from, 1));
    onChange(next);
  };
  // A removed row takes focus with it, so the next row's button takes it over.
  const removed = React.useRef<number | null>(null);
  React.useLayoutEffect(() => {
    const at = removed.current;
    if (at === null) return;
    removed.current = null;
    const left =
      list.current?.querySelectorAll<HTMLElement>('[data-name=remove]');
    const next = left?.[Math.min(at, left.length - 1)] ?? add.current;
    if (next) focusOn(next);
  }, [value]);
  const remove = (at: number) => {
    removed.current = at;
    onChange(value.filter((_, i) => i !== at));
  };
  const button = (
    name: string,
    label: string,
    icon: React.ReactElement,
    onClick: () => void,
    dim = false
  ) => (
    <IconButton
      data-name={name}
      size="sm"
      intent={name === 'remove' ? 'alert-subtle' : 'gray-subtle'}
      // Enabled at the ends, as a remote's focus can't rest on a disabled button.
      className={cn('size-8 rounded-full', dim && 'opacity-40')}
      icon={icon}
      aria-label={label}
      aria-disabled={dim || undefined}
      onClick={onClick}
    />
  );
  return (
    <BasicField label={label} help={help}>
      {value.length > 0 && (
        <ol ref={list} data-ui="language-list" className="space-y-1">
          {value.map((code, i) => (
            <li
              key={code}
              className="flex items-center gap-2 rounded-xl bg-[--subtle] py-1 pl-3 pr-1"
            >
              <span className="w-4 text-sm tabular-nums text-[--muted]">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {nameOf(code)}
              </span>
              {button(
                'up',
                `Move ${nameOf(code)} up`,
                <LuArrowUp />,
                () => move(i, i - 1),
                i === 0
              )}
              {button(
                'down',
                `Move ${nameOf(code)} down`,
                <LuArrowDown />,
                () => move(i, i + 1),
                i === value.length - 1
              )}
              {button('remove', `Remove ${nameOf(code)}`, <LuX />, () =>
                remove(i)
              )}
            </li>
          ))}
        </ol>
      )}
      {(max === undefined || value.length < max) && (
        <Select
          ref={add}
          // Required leaves the placeholder out of the list it opens.
          required
          placeholder={value.length ? 'Add another language' : 'Add a language'}
          options={options.filter((o) => !value.includes(o.value))}
          value=""
          onValueChange={(v) => v && onChange([...value, v])}
        />
      )}
    </BasicField>
  );
}

const SUBTITLE_MODES: { value: SubtitleMode; label: string; help: string }[] = [
  {
    value: 'Default',
    label: 'Default',
    help: 'Subtitles the version marks as default or forced, in your language when it has them.',
  },
  {
    value: 'Always',
    label: 'Always',
    help: 'Always shows subtitles, in your language when the version has them.',
  },
  {
    value: 'Smart',
    label: 'When the audio is not in my language',
    help: 'Shows subtitles in your language unless the audio already is.',
  },
  {
    value: 'OnlyForced',
    label: 'Only forced',
    help: 'Only subtitles for foreign-language parts.',
  },
  { value: 'None', label: 'Off', help: 'Starts without subtitles.' },
];

const ON_DEVICE = 'Kept on this device.';
const ON_ACCOUNT =
  'Saved to your account, so your other devices and Jellyfin apps use it too.';

const NEXT_PROMPT_HELP: Record<NextPrompt, string> = {
  credits:
    'When the credits start, if they run to the end; otherwise a set time before the end.',
  end: 'A set time before the end.',
  off: 'Episodes end without offering the next one.',
};

const SEGMENT_LABELS: Record<SegmentType, string> = {
  Intro: 'Intros',
  Recap: 'Recaps',
  Outro: 'Credits',
  Preview: 'Previews',
  Commercial: 'Ads',
};

const SEGMENT_ACTION_LABELS: Record<SegmentAction, string> = {
  ask: 'Show a skip button',
  skip: 'Skip automatically',
  none: 'Do nothing',
};

function SegmentActionSelect({ type }: { type: SegmentType }) {
  const [action, setAction] = useSetting(settings.segment[type]);
  return (
    <Select
      label={SEGMENT_LABELS[type]}
      help={
        type === 'Outro' && action === 'skip'
          ? 'Credits that end an episode are left to the next episode prompt when it shows.'
          : undefined
      }
      options={SEGMENT_ACTIONS.map((a) => ({
        value: a,
        label: SEGMENT_ACTION_LABELS[a],
      }))}
      value={action}
      onValueChange={(v) => setAction(v as SegmentAction)}
    />
  );
}

function PlaybackSection() {
  const { prefs, update } = usePlaybackPrefs();
  const [seekStep, setSeekStep] = useSetting(settings.seekStep);
  const [volumeStep, setVolumeStep] = useSetting(settings.volumeStep);
  const [autoPlay, setAutoPlay] = useSetting(settings.autoPlayFirst);
  const [nextPrompt, setNextPrompt] = useSetting(settings.next.prompt);
  const [nextLead, setNextLead] = useSetting(settings.next.lead);
  const [nextCountdown, setNextCountdown] = useSetting(settings.next.countdown);
  const [nextFallbackFirst, setNextFallbackFirst] = useSetting(
    settings.next.fallbackFirst
  );
  const [stillWatching, setStillWatching] = useSetting(
    settings.next.stillWatching
  );
  const [skipFillers, setSkipFillers] = useSetting(settings.next.skipFillers);
  const [skipRecaps, setSkipRecaps] = useSetting(settings.next.skipRecaps);
  const marked = useFeature('fillers');
  const autoplay = prefs.EnableNextEpisodeAutoPlay !== false;
  const [hardwareDecoding, setHardwareDecoding] = useSetting(
    settings.desktop.hardwareDecoding
  );
  const [chapterSkips, setChapterSkips] = useSetting(
    settings.desktop.chapterSkips
  );
  const bingeGroups = useFeature('versions');
  const shell = !!shellHost();
  const [engine] = useSetting(settings.android.engine);
  const [frameRate, setFrameRate] = useSetting(settings.android.frameRate);
  const [tunneling, setTunneling] = useSetting(settings.android.tunneling);
  const androidTv = currentHost().name === 'android-app' && !!currentHost().tv;
  // ExoPlayer decodes with the hardware it picks itself; `auto` may still use mpv.
  const decoding =
    shell && !(currentHost().name === 'android-app' && engine === 'exoplayer');

  return (
    <>
      <SettingsCard title="Versions" description={ON_DEVICE}>
        <Switch
          side="right"
          label="Auto-play the first version"
          help={
            autoPlay
              ? 'Play starts the first version, and resuming goes back to the version you were watching. Hold Play to choose instead.'
              : 'Play lists the versions to choose from, but resuming goes back to the version you were watching. Hold Play to do the other: start the first version, or list them when resuming.'
          }
          value={autoPlay}
          onValueChange={setAutoPlay}
        />
      </SettingsCard>
      <SettingsCard
        title="Next episode"
        description="Whether it plays on is saved to your account; the rest is kept on this device."
      >
        <Switch
          side="right"
          label="Play it automatically"
          help={
            bingeGroups
              ? 'Counts down, then plays the next episode in the same kind of version. Off, the prompt waits for you.'
              : 'Counts down, then plays the next episode. Off, the prompt waits for you.'
          }
          value={autoplay}
          onValueChange={(v) => update({ EnableNextEpisodeAutoPlay: v })}
        />
        <Switch
          side="right"
          label={
            bingeGroups
              ? 'Play the first version when none matches'
              : 'Play the first version'
          }
          help={
            bingeGroups
              ? "Otherwise the next episode's version list opens when none is like the one you watched."
              : "Otherwise the next episode's version list opens when it has more than one."
          }
          value={nextFallbackFirst}
          onValueChange={setNextFallbackFirst}
        />
        <Select
          label="Show the prompt"
          help={NEXT_PROMPT_HELP[nextPrompt]}
          options={[
            { value: 'credits', label: 'When the credits start' },
            { value: 'end', label: 'Before the end' },
            { value: 'off', label: 'Never' },
          ]}
          value={nextPrompt}
          onValueChange={(v) => setNextPrompt(v as NextPrompt)}
        />
        {nextPrompt !== 'off' && (
          <Select
            label="Before the end"
            help={
              nextPrompt === 'credits'
                ? 'Used when an episode has no credits marked.'
                : undefined
            }
            options={NEXT_LEADS.map((s) => ({
              value: String(s),
              label:
                s < 60
                  ? `${s} seconds`
                  : `${s / 60} minute${s > 60 ? 's' : ''}`,
            }))}
            value={String(nextLead)}
            onValueChange={(v) => setNextLead(Number(v))}
          />
        )}
        {nextPrompt !== 'off' && (
          <Select
            label="Countdown"
            options={NEXT_COUNTDOWNS.map((s) => ({
              value: String(s),
              label: `${s} seconds`,
            }))}
            value={String(nextCountdown)}
            onValueChange={(v) => setNextCountdown(Number(v))}
          />
        )}
        {marked && (
          <Switch
            side="right"
            label="Skip filler episodes"
            help="Playing on and the next and previous buttons pass over episodes marked as filler. You can still play one yourself."
            value={skipFillers}
            onValueChange={setSkipFillers}
          />
        )}
        {marked && (
          <Switch
            side="right"
            label="Skip recap episodes"
            help="The same for episodes marked as a recap."
            value={skipRecaps}
            onValueChange={setSkipRecaps}
          />
        )}
        {autoplay && (
          <Select
            label="Ask if you are still watching"
            help="Pauses and asks before the next episode once this many have played in a row without a key, click or button press."
            options={STILL_WATCHING_AFTER.map((n) => ({
              value: String(n),
              label: n ? `After ${n} episodes` : 'Never',
            }))}
            value={String(stillWatching)}
            onValueChange={(v) => setStillWatching(Number(v))}
          />
        )}
      </SettingsCard>
      <SettingsCard title="Skipping" description={ON_DEVICE}>
        {SEGMENT_TYPES.map((type) => (
          <SegmentActionSelect key={type} type={type} />
        ))}
        {shell && (
          <Switch
            side="right"
            label="Skip by the file's chapters"
            help="Where a file names its intro, credits, recap or preview chapters, skipping uses them instead of the server's times, since they fit that exact file. The rest still come from the server."
            value={chapterSkips}
            onValueChange={setChapterSkips}
          />
        )}
      </SettingsCard>
      <SettingsCard title="Controls" description={ON_DEVICE}>
        <Select
          label="Skip length"
          help="How far the skip buttons, double taps and the arrow keys jump."
          options={SEEK_STEPS.map((s) => ({
            value: String(s),
            label: `${s} seconds`,
          }))}
          value={String(seekStep)}
          onValueChange={(v) => setSeekStep(Number(v))}
        />
        <Select
          label="Volume step"
          help="How much the volume keys and the scroll wheel change the volume."
          options={VOLUME_STEPS.map((s) => ({
            value: String(s),
            label: `${s}%`,
          }))}
          value={String(volumeStep)}
          onValueChange={(v) => setVolumeStep(Number(v))}
        />
      </SettingsCard>
      {(decoding || androidTv) && (
        <SettingsCard title="Video" description={ON_DEVICE}>
          {decoding && (
            <Switch
              side="right"
              label="Hardware decoding"
              help="Decodes on the graphics card. Turn it off if video shows artefacts or stays black."
              value={hardwareDecoding}
              onValueChange={setHardwareDecoding}
            />
          )}
          {androidTv && (
            <Switch
              side="right"
              label="Match the video's frame rate"
              help="Switches the TV to a refresh rate that suits each video, so motion plays smoothly, and back when you stop. The screen goes blank for a moment as it switches."
              value={frameRate}
              onValueChange={setFrameRate}
            />
          )}
          {androidTv && engine !== 'mpv' && (
            <Switch
              side="right"
              label="Tunneled playback"
              help={`Lets the TV's decoder keep picture and sound in step itself, which plays 4K and HDR more smoothly on some TVs.${engine === 'auto' ? ' Only for videos ExoPlayer plays.' : ''} Turn it off if video stutters or stays black.`}
              value={tunneling}
              onValueChange={setTunneling}
            />
          )}
        </SettingsCard>
      )}
      {!currentHost().play && <PlayerCard />}
    </>
  );
}

const ENGINE_OPTIONS: { value: PlayerEngine; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'mpv', label: 'mpv' },
  { value: 'exoplayer', label: 'ExoPlayer' },
];

const ENGINE_HELP: Record<PlayerEngine, string> = {
  auto: 'ExoPlayer, which uses less battery, and mpv for a video this device has no decoder for.',
  mpv: 'Decodes nearly any video, in software where the device has no decoder for it. Takes your mpv.conf under Android app.',
  exoplayer:
    "Android's own player, which uses less battery: the screen shows the video as the device decodes it, at the video's frame rate. Plays video the device can decode. Styled subtitles look as they do in mpv.",
};

function PlayerCard() {
  const [player, setPlayer] = useSetting(settings.player);
  const [link, setLink] = useSetting(settings.playerLink);
  const [engine, setEngine] = useSetting(settings.android.engine);
  const found = useExternalPlayers();
  const launched = LAUNCHED_PLAYERS.find((p) => p.id === player);
  const preset = linkPreset(player);
  const program = found?.find((p) => p.id === player)?.path;
  let help: React.ReactNode;
  if (launched)
    help = (
      <>
        The {launched.name} installed on this computer, in a window of its own
        with its own controls and configuration. This app still saves your
        place, marks what you watched and plays the next episode. Compared with
        the built-in player, you lose:
        <ul className="mt-1 list-disc pl-5">
          <li>
            The controls, skip buttons and next episode card over the video.
            They stay in this window, which works as a remote.
          </li>
          <li>
            This app&apos;s subtitle style, video fit, hardware decoding and
            audio output settings.
          </li>
        </ul>
      </>
    );
  else if (preset)
    help =
      preset.template.includes('{returnUrl}') &&
      (!preset.template.startsWith('intent:') ||
        currentHost().name === 'android-app')
        ? `Opens versions in ${preset.target ?? preset.name}, which brings you back here with your place saved.`
        : `Opens versions in ${preset.target ?? preset.name}. It can't tell this app where you stopped, so you mark what you watched yourself.`;
  else if (player !== CUSTOM_LINK)
    help =
      currentHost().name === 'desktop'
        ? "mpv inside this window, with this app's controls and playback settings. Your own mpv.conf, scripts and shaders work here too: put them in its mpv folder under Desktop app."
        : currentHost().name === 'android-app'
          ? 'Versions play in the app, with its controls and playback settings. Choose another player to open them in it instead.'
          : 'Versions play in this browser. Choose another player to open them in it instead.';
  return (
    <SettingsCard title="Player" description={ON_DEVICE}>
      <Select
        label="Play versions in"
        help={help}
        options={playerOptions(found?.map((p) => p.id) ?? [])}
        value={player}
        onValueChange={setPlayer}
      />
      {currentHost().name === 'android-app' &&
        !launched &&
        !preset &&
        player !== CUSTOM_LINK && (
          <Select
            label="Engine"
            help={ENGINE_HELP[engine]}
            options={ENGINE_OPTIONS}
            value={engine}
            onValueChange={(v) => setEngine(v as PlayerEngine)}
          />
        )}
      {launched && (
        <SettingsRow
          label={`Your ${launched.name}`}
          help={
            <span className="[overflow-wrap:anywhere]">
              {program ??
                `Not found on this computer. Choose where ${launched.name} is installed.`}
            </span>
          }
        >
          <Button
            intent="gray-outline"
            className="w-full rounded-full sm:w-auto"
            onClick={() => chooseExternalPlayer(launched.id)}
          >
            Choose
          </Button>
        </SettingsRow>
      )}
      {player === CUSTOM_LINK && (
        <TextInput
          label="Player link"
          placeholder="vlc://{url}"
          value={link}
          onValueChange={setLink}
          help="{url} is the stream address, {encodedUrl} the same address URL-encoded, {scheme} its scheme, {filename} the file's name, {subtitles} each external subtitle (its parameter repeats per file), {title} the title with the episode, {position} the second to start at ({positionMs} in milliseconds), and {returnUrl} a link back here for a player that reports where it stopped. Values other than {url} are URL-encoded. After intent://, {url} goes without its scheme."
        />
      )}
    </SettingsCard>
  );
}

function AudioSection() {
  const { prefs, update } = usePlaybackPrefs();
  const audio = audioLanguages(prefs);
  const audioLists = Array.isArray(prefs.AudioLanguages);
  const [audioChannels, setAudioChannels] = useSetting(
    settings.desktop.audioChannels
  );
  const [passthrough, setPassthrough] = useSetting(
    settings.desktop.passthrough
  );
  return (
    <>
      <SettingsCard title="Language" description={ON_ACCOUNT}>
        <LanguageList
          label="Audio languages"
          help="A version plays the first of these it has, otherwise its own default. Original language is the one the title was made in."
          options={AUDIO_LANGUAGE_OPTIONS}
          value={audio}
          max={audioLists ? undefined : 1}
          onChange={(next) =>
            update({
              ...(audioLists && { AudioLanguages: next }),
              AudioLanguagePreference: next[0] ?? '',
            })
          }
        />
        {audio.length > 0 && (
          <Switch
            side="right"
            label="Play the version's default track first"
            help="A track the version marks as its default plays even when another is in one of your languages. Turn this off for your languages to always win."
            value={prefs.PlayDefaultAudioTrack !== false}
            onValueChange={(v) => update({ PlayDefaultAudioTrack: v })}
          />
        )}
        <Switch
          side="right"
          label="Remember picks per show"
          help="An audio track you pick while watching a show sets the language for its other episodes. Picking the one your languages would play forgets it."
          value={prefs.RememberAudioSelections !== false}
          onValueChange={(v) => update({ RememberAudioSelections: v })}
        />
      </SettingsCard>
      {shellHost() && (
        <SettingsCard title="Output" description={ON_DEVICE}>
          {currentHost().name === 'desktop' && (
            <Select
              label="Channels"
              help="What your speakers or receiver take."
              options={AUDIO_CHANNELS.map((c) => ({
                value: c,
                label: CHANNEL_LABELS[c],
              }))}
              value={audioChannels}
              onValueChange={(v) => setAudioChannels(v as AudioChannels)}
            />
          )}
          <Switch
            side="right"
            label="Pass surround audio through"
            help="Sends Dolby and DTS audio to your receiver as it is. Only turn this on if your receiver decodes them."
            value={passthrough}
            onValueChange={setPassthrough}
          />
        </SettingsCard>
      )}
    </>
  );
}

function SubtitlesSection() {
  const { prefs, update } = usePlaybackPrefs();
  const mode = prefs.SubtitleMode ?? 'Default';
  const subtitleLists = Array.isArray(prefs.SubtitleLanguages);
  const [size, setSize] = useSetting(settings.subtitle.size);
  const [bold, setBold] = useSetting(settings.subtitle.bold);
  const [textColor, setTextColor] = useSetting(settings.subtitle.textColor);
  const [outline, setOutline] = useSetting(settings.subtitle.outline);
  const [outlineColor, setOutlineColor] = useSetting(
    settings.subtitle.outlineColor
  );
  const [backgroundColor, setBackgroundColor] = useSetting(
    settings.subtitle.backgroundColor
  );
  const [backgroundOpacity, setBackgroundOpacity] = useSetting(
    settings.subtitle.backgroundOpacity
  );
  const [overrideStyled, setOverrideStyled] = useSetting(
    settings.subtitle.overrideStyled
  );
  const [position, setPosition] = useSetting(settings.subtitle.position);
  const [style] = useSetting(settings.subtitleStyle);
  const css = subtitleCss(style);
  return (
    <>
      <SettingsCard title="Language" description={ON_ACCOUNT}>
        <LanguageList
          label="Subtitle languages"
          help="Tried in order for the subtitles the setting below shows."
          options={LANGUAGE_OPTIONS}
          value={subtitleLanguages(prefs)}
          max={subtitleLists ? undefined : 1}
          onChange={(next) =>
            update({
              ...(subtitleLists && { SubtitleLanguages: next }),
              SubtitleLanguagePreference: next[0] ?? '',
            })
          }
        />
        <Select
          label="Subtitles"
          help={SUBTITLE_MODES.find((m) => m.value === mode)?.help}
          options={SUBTITLE_MODES.map(({ value, label }) => ({ value, label }))}
          value={mode}
          onValueChange={(v) => update({ SubtitleMode: v as SubtitleMode })}
        />
        <Switch
          side="right"
          label="Remember picks per show"
          help="Subtitles you pick or turn off while watching a show stay that way for its other episodes. Picking what the settings above would show forgets it."
          value={prefs.RememberSubtitleSelections !== false}
          onValueChange={(v) => update({ RememberSubtitleSelections: v })}
        />
      </SettingsCard>
      <SettingsCard title="Preview">
        <div className="relative aspect-[16/5] rounded-lg bg-gradient-to-br from-gray-700 to-gray-950">
          <span
            className="absolute left-1/2 w-max max-w-[90%] -translate-x-1/2 rounded px-2 py-0.5 text-center text-lg"
            style={{ ...css, bottom: `${100 - subtitleLine(style)}%` }}
          >
            This is how subtitles will look.
          </span>
        </div>
      </SettingsCard>
      <SettingsCard title="Text" description={ON_DEVICE}>
        <Select
          label="Size"
          options={SUBTITLE_SIZES.map((value) => ({
            value,
            label: SUBTITLE_SIZE_LABELS[value],
          }))}
          value={size}
          onValueChange={(v) => setSize(v as SubtitleSize)}
        />
        <ColorInput
          label="Colour"
          value={textColor}
          onValueChange={setTextColor}
        />
        <Switch
          side="right"
          label="Bold"
          value={bold}
          onValueChange={setBold}
        />
        <Slider
          label={`Height: ${position}%`}
          help="How far subtitles sit above their usual place near the bottom."
          min={0}
          max={SUBTITLE_POSITION_MAX}
          step={1}
          value={[position]}
          onValueChange={([v]) => setPosition(v)}
        />
      </SettingsCard>
      <SettingsCard title="Outline">
        <Select
          label="Width"
          options={[
            { value: 'none', label: 'None' },
            { value: 'thin', label: 'Thin' },
            { value: 'normal', label: 'Normal' },
            { value: 'thick', label: 'Thick' },
          ]}
          value={outline}
          onValueChange={(v) => setOutline(v as SubtitleOutline)}
        />
        <ColorInput
          label="Colour"
          value={outlineColor}
          onValueChange={setOutlineColor}
        />
      </SettingsCard>
      <SettingsCard title="Background">
        <ColorInput
          label="Colour"
          value={backgroundColor}
          onValueChange={setBackgroundColor}
        />
        <Slider
          label={`Opacity: ${backgroundOpacity}%`}
          help="At 0% there is no background."
          min={0}
          max={100}
          step={5}
          value={[backgroundOpacity]}
          onValueChange={([v]) => setBackgroundOpacity(v)}
        />
      </SettingsCard>
      <SettingsCard>
        <Switch
          side="right"
          label="Apply to styled subtitles too"
          help="Styled subtitles, common in anime, keep their own fonts and colours unless this is on. Blu-ray and DVD subtitles always keep their look and size. Only in the desktop app."
          value={overrideStyled}
          onValueChange={setOverrideStyled}
        />
      </SettingsCard>
    </>
  );
}

const CHANNEL_LABELS: Record<AudioChannels, string> = {
  auto: 'Automatic',
  stereo: 'Stereo',
  '5.1': '5.1 surround',
  '7.1': '7.1 surround',
};

function updateStatus(update: UpdateState | null): string {
  const android = appBridge()?.platform === 'android';
  switch (update?.state) {
    case undefined:
      return 'Not checked yet.';
    case 'off':
      return 'This copy does not update itself.';
    case 'checking':
      return 'Checking\u2026';
    case 'downloading':
      return `Downloading version ${update.version}\u2026`;
    case 'ready':
      return android
        ? `Version ${update.version} is ready to install.`
        : `Version ${update.version} installs on the next start.`;
    case 'current':
      return 'Up to date.';
    case 'error':
      return `Could not check: ${update.error}`;
  }
}

function UpdatesCard() {
  const [setting, setSetting] = useSetting(settings.desktop.updateChannel);
  const update = useUpdateState();
  const channel =
    setting === 'installed' ? (update?.channel ?? 'stable') : setting;
  const busy = update?.state === 'checking' || update?.state === 'downloading';
  const button = 'w-full rounded-full sm:w-auto';
  return (
    <SettingsCard title="Updates" description={ON_DEVICE}>
      <Select
        label="Channel"
        help="Nightly builds come from every change, ahead of releases, and can break."
        options={[
          { value: 'stable', label: 'Stable' },
          { value: 'nightly', label: 'Nightly' },
        ]}
        value={channel}
        onValueChange={(v) => setSetting(v as 'stable' | 'nightly')}
      />
      <SettingsRow label="Status" help={updateStatus(update)}>
        {update?.state === 'ready' ? (
          <Button intent="white" className={button} onClick={applyUpdate}>
            {appBridge()?.platform === 'android' ? 'Install' : 'Restart now'}
          </Button>
        ) : (
          <Button
            intent="gray-outline"
            className={button}
            loading={busy}
            disabled={update?.state === 'off'}
            onClick={() => checkForUpdates(setting)}
          >
            Check now
          </Button>
        )}
      </SettingsRow>
    </SettingsCard>
  );
}

const DISCORD_LABELS: Record<DiscordEvent, { label: string; help?: string }> = {
  playing: {
    label: "What's playing",
    help: 'The title, the episode and the time left.',
  },
  titles: {
    label: 'Title pages',
    help: 'The movie or show whose page is open.',
  },
  home: { label: 'Home' },
  discover: { label: 'Discover' },
  search: { label: 'Search', help: 'That you are searching, not what for.' },
  calendar: { label: 'Calendar' },
  favourites: { label: 'Favourites' },
  activity: { label: 'Activity' },
};

function discordStatus(status: DiscordStatus | null): string {
  switch (status?.state) {
    case undefined:
      return 'Checking…';
    case 'connected':
      return 'Connected to Discord.';
    case 'not-found':
      return 'Discord is not running on this computer.';
    case 'failed':
      return `Could not connect: ${status.message}`;
    case 'refused':
      return `Discord refused the status: ${status.message}`;
  }
}

function DiscordEventSwitch({ event }: { event: DiscordEvent }) {
  const [value, setValue] = useSetting(settings.discord[event]);
  const { label, help } = DISCORD_LABELS[event];
  return (
    <Switch
      side="right"
      label={label}
      help={help}
      value={value}
      onValueChange={setValue}
    />
  );
}

function DiscordCard() {
  const [events] = useSetting(settings.discordEvents);
  const any = Object.values(events).some(Boolean);
  const status = useDiscordStatus();
  React.useEffect(() => {
    if (any) checkDiscord();
  }, [any]);
  return (
    <SettingsCard
      title="Discord"
      description={`What your Discord profile shows. ${ON_DEVICE}`}
    >
      {DISCORD_EVENTS.map((event) => (
        <DiscordEventSwitch key={event} event={event} />
      ))}
      {any && (
        <SettingsRow label="Status" help={discordStatus(status)}>
          <Button
            intent="gray-outline"
            className="w-full rounded-full sm:w-auto"
            onClick={checkDiscord}
          >
            Check now
          </Button>
        </SettingsRow>
      )}
    </SettingsCard>
  );
}

function AppSection() {
  const app = currentHost().settings;
  return (
    <SettingsCard>
      <SettingsRow label="App settings" help={app?.help}>
        <Button
          intent="gray-outline"
          className="w-full rounded-full sm:w-auto"
          onClick={app?.open}
        >
          Open
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}

function DesktopSection() {
  return (
    <>
      <UpdatesCard />
      <DiscordCard />
      <SettingsCard title="mpv">
        <SettingsRow
          label="mpv configuration"
          help="mpv.conf, input.conf, scripts and shaders in this folder apply to the built-in mpv."
        >
          <Button
            intent="gray-outline"
            className="w-full rounded-full sm:w-auto"
            onClick={openMpvConfig}
          >
            Open folder
          </Button>
        </SettingsRow>
      </SettingsCard>
      <SettingsCard title="Troubleshooting">
        <SettingsRow
          label="Logs"
          help="What the app did each day, kept for a week."
        >
          <Button
            intent="gray-outline"
            className="w-full rounded-full sm:w-auto"
            onClick={openLogs}
          >
            Open folder
          </Button>
        </SettingsRow>
        <DiagnosticsRow />
      </SettingsCard>
    </>
  );
}

function DiagnosticsRow() {
  const server = useServerInfo();
  return (
    <SettingsRow
      label="Diagnostics"
      help="Versions and the recent log, to paste into a bug report."
    >
      <Button
        intent="gray-outline"
        className="w-full rounded-full sm:w-auto"
        onClick={() =>
          requestDiagnostics(server.version && `AIOStreams ${server.version}`)
            .then((text) =>
              copyToClipboard(text, {
                onSuccess: () => toast.success('Diagnostics copied'),
                onError: () => toast.error('Could not copy them'),
              })
            )
            .catch((e: Error) => toast.error(e.message))
        }
      >
        Copy
      </Button>
    </SettingsRow>
  );
}

function AndroidSection() {
  const [engine] = useSetting(settings.android.engine);
  const [pip, setPip] = useSetting(settings.android.pip);
  const [background, setBackground] = useSetting(settings.android.background);
  const canPip = appBridge()?.pip !== false;
  return (
    <>
      <UpdatesCard />
      <SettingsCard title="Leaving the app" description={ON_DEVICE}>
        {canPip && (
          <Switch
            side="right"
            label="Picture-in-picture"
            help="Keeps the video playing in a small window when you leave the app."
            value={pip}
            onValueChange={setPip}
          />
        )}
        <Switch
          side="right"
          label="Play in the background"
          help={
            canPip
              ? 'Keeps the sound going with the screen off, or when you leave without picture-in-picture.'
              : 'Keeps the sound going with the screen off, or when you leave the app.'
          }
          value={background}
          onValueChange={setBackground}
        />
      </SettingsCard>
      {engine !== 'exoplayer' && <MpvConfigCard />}
      <SettingsCard title="Troubleshooting">
        <DiagnosticsRow />
      </SettingsCard>
    </>
  );
}

/** mpv.conf, written by the app and applied to what plays next. */
function MpvConfigCard() {
  const [text, setText] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    readMpvConfig().then(setText, () => setText(''));
  }, []);
  return (
    <SettingsCard title="mpv">
      <Textarea
        label="mpv.conf"
        help="Options for the built-in mpv, one per line, as mpv's manual lists them."
        value={text ?? ''}
        disabled={text === null}
        onValueChange={setText}
        rows={8}
        spellCheck={false}
        className="font-mono text-sm"
      />
      <Button
        intent="gray-outline"
        className="w-full rounded-full sm:w-auto"
        loading={saving}
        disabled={text === null}
        onClick={() => {
          setSaving(true);
          saveMpvConfig(text ?? '')
            .then(
              () => toast.success('Saved'),
              (e: Error) => toast.error(e.message)
            )
            .finally(() => setSaving(false));
        }}
      >
        Save
      </Button>
    </SettingsCard>
  );
}

const NOTHING = 'none';

function InterfaceSection() {
  const views = useViews();
  const [featured, setFeatured] = useSetting(settings.featured);
  const [heroMode, setHeroMode] = useSetting(settings.heroMode);
  const [mergeNextUp, setMergeNextUp] = useSetting(settings.mergeNextUp);
  const [combineSearch, setCombineSearch] = useSetting(settings.combineSearch);
  const [posterSize, setPosterSize] = useSetting(settings.posterSize);
  const [posterLines, setPosterLines] = useSetting(settings.posterLines);
  const [episodeLayout, setEpisodeLayout] = useSetting(settings.episodeLayout);
  const [touchNavigation, setTouchNavigation] = useSetting(
    settings.touchNavigation
  );
  const [tvNavigation, setTvNavigation] = useSetting(settings.tvNavigation);

  const featuredOptions = [
    {
      value: 'resume',
      label: 'Continue watching',
      textValue: 'Continue watching',
    },
    { value: 'next-up', label: 'Next up', textValue: 'Next up' },
    ...(views.data?.Items ?? []).map((v) => {
      const label = [v.Name, libraryLabel(v)].filter(Boolean).join(' · ');
      return { value: `view:${v.Id}`, label, textValue: label };
    }),
    { value: NOTHING, label: 'Nothing', textValue: 'Nothing' },
  ];
  // Catalogs since removed would count towards the limit without showing.
  const known = new Set(featuredOptions.map((o) => o.value));
  const featuredValue =
    featured === 'auto'
      ? []
      : !featured.length
        ? [NOTHING]
        : views.data
          ? featured.filter((s) => known.has(s))
          : featured;
  // Nothing excludes every other choice.
  const changeFeatured = (next: string[]) => {
    const added = next.filter((v) => !featuredValue.includes(v));
    if (added.includes(NOTHING)) setFeatured([]);
    else {
      const sources = next.filter((v) => v !== NOTHING);
      setFeatured(sources.length ? sources : 'auto');
    }
  };

  return (
    <>
      <SettingsCard
        title="Home and grids"
        description="Saved to your account, so they follow you to every device."
      >
        <Combobox
          multiple
          label="Featured on home"
          help={`Up to ${MAX_FEATURED}, mixed together. Left empty, your first movie and series catalogs are featured.`}
          placeholder="Automatic"
          emptyMessage="Nothing matches."
          options={featuredOptions}
          maxItems={MAX_FEATURED}
          value={featuredValue}
          onValueChange={changeFeatured}
        />
        <Select
          label="Hero"
          help="Following pins it above the rows and shows the card the pointer, keyboard or remote is on, starting with a featured title. Touch screens and narrow windows keep it rotating."
          options={[
            { value: 'rotate', label: 'Rotates through featured titles' },
            { value: 'follow', label: 'Follows the selected card' },
          ]}
          value={heroMode}
          onValueChange={(value) => setHeroMode(value as HeroMode)}
        />
        <Switch
          side="right"
          label="Merge continue watching and next up"
          help="Shows next episodes in the continue watching row, after what you are partway through."
          value={mergeNextUp}
          onValueChange={setMergeNextUp}
        />
        <Switch
          side="right"
          label="Combine movie and show results"
          help="Shows search results in one grid instead of a row each for movies and shows."
          value={combineSearch}
          onValueChange={setCombineSearch}
        />
        <Select
          label="Poster size"
          help="How large cards are in a grid."
          options={[
            { value: 'small', label: 'Small' },
            { value: 'medium', label: 'Medium' },
            { value: 'large', label: 'Large' },
          ]}
          value={posterSize}
          onValueChange={(value) => setPosterSize(value as PosterSize)}
        />
        <Combobox
          multiple
          label="Under posters"
          help="Left empty, posters stand alone. A poster without artwork still shows its title."
          placeholder="Nothing"
          emptyMessage="Nothing matches."
          options={[
            { value: 'title', label: 'Title', textValue: 'Title' },
            { value: 'year', label: 'Year', textValue: 'Year' },
          ]}
          value={posterLines}
          onValueChange={(value) => setPosterLines(value as PosterLine[])}
        />
      </SettingsCard>
      <SettingsCard title="Episodes" description={ON_DEVICE}>
        <Select
          label="Episode layout"
          help="Automatic lists episodes on narrow screens and puts them in a row on wide ones."
          options={[
            { value: 'auto', label: 'Automatic' },
            { value: 'row', label: 'Row' },
            { value: 'list', label: 'List' },
          ]}
          value={episodeLayout}
          onValueChange={(value) => setEpisodeLayout(value as EpisodeLayout)}
        />
      </SettingsCard>
      {currentHost().tv && (
        <SettingsCard title="Navigation" description={ON_DEVICE}>
          <Select
            label="Style"
            help="Side rail shows each page's name only while you're in it; Sidebar always shows them; Top tabs sit along the top of each page."
            options={[
              { value: 'rail', label: 'Side rail' },
              { value: 'sidebar', label: 'Sidebar' },
              { value: 'top', label: 'Top tabs' },
            ]}
            value={tvNavigation}
            onValueChange={(value) => setTvNavigation(value as TvNavigation)}
          />
        </SettingsCard>
      )}
      {matchMedia('(pointer: coarse)').matches && (
        <SettingsCard title="Navigation" description={ON_DEVICE}>
          <Select
            label="On wide screens"
            help="Where the navigation goes when the screen is wide enough for a sidebar, such as a tablet held sideways."
            options={[
              { value: 'rail', label: 'Side rail' },
              { value: 'bar', label: 'Bottom bar' },
            ]}
            value={touchNavigation}
            onValueChange={(value) =>
              setTouchNavigation(value as TouchNavigation)
            }
          />
        </SettingsCard>
      )}
    </>
  );
}

const CACHE_LABELS: Record<CacheCategory, { label: string; help: string }> = {
  home: {
    label: 'Home and libraries',
    help: 'Rows, catalogs and the calendar.',
  },
  titles: {
    label: 'Title pages',
    help: 'Details, seasons and episodes of what you open.',
  },
  history: { label: 'Activity', help: 'Your watch history and totals.' },
  search: { label: 'Searches', help: 'Results of what you searched for.' },
  artwork: {
    label: 'Artwork',
    help: 'Posters, backdrops, logos and photos.',
  },
  account: {
    label: 'Account and server',
    help: 'Who you are signed in as and the server’s details, which opening without a connection needs.',
  },
};

const MAX_STALE_LABELS: Record<number, string> = {
  1: 'A day',
  3: 'Three days',
  7: 'A week',
  14: 'Two weeks',
  30: 'A month',
  0: 'No limit',
};

function useCacheUsage() {
  return useQuery({ queryKey: ['cache-usage'], queryFn: cacheUsage });
}

function CacheCategoryRow({
  category,
  size,
  onCleared,
}: {
  category: CacheCategory;
  size: number | undefined;
  onCleared(): void;
}) {
  const [on, setOn] = useSetting(settings.cache.categories[category]);
  const { label, help } = CACHE_LABELS[category];
  const clear = () => void clearCategory(category).then(onCleared);
  return (
    <SettingsRow
      label={label}
      help={size ? `${help} ${formatBytes(size)}.` : help}
    >
      <div className="flex items-center gap-3">
        <Button
          intent="gray-outline"
          size="sm"
          className="rounded-full"
          disabled={!size}
          onClick={clear}
        >
          Clear
        </Button>
        <Switch
          aria-label={`Save ${label.toLowerCase()}`}
          value={on}
          onValueChange={(next) => {
            setOn(next);
            if (!next) clear();
          }}
        />
      </div>
    </SettingsRow>
  );
}

function CacheSection() {
  const [enabled, setEnabled] = useSetting(settings.cache.enabled);
  const [maxStale, setMaxStale] = useSetting(settings.cache.maxStaleDays);
  const [maxSize, setMaxSize] = useSetting(settings.cache.maxSizeMb);
  const usage = useCacheUsage();
  const refresh = () => void usage.refetch();
  const total = usage.data
    ? Object.values(usage.data).reduce((sum, n) => sum + n, 0)
    : undefined;

  return (
    <>
      <SettingsCard description={ON_DEVICE}>
        <Switch
          side="right"
          label="Save what you browse"
          help="Pages and artwork open straight away from this device, then refresh. Without a connection, whatever was saved can still be browsed."
          value={enabled}
          onValueChange={(next) => {
            setEnabled(next);
            if (!next) void clearCache().then(refresh);
          }}
        />
        {enabled && (
          <Select
            label="Show saved pages for up to"
            help="Older ones wait for the server instead. Without a connection, everything saved is shown."
            options={CACHE_MAX_STALE_DAYS.map((days) => ({
              value: String(days),
              label: MAX_STALE_LABELS[days],
            }))}
            value={String(maxStale)}
            onValueChange={(value) => setMaxStale(Number(value))}
          />
        )}
        {enabled && (
          <Select
            label="Space to use"
            help={`${total === undefined ? '' : `${formatBytes(total)} used. `}Past this, what was used longest ago goes first.`}
            options={CACHE_SIZES_MB.map((mb) => ({
              value: String(mb),
              label: formatBytes(mb * 1_000_000),
            }))}
            value={String(maxSize)}
            onValueChange={(value) => {
              setMaxSize(Number(value));
              void pruneCache().then(refresh);
            }}
          />
        )}
      </SettingsCard>
      {enabled && (
        <SettingsCard
          title="What to save"
          description="Turning one off also clears it."
        >
          {CACHE_CATEGORIES.map((category) => (
            <CacheCategoryRow
              key={category}
              category={category}
              size={usage.data?.[category]}
              onCleared={refresh}
            />
          ))}
        </SettingsCard>
      )}
      {enabled && (
        <SettingsCard>
          <SettingsRow
            label="Clear everything"
            help="Pages load from the server again until they are saved anew."
          >
            <Button
              intent="gray-outline"
              className="w-full rounded-full sm:w-auto"
              disabled={!total}
              onClick={() => void clearCache().then(refresh)}
            >
              Clear
            </Button>
          </SettingsRow>
        </SettingsCard>
      )}
    </>
  );
}

function DownloadsSection() {
  const host = downloadsHost();
  const folder = useDownloadFolder();
  const [concurrent, setConcurrent] = useSetting(settings.downloads.concurrent);
  const [searches, setSearches] = useSetting(settings.downloads.searches);
  const [subtitles, setSubtitles] = useSetting(settings.downloads.subtitles);
  const [wifiOnly, setWifiOnly] = useSetting(settings.downloads.wifiOnly);
  const button = 'w-full rounded-full sm:w-auto';
  return (
    <SettingsCard description={ON_DEVICE}>
      {host?.folder && (
        <SettingsRow
          label="Folder"
          help={
            <span className="break-all">
              {folder ?? '…'}. New downloads go here; ones already saved stay
              where they are.
            </span>
          }
        >
          <div className="flex gap-2">
            <Button
              intent="gray-outline"
              className={button}
              onClick={() => host.folder?.open()}
            >
              Open
            </Button>
            <Button
              intent="gray-outline"
              className={button}
              onClick={() => host.folder?.choose()}
            >
              Change
            </Button>
          </div>
        </SettingsRow>
      )}
      {host?.handsOff && (
        <SettingsRow
          label="The app's downloads"
          help="The app saves what you download and plays it without a connection."
        >
          <Button
            intent="gray-outline"
            className={button}
            onClick={() => host.handsOff?.open()}
          >
            Open
          </Button>
        </SettingsRow>
      )}
      {!host?.handsOff && (
        <Select
          label="Downloads at once"
          help="The rest wait their turn."
          options={DOWNLOADS_AT_ONCE.map((n) => ({
            value: String(n),
            label: String(n),
          }))}
          value={String(concurrent)}
          onValueChange={(value) => setConcurrent(Number(value))}
        />
      )}
      <Select
        label="Version searches at once"
        help="Versions are found for this many episodes at a time when a season or show is added."
        options={DOWNLOAD_SEARCHES.map((n) => ({
          value: String(n),
          label: String(n),
        }))}
        value={String(searches)}
        onValueChange={(value) => setSearches(Number(value))}
      />
      {!host?.handsOff && (
        <Switch
          side="right"
          label="Save subtitles"
          help="Subtitle files go next to the video, named so players find them."
          value={subtitles}
          onValueChange={setSubtitles}
        />
      )}
      {currentHost().name === 'android-app' && (
        <Switch
          side="right"
          label="Only on Wi-Fi"
          help="Downloads wait for Wi-Fi or another unmetered network rather than use mobile data."
          value={wifiOnly}
          onValueChange={setWifiOnly}
        />
      )}
    </SettingsCard>
  );
}

const KEEP_CSS_MS = 15_000;
const DOCS_URL = 'https://docs.aiostreams.viren070.me';
const CSS_DOCS_URL = `${DOCS_URL}/reference/web-app-css`;

function ThemeSection() {
  const [colors, setColors] = useSetting(settings.themeColors);
  const [css, setCss] = useSetting(settings.customCss);
  const [draft, setDraft] = React.useState(css);
  const accent = colors.accent ?? DEFAULT_ACCENT;
  const background = colors.background ?? DEFAULT_BACKGROUND;
  // The default colours are stored as nothing, so a later default change applies.
  const pick = (next: { accent: string; background: string }) =>
    setColors({
      accent: next.accent === DEFAULT_ACCENT ? undefined : next.accent,
      background:
        next.background === DEFAULT_BACKGROUND ? undefined : next.background,
    });
  // Undone unless kept, so CSS that hides the page can't lock anyone out.
  const pending = React.useRef<
    { id: string | number; previous: string } | undefined
  >(undefined);
  const apply = () => {
    const previous = pending.current?.previous ?? css;
    if (pending.current) toast.dismiss(pending.current.id);
    setCss(draft);
    const id = toast('Custom CSS applied', {
      description: 'It will be undone unless you keep it.',
      duration: KEEP_CSS_MS,
      action: { label: 'Keep', onClick: () => undefined },
      onDismiss: () => {
        if (pending.current?.id === id) pending.current = undefined;
      },
      onAutoClose: () => {
        pending.current = undefined;
        setCss(previous);
        toast('Custom CSS undone');
      },
    });
    pending.current = { id, previous };
  };
  return (
    <SettingsCard
      title="Theme"
      description="Saved to your account, so it follows you to every device."
    >
      <div className="space-y-2">
        <p className="text-sm font-semibold">Presets</p>
        <div className="flex flex-wrap gap-2">
          {THEME_PRESETS.map((preset) => {
            const selected =
              preset.accent === accent && preset.background === background;
            return (
              <button
                key={preset.name}
                type="button"
                data-ui="theme-preset"
                aria-pressed={selected}
                onClick={() => pick(preset)}
                className={cn(
                  'flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-colors hover:bg-white/5',
                  selected
                    ? 'border-[--brand] ring-1 ring-[--brand]'
                    : 'border-white/10'
                )}
              >
                <span
                  className="flex size-6 items-center justify-center rounded-full ring-1 ring-white/15"
                  style={{ backgroundColor: preset.background }}
                >
                  <span
                    className="size-3 rounded-full"
                    style={{ backgroundColor: preset.accent }}
                  />
                </span>
                {preset.name}
              </button>
            );
          })}
        </div>
      </div>
      <ColorInput
        label="Accent"
        help="Buttons, progress bars and highlights."
        value={accent}
        onValueChange={(value) => pick({ accent: value, background })}
      />
      <ColorInput
        label="Background"
        help="Pages and panels take their shades from it. Dark colours read best."
        value={background}
        onValueChange={(value) => pick({ accent, background: value })}
      />
      <Textarea
        data-ui="custom-css-editor"
        label="Custom CSS"
        help={
          CUSTOM_CSS_OFF ? (
            <>
              Off for this visit, since the address ends in <code>?safe</code>.
              Fix or clear it here, then open the app without it.
            </>
          ) : (
            <>
              Applied on top of the theme. Parts of the app carry a{' '}
              <code>data-ui</code> attribute to style them by, such as{' '}
              <code>[data-ui=&quot;progress-bar&quot;]</code>. If it ever hides
              the page, add <code>?safe</code> to the address to turn it off.
              See the{' '}
              <a
                href={CSS_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="text-[--brand] hover:underline"
              >
                guide
              </a>{' '}
              for every selector and examples.
            </>
          )
        }
        value={draft}
        onValueChange={setDraft}
        maxLength={MAX_CUSTOM_CSS}
        spellCheck={false}
        placeholder={
          '[data-ui="progress-bar-fill"] {\n  background: hotpink;\n}'
        }
        className="min-h-60 font-mono text-xs"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          intent="white"
          className="rounded-full max-sm:w-full"
          disabled={draft.trim() === css.trim()}
          onClick={apply}
        >
          Apply CSS
        </Button>
        {(colors.accent || colors.background || css) && (
          <Button
            size="sm"
            intent="gray-outline"
            className="rounded-full max-sm:w-full"
            onClick={() => {
              setColors({});
              setCss('');
              setDraft('');
            }}
          >
            Reset theme
          </Button>
        )}
      </div>
    </SettingsCard>
  );
}

function AccountSection() {
  const { client, user, switchUser, signOut, changeServer } = useSession();
  const info = useServerInfo();
  const users = usePickableUsers();
  const avatar = users.data?.find((u) => u.user.Id === user.Id)?.avatar ?? null;
  const several = (users.data?.length ?? 0) > 1;
  const configure = configureUrl(client.base, info);
  const confirmSignOut = useConfirmationDialog({
    title: 'Sign out',
    description: __STANDALONE__
      ? 'Sign out of this server?'
      : 'Sign out of this browser?',
    actionText: 'Sign out',
    onConfirm: signOut,
  });
  const button = 'w-full rounded-full sm:w-auto';

  return (
    <>
      <SettingsCard>
        <SettingsRow
          label={
            <span className="flex items-center gap-3">
              <UserAvatar name={user.Name} src={avatar} className="size-10" />
              <span>
                <span className="block text-base">{user.Name}</span>
                <span className="block font-normal text-[--muted]">
                  {info.name ?? serverAddress(client.base)}
                </span>
              </span>
            </span>
          }
        >
          <Button
            intent="gray-outline"
            className={button}
            onClick={() => confirmSignOut.open()}
          >
            Sign out
          </Button>
        </SettingsRow>
        {several && (
          <SettingsRow
            label="Switch user"
            help="Watch as someone else on this configuration."
          >
            <Button
              intent="gray-outline"
              className={button}
              onClick={switchUser}
            >
              Switch
            </Button>
          </SettingsRow>
        )}
        {changeServer && (
          <SettingsRow label="Server" help={serverAddress(client.base)}>
            <Button
              intent="gray-outline"
              className={button}
              onClick={changeServer}
            >
              Change server
            </Button>
          </SettingsRow>
        )}
        {configure && (
          <SettingsRow
            label="Configuration"
            help="Addons, catalogs and users are set up on the configuration page."
          >
            <Button
              intent="gray-outline"
              className={button}
              onClick={() => window.open(configure, '_blank')}
            >
              Open
            </Button>
          </SettingsRow>
        )}
      </SettingsCard>
      <ConfirmationDialog {...confirmSignOut} />
    </>
  );
}

const REPO_URL = 'https://github.com/Viren070/AIOStreams';
/** The desktop app's stable release, whose notes link each download. */
const DESKTOP_DOWNLOAD_URL = `${REPO_URL}/releases/tag/desktop`;

const LINKS = [
  {
    name: 'Source code',
    help: 'Where the app is made, and where to report a problem.',
    url: REPO_URL,
  },
  {
    name: 'Documentation',
    help: 'How to use the app and what each setting does.',
    url: `${DOCS_URL}/guides/app`,
  },
];

function AboutSection() {
  const { client } = useSession();
  const shell = useShellInfo();
  const { version } = useServerInfo();
  const info = useQuery({
    queryKey: ['jf-system-info', client.base],
    queryFn: () =>
      client.get<{ ServerName?: string; Version?: string }>(
        '/System/Info/Public'
      ),
    staleTime: 5 * 60_000,
  });
  const rows: [string, string | null | undefined][] = [
    [
      'Server',
      info.data?.ServerName &&
        (version
          ? `${info.data.ServerName} (${version})`
          : info.data.ServerName),
    ],
    ['Address', serverAddress(client.base)],
    ['Jellyfin API', info.data?.Version],
    ['Web app', __APP_COMMIT__],
    ...(shell
      ? ([
          [
            shell.platform === 'android' ? 'Android app' : 'Desktop app',
            shell.app,
          ],
          ...(shell.player && !shell.mpv
            ? [['Player', shell.player]]
            : [
                ['mpv', shell.mpv],
                ['FFmpeg', shell.ffmpeg],
              ]),
        ] as [string, string | null][])
      : []),
  ];
  return (
    <>
      <SettingsCard>
        {rows.map(([label, value]) => (
          <SettingsRow key={label} label={label}>
            <span className="break-all text-sm text-[--muted]">
              {value || '…'}
            </span>
          </SettingsRow>
        ))}
        {currentHost().name === 'browser' && (
          <SettingsRow
            label="Desktop app"
            help="This web app with a player of its own, which plays what a browser can't, on Windows, Mac and Linux."
          >
            <Button
              intent="gray-outline"
              className="w-full rounded-full sm:w-auto"
              onClick={() =>
                window.open(DESKTOP_DOWNLOAD_URL, '_blank', 'noopener')
              }
            >
              Download
            </Button>
          </SettingsRow>
        )}
        {LINKS.map((link) => (
          <SettingsRow key={link.name} label={link.name} help={link.help}>
            <Button
              intent="gray-outline"
              className="w-full rounded-full sm:w-auto"
              onClick={() => window.open(link.url, '_blank', 'noopener')}
            >
              Visit
            </Button>
          </SettingsRow>
        ))}
      </SettingsCard>
      <SettingsCard title="Credits">
        {credits(shell).map((credit) => (
          <SettingsRow key={credit.name} label={credit.name} help={credit.help}>
            <Button
              intent="gray-outline"
              className="w-full rounded-full sm:w-auto"
              onClick={() => window.open(credit.url, '_blank', 'noopener')}
            >
              Visit
            </Button>
          </SettingsRow>
        ))}
      </SettingsCard>
    </>
  );
}

/** The Linux app builds its own libmpv, so only these ship someone else's. */
const LIBMPV_BUILDS: Record<string, { name: string; url: string }> = {
  windows: {
    name: 'shinchiro',
    url: 'https://github.com/shinchiro/mpv-winbuild-cmake',
  },
  macos: { name: 'IINA', url: 'https://iina.io' },
};

function credits(
  shell: ShellInfo | null
): { name: string; help: string; url: string }[] {
  const build = shell ? LIBMPV_BUILDS[shell.platform] : undefined;
  return [
    {
      name: 'Seanime',
      help: 'The interface is built on its components.',
      url: 'https://github.com/5rahim/seanime',
    },
    {
      name: 'Jellyfin',
      help: 'The API this app speaks.',
      url: 'https://jellyfin.org',
    },
    ...(shell
      ? [
          { name: 'mpv', help: 'Plays the video.', url: 'https://mpv.io' },
          {
            name: 'FFmpeg',
            help: 'Decodes what mpv plays.',
            url: 'https://ffmpeg.org',
          },
        ]
      : []),
    ...(build
      ? [{ ...build, help: 'Builds the mpv library this app ships with.' }]
      : []),
  ];
}

interface Section {
  id: string;
  label: string;
  description: string;
  icon: IconType;
  group: string;
  Content: React.ComponentType;
}

function sections(): Section[] {
  const host = currentHost();
  return [
    {
      id: 'playback',
      label: 'Playback',
      description: 'Next episode, controls and players',
      icon: LuCirclePlay,
      group: 'Watching',
      Content: PlaybackSection,
    },
    {
      id: 'audio',
      label: 'Audio',
      description: host.name === 'desktop' ? 'Language and output' : 'Language',
      icon: LuVolume2,
      group: 'Watching',
      Content: AudioSection,
    },
    {
      id: 'subtitles',
      label: 'Subtitles',
      description: 'Language and how subtitles look',
      icon: LuCaptions,
      group: 'Watching',
      Content: SubtitlesSection,
    },
    {
      id: 'interface',
      label: 'Interface',
      description: 'Home, grids and episodes',
      icon: LuLayoutGrid,
      group: 'App',
      Content: InterfaceSection,
    },
    // A touch screen has no keys to set, and a remote too few to move around.
    ...(host.tv || matchMedia('(pointer: coarse)').matches
      ? []
      : [
          {
            id: 'shortcuts',
            label: 'Shortcuts',
            description: 'Keys, remotes and gamepads',
            icon: LuKeyboard,
            group: 'App',
            Content: ShortcutSettings,
          },
        ]),
    {
      id: 'theme',
      label: 'Theme',
      description: 'Colours and custom CSS',
      icon: LuPalette,
      group: 'App',
      Content: ThemeSection,
    },
    ...(host.downloads
      ? [
          {
            id: 'downloads',
            label: 'Downloads',
            description: 'Where they go and how many run at once',
            icon: LuDownload,
            group: 'App',
            Content: DownloadsSection,
          },
        ]
      : []),
    {
      id: 'cache',
      label: 'Cache',
      description: 'Pages and artwork saved on this device',
      icon: LuDatabase,
      group: 'App',
      Content: CacheSection,
    },
    {
      id: 'account',
      label: 'Account',
      description: 'Who you are signed in as',
      icon: LuUser,
      group: 'App',
      Content: AccountSection,
    },
    ...(host.name === 'desktop'
      ? [
          {
            id: 'desktop',
            label: 'Desktop app',
            description: 'Updates, Discord, mpv and troubleshooting',
            icon: LuMonitor,
            group: 'App',
            Content: DesktopSection,
          },
        ]
      : []),
    ...(host.name === 'android-app'
      ? [
          {
            id: 'android',
            label: 'Android app',
            description:
              appBridge()?.pip === false
                ? 'Updates, mpv and troubleshooting'
                : 'Updates, picture-in-picture, mpv and troubleshooting',
            icon: host.tv ? LuTv : LuSmartphone,
            group: 'App',
            Content: AndroidSection,
          },
        ]
      : []),
    ...(host.settings
      ? [
          {
            id: 'app',
            label: host.settings.label,
            description: host.settings.description,
            icon: LuAppWindow,
            group: 'App',
            Content: AppSection,
          },
        ]
      : []),
    {
      id: 'about',
      label: 'About',
      description: 'Versions and links',
      icon: LuInfo,
      group: 'App',
      Content: AboutSection,
    },
  ];
}

export function SettingsPage({
  tab,
  onTabChange,
}: {
  tab: string;
  onTabChange(tab: string): void;
}) {
  const all = React.useMemo(sections, []);
  const donation = useDisclosure(false);
  // With no marker sliding, the tabs keep the usual focus mark.
  const still = useReducedMotion();
  const active = all.find((s) => s.id === tab) ?? all[0];
  const groups = new Map<string, Section[]>();
  for (const s of all) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);

  return (
    <PageBody>
      <h1 data-ui="page-title" className="text-3xl font-bold">
        Settings
      </h1>
      <Tabs
        value={active.id}
        onValueChange={onTabChange}
        variant="pill"
        className="grid w-full grid-cols-1 gap-6 lg:grid-cols-[240px,1fr]"
        triggerClass={cn(
          'h-9 w-fit rounded-lg border-0 px-3 text-base lg:w-full lg:justify-start',
          'data-[state=active]:bg-[--subtle] data-[state=active]:text-white dark:hover:text-white',
          'transition-all duration-200 hover:bg-[--subtle]/50 focus-visible:ring-0 focus-visible:ring-offset-0',
          'motion-reduce:[[data-tv]_&]:focus-visible:bg-white/20'
        )}
        // The sliding marker carries the focus mark, so the two move together.
        indicatorClass="group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-[--ring] [[data-tv]_&]:group-focus-visible:bg-white/20 [[data-tv]_&]:group-focus-visible:outline-none [html[data-pointer-focus]_&]:!outline-none"
        listClass="h-fit w-full flex flex-wrap lg:block lg:flex-nowrap"
      >
        <TabsList className="max-w-full flex-wrap lg:sticky lg:top-6 lg:space-y-3">
          {[...groups.entries()].map(([group, items]) => (
            <Card
              key={group}
              className="contents border-0 bg-transparent lg:block lg:border lg:border-white/10 lg:bg-gray-950/70 lg:p-2"
            >
              <p className="hidden px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[--muted] lg:block">
                {group}
              </p>
              {items.map((s) => (
                <TabsTrigger
                  key={s.id}
                  value={s.id}
                  data-name={s.id}
                  data-focus={still && !currentHost().tv ? undefined : 'own'}
                  className="group"
                >
                  <s.icon className="mr-3 text-xl transition-transform duration-200 group-hover:translate-x-0.5" />
                  {s.label}
                </TabsTrigger>
              ))}
            </Card>
          ))}
          <div className="flex basis-full justify-center pt-1">
            <Button
              size="sm"
              intent="gray-outline"
              className="rounded-full"
              leftIcon={<LuHeart />}
              onClick={donation.open}
            >
              Donate
            </Button>
          </div>
        </TabsList>
        <div className="min-w-0">
          {all.map((s) => (
            <TabsContent
              key={s.id}
              value={s.id}
              tabIndex={-1}
              data-name={s.id}
              className="space-y-6 duration-300 animate-in fade-in-0 slide-in-from-bottom-2"
            >
              {s.id === active.id && (
                <>
                  <SettingsPageHeader
                    title={s.label}
                    description={s.description}
                    icon={s.icon}
                  />
                  <s.Content />
                </>
              )}
            </TabsContent>
          ))}
        </div>
      </Tabs>
      <DonationModal open={donation.isOpen} onOpenChange={donation.toggle} />
    </PageBody>
  );
}
