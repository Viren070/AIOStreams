import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { IconType } from 'react-icons';
import {
  LuCaptions,
  LuCirclePlay,
  LuHeart,
  LuInfo,
  LuLayoutGrid,
  LuMonitor,
  LuPalette,
  LuUser,
  LuVolume2,
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
import { Button } from '@aiostreams/ui/button';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@aiostreams/ui/shared/confirmation-dialog';
import { cn } from '@aiostreams/ui/core/styling';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import { DonationModal } from '@aiostreams/ui/shared/donation-modal';
import { useDisclosure } from '@aiostreams/ui/hooks/disclosure';
import { useSession } from '../lib/session';
import { usePickableUsers, useViews } from '../lib/queries';
import { libraryLabel } from '../lib/format';
import { configureUrl } from '../lib/paths';
import { playbackHost } from '../lib/hosts';
import {
  openLogs,
  openMpvConfig,
  requestDiagnostics,
  useShellInfo,
  applyUpdate,
  checkForUpdates,
  useUpdateState,
  type ShellInfo,
  type UpdateState,
} from '../lib/hosts/shell';
import { LANGUAGES } from '../lib/languages';
import { serverAddress } from '../lib/servers';
import { subtitleCss } from '../lib/subtitle-style';
import { usePlaybackPrefs, type SubtitleMode } from '../lib/user-config';
import {
  externalAlways,
  externalPlayerTemplate,
  setExternalAlways,
  setExternalPlayerTemplate,
} from '../lib/playback';
import {
  AUDIO_CHANNELS,
  CUSTOM_CSS_OFF,
  MAX_CUSTOM_CSS,
  MAX_FEATURED,
  useCustomCss,
  useThemeColors,
  NEXT_COUNTDOWNS,
  NEXT_LEADS,
  SEEK_STEPS,
  SEGMENT_ACTIONS,
  SEGMENT_TYPES,
  useSegmentAction,
  useAudioChannels,
  useEpisodeLayout,
  useEscExitsFullscreen,
  useChapterSkips,
  useCombineSearch,
  useUpdateChannel,
  useFeatured,
  useHardwareDecoding,
  useHeroMode,
  useMergeNextUp,
  useNextCountdown,
  useNextFallbackFirst,
  useNextLead,
  useNextPrompt,
  usePassthrough,
  usePosterLines,
  usePosterSize,
  useSeekStep,
  useShareOnDiscord,
  useSkipVersionList,
  useSubtitleBackgroundColor,
  useSubtitleBold,
  useSubtitleBackgroundOpacity,
  useSubtitleOutline,
  useSubtitleOutlineColor,
  useSubtitleOverrideStyled,
  useSubtitleSize,
  useSubtitleStyle,
  useSubtitleTextColor,
  type AudioChannels,
  type EpisodeLayout,
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
import { PageBody } from '../components/layout';
import { UserAvatar } from '../components/user-avatar';
import {
  SettingsCard,
  SettingsPageHeader,
  SettingsRow,
} from '../components/settings-card';

const ANY = 'any';
const LANGUAGE_OPTIONS = [
  { value: ANY, label: 'No preference' },
  ...LANGUAGES.map((l) => ({ value: l.code, label: l.name })),
];

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

const PLAYER_PRESETS = [
  { name: 'VLC', template: 'vlc://{url}' },
  {
    name: 'Infuse',
    template:
      'infuse://x-callback-url/play?url={encodedUrl}&filename={filename}&sub={subtitles}&position={position}&x-success={returnUrl}',
  },
  { name: 'Outplayer', template: 'outplayer://{url}' },
  { name: 'IINA', template: 'iina://weblink?url={encodedUrl}' },
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
  const [action, setAction] = useSegmentAction(type);
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
  const [seekStep, setSeekStep] = useSeekStep();
  const [skipList, setSkipList] = useSkipVersionList();
  const [nextPrompt, setNextPrompt] = useNextPrompt();
  const [nextLead, setNextLead] = useNextLead();
  const [nextCountdown, setNextCountdown] = useNextCountdown();
  const [nextFallbackFirst, setNextFallbackFirst] = useNextFallbackFirst();
  const [hardwareDecoding, setHardwareDecoding] = useHardwareDecoding();
  const [escExits, setEscExits] = useEscExitsFullscreen();
  const [chapterSkips, setChapterSkips] = useChapterSkips();
  const bingeGroups = useFeature('versions');
  const shell = playbackHost() === 'shell';
  const [template, setTemplate] = React.useState(externalPlayerTemplate);
  const [always, setAlways] = React.useState(externalAlways);
  const changeTemplate = (value: string) => {
    setTemplate(value);
    setExternalPlayerTemplate(value);
  };
  const changeAlways = (value: boolean) => {
    setAlways(value);
    setExternalAlways(value);
  };

  return (
    <>
      <SettingsCard title="Versions" description={ON_DEVICE}>
        <Switch
          side="right"
          label="Skip the version list"
          help={
            skipList
              ? 'Play starts the version you last watched, or the first one. Hold Play to choose instead.'
              : 'Play lists the versions to choose from. Hold Play to start the first one instead.'
          }
          value={skipList}
          onValueChange={setSkipList}
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
          value={prefs.EnableNextEpisodeAutoPlay !== false}
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
          help="How far the skip buttons and the arrow keys jump."
          options={SEEK_STEPS.map((s) => ({
            value: String(s),
            label: `${s} seconds`,
          }))}
          value={String(seekStep)}
          onValueChange={(v) => setSeekStep(Number(v))}
        />
        {shell && (
          <Switch
            side="right"
            label="Esc leaves full screen"
            value={escExits}
            onValueChange={setEscExits}
          />
        )}
      </SettingsCard>
      {shell && (
        <SettingsCard title="Video" description={ON_DEVICE}>
          <Switch
            side="right"
            label="Hardware decoding"
            help="Decodes on the graphics card. Turn it off if video shows artefacts or stays black."
            value={hardwareDecoding}
            onValueChange={setHardwareDecoding}
          />
        </SettingsCard>
      )}
      <SettingsCard title="External player" description={ON_DEVICE}>
        <div className="space-y-3">
          <TextInput
            label="Player link"
            placeholder="vlc://{url}"
            value={template}
            onValueChange={changeTemplate}
            help="Adds an open-in-player button to each version. {url} is the stream address, {encodedUrl} the same address URL-encoded, {filename} the file's name, {subtitles} each external subtitle (its parameter repeats per file), {position} the second to start at, and {returnUrl} a link back here for a player that reports where it stopped. Values other than {url} are URL-encoded."
          />
          <div className="flex flex-wrap gap-2">
            {PLAYER_PRESETS.map((p) => (
              <Button
                key={p.name}
                size="sm"
                intent="gray-outline"
                className="rounded-full"
                onClick={() => changeTemplate(p.template)}
              >
                {p.name}
              </Button>
            ))}
            <Button
              size="sm"
              intent="gray-subtle"
              className="rounded-full"
              onClick={() => changeTemplate('')}
            >
              None
            </Button>
          </div>
        </div>
        {template.trim() && (
          <Switch
            side="right"
            label="Play every version in it"
            help="Picking a version opens it in your player instead of here."
            value={always}
            onValueChange={changeAlways}
          />
        )}
      </SettingsCard>
    </>
  );
}

function AudioSection() {
  const { prefs, update } = usePlaybackPrefs();
  const [audioChannels, setAudioChannels] = useAudioChannels();
  const [passthrough, setPassthrough] = usePassthrough();
  return (
    <>
      <SettingsCard title="Language" description={ON_ACCOUNT}>
        <Select
          label="Audio language"
          help="Picked when a version has it; otherwise the version's own default plays."
          options={LANGUAGE_OPTIONS}
          value={prefs.AudioLanguagePreference || ANY}
          onValueChange={(v) =>
            update({ AudioLanguagePreference: v === ANY ? '' : v })
          }
        />
      </SettingsCard>
      {playbackHost() === 'shell' && (
        <SettingsCard title="Output" description={ON_DEVICE}>
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
  const [size, setSize] = useSubtitleSize();
  const [bold, setBold] = useSubtitleBold();
  const [textColor, setTextColor] = useSubtitleTextColor();
  const [outline, setOutline] = useSubtitleOutline();
  const [outlineColor, setOutlineColor] = useSubtitleOutlineColor();
  const [backgroundColor, setBackgroundColor] = useSubtitleBackgroundColor();
  const [backgroundOpacity, setBackgroundOpacity] =
    useSubtitleBackgroundOpacity();
  const [overrideStyled, setOverrideStyled] = useSubtitleOverrideStyled();
  const css = subtitleCss(useSubtitleStyle());
  return (
    <>
      <SettingsCard title="Language" description={ON_ACCOUNT}>
        <Select
          label="Subtitle language"
          options={LANGUAGE_OPTIONS}
          value={prefs.SubtitleLanguagePreference || ANY}
          onValueChange={(v) =>
            update({ SubtitleLanguagePreference: v === ANY ? '' : v })
          }
        />
        <Select
          label="Subtitles"
          help={SUBTITLE_MODES.find((m) => m.value === mode)?.help}
          options={SUBTITLE_MODES.map(({ value, label }) => ({ value, label }))}
          value={mode}
          onValueChange={(v) => update({ SubtitleMode: v as SubtitleMode })}
        />
      </SettingsCard>
      <SettingsCard title="Preview">
        <div className="flex aspect-[16/5] items-end justify-center rounded-lg bg-gradient-to-br from-gray-700 to-gray-950 p-4">
          <span className="rounded px-2 py-0.5 text-center text-lg" style={css}>
            This is how subtitles will look.
          </span>
        </div>
      </SettingsCard>
      <SettingsCard title="Text" description={ON_DEVICE}>
        <Select
          label="Size"
          options={[
            { value: 'small', label: 'Small' },
            { value: 'normal', label: 'Normal' },
            { value: 'large', label: 'Large' },
            { value: 'huge', label: 'Huge' },
          ]}
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
          help="Styled subtitles, common in anime, keep their own look unless this is on. Only in the desktop app."
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
      return `Version ${update.version} installs on the next start.`;
    case 'current':
      return 'Up to date.';
    case 'error':
      return `Could not check: ${update.error}`;
  }
}

function UpdatesCard() {
  const [setting, setSetting] = useUpdateChannel();
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
            Restart now
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

function DesktopSection() {
  const server = useServerInfo();
  const [shareOnDiscord, setShareOnDiscord] = useShareOnDiscord();
  return (
    <>
      <UpdatesCard />
      <SettingsCard title="Discord" description={ON_DEVICE}>
        <Switch
          side="right"
          label="Show what you're watching"
          help="Your Discord profile shows the title, the episode and the time left while something plays. Discord has to be running on this computer."
          value={shareOnDiscord}
          onValueChange={setShareOnDiscord}
        />
      </SettingsCard>
      <SettingsCard title="mpv">
        <SettingsRow
          label="mpv configuration"
          help="mpv.conf, input.conf, scripts and shaders in this folder apply to playback."
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
        <SettingsRow
          label="Diagnostics"
          help="Versions and the recent log, to paste into a bug report."
        >
          <Button
            intent="gray-outline"
            className="w-full rounded-full sm:w-auto"
            onClick={() =>
              requestDiagnostics(
                server.version && `AIOStreams ${server.version}`
              )
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
      </SettingsCard>
    </>
  );
}

const NOTHING = 'none';

function InterfaceSection() {
  const views = useViews();
  const [featured, setFeatured] = useFeatured();
  const [heroMode, setHeroMode] = useHeroMode();
  const [mergeNextUp, setMergeNextUp] = useMergeNextUp();
  const [combineSearch, setCombineSearch] = useCombineSearch();
  const [posterSize, setPosterSize] = usePosterSize();
  const [posterLines, setPosterLines] = usePosterLines();
  const [episodeLayout, setEpisodeLayout] = useEpisodeLayout();

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
          help="Following pins it above the rows and shows the card the pointer rests on or the keyboard is on, starting with a featured title. Touch screens and narrow windows keep it rotating."
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
    </>
  );
}

const KEEP_CSS_MS = 15_000;

function ThemeSection() {
  const [colors, setColors] = useThemeColors();
  const [css, setCss] = useCustomCss();
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

/** The desktop app's stable release, whose notes link each download. */
const DESKTOP_DOWNLOAD_URL =
  'https://github.com/Viren070/AIOStreams/releases/tag/desktop';

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
          ['Desktop app', shell.app],
          ['mpv', shell.mpv],
          ['FFmpeg', shell.ffmpeg],
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
        {playbackHost() === 'browser' && (
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
      description:
        playbackHost() === 'shell' ? 'Language and output' : 'Language',
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
    {
      id: 'theme',
      label: 'Theme',
      description: 'Colours and custom CSS',
      icon: LuPalette,
      group: 'App',
      Content: ThemeSection,
    },
    {
      id: 'account',
      label: 'Account',
      description: 'Who you are signed in as',
      icon: LuUser,
      group: 'App',
      Content: AccountSection,
    },
    ...(playbackHost() === 'shell'
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
    {
      id: 'about',
      label: 'About',
      description: 'Versions',
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
          'transition-all duration-200 hover:bg-[--subtle]/50'
        )}
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
