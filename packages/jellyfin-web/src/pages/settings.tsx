import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { IconType } from 'react-icons';
import {
  LuCaptions,
  LuCirclePlay,
  LuInfo,
  LuLayoutGrid,
  LuMonitor,
  LuUser,
} from 'react-icons/lu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@aiostreams/ui/tabs';
import { Card } from '@aiostreams/ui/card';
import { Select } from '@aiostreams/ui/select';
import { Combobox } from '@aiostreams/ui/combobox';
import { Switch } from '@aiostreams/ui/switch';
import { Slider } from '@aiostreams/ui/slider';
import { ColorInput } from '@aiostreams/ui/color-input';
import { TextInput } from '@aiostreams/ui/text-input';
import { Button } from '@aiostreams/ui/button';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@aiostreams/ui/shared/confirmation-dialog';
import { cn } from '@aiostreams/ui/core/styling';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
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
  type UpdateState,
} from '../lib/hosts/shell';
import { LANGUAGES } from '../lib/languages';
import { serverAddress } from '../lib/servers';
import { subtitleCss } from '../lib/subtitle-style';
import { usePlaybackPrefs, type SubtitleMode } from '../lib/user-config';
import {
  externalPlayerTemplate,
  setExternalPlayerTemplate,
} from '../lib/playback';
import {
  AUDIO_CHANNELS,
  MAX_FEATURED,
  NEXT_COUNTDOWNS,
  NEXT_LEADS,
  SEEK_STEPS,
  useAudioChannels,
  useEpisodeLayout,
  useEscExitsFullscreen,
  useUpdateChannel,
  useFeatured,
  useHardwareDecoding,
  useMergeNextUp,
  useNextCountdown,
  useNextFallbackFirst,
  useNextLead,
  useNextPrompt,
  usePassthrough,
  usePosterLines,
  usePosterSize,
  useSeekStep,
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
  type NextPrompt,
  type PosterLine,
  type PosterSize,
  type SubtitleOutline,
  type SubtitleSize,
} from '../lib/settings';
import { useServerInfo } from '../lib/server-info';
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
  { name: 'Infuse', template: 'infuse://x-callback-url/play?url={encodedUrl}' },
  { name: 'Outplayer', template: 'outplayer://{url}' },
  { name: 'IINA', template: 'iina://weblink?url={encodedUrl}' },
];

const ON_DEVICE = 'Kept on this device.';

const NEXT_PROMPT_HELP: Record<NextPrompt, string> = {
  credits:
    'When the credits start, if they run to the end; otherwise a set time before the end.',
  end: 'A set time before the end.',
  off: 'Episodes end without offering the next one.',
};

function PlaybackSection() {
  const { prefs, update } = usePlaybackPrefs();
  const [seekStep, setSeekStep] = useSeekStep();
  const [nextPrompt, setNextPrompt] = useNextPrompt();
  const [nextLead, setNextLead] = useNextLead();
  const [nextCountdown, setNextCountdown] = useNextCountdown();
  const [nextFallbackFirst, setNextFallbackFirst] = useNextFallbackFirst();
  const [template, setTemplate] = React.useState(externalPlayerTemplate);
  const changeTemplate = (value: string) => {
    setTemplate(value);
    setExternalPlayerTemplate(value);
  };
  const mode = prefs.SubtitleMode ?? 'Default';

  return (
    <>
      <SettingsCard
        title="Languages"
        description="Saved to your account, so your other devices and Jellyfin apps use them too."
      >
        <Select
          label="Audio language"
          help="Picked when a version has it; otherwise the version's own default plays."
          options={LANGUAGE_OPTIONS}
          value={prefs.AudioLanguagePreference || ANY}
          onValueChange={(v) =>
            update({ AudioLanguagePreference: v === ANY ? '' : v })
          }
        />
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
      <SettingsCard
        title="Next episode"
        description="Whether it plays on is saved to your account; the rest is kept on this device."
      >
        <Switch
          side="right"
          label="Play it automatically"
          help="Counts down, then plays the next episode in the same kind of version. Off, the prompt waits for you."
          value={prefs.EnableNextEpisodeAutoPlay !== false}
          onValueChange={(v) => update({ EnableNextEpisodeAutoPlay: v })}
        />
        <Switch
          side="right"
          label="Play the first version when none matches"
          help="Otherwise the next episode's version list opens when none is like the one you watched."
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
      </SettingsCard>
      <SettingsCard title="External player" description={ON_DEVICE}>
        <div className="space-y-3">
          <TextInput
            label="Player link"
            placeholder="vlc://{url}"
            value={template}
            onValueChange={changeTemplate}
            help="Adds an open-in-player button to each version. {url} is the stream address, {encodedUrl} the same address URL-encoded."
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
      </SettingsCard>
    </>
  );
}

function SubtitlesSection() {
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
  const [hardwareDecoding, setHardwareDecoding] = useHardwareDecoding();
  const [audioChannels, setAudioChannels] = useAudioChannels();
  const [passthrough, setPassthrough] = usePassthrough();
  const [escExits, setEscExits] = useEscExitsFullscreen();
  return (
    <>
      <UpdatesCard />
      <SettingsCard title="Video" description={ON_DEVICE}>
        <Switch
          side="right"
          label="Hardware decoding"
          help="Decodes on the graphics card. Turn it off if video shows artefacts or stays black."
          value={hardwareDecoding}
          onValueChange={setHardwareDecoding}
        />
      </SettingsCard>
      <SettingsCard title="Audio" description={ON_DEVICE}>
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
      <SettingsCard title="Window" description={ON_DEVICE}>
        <Switch
          side="right"
          label="Esc leaves full screen"
          value={escExits}
          onValueChange={setEscExits}
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
              requestDiagnostics()
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
  const [mergeNextUp, setMergeNextUp] = useMergeNextUp();
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
        <Switch
          side="right"
          label="Merge continue watching and next up"
          help="Shows next episodes in the continue watching row, after what you are partway through."
          value={mergeNextUp}
          onValueChange={setMergeNextUp}
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

function AboutSection() {
  const { client } = useSession();
  const shell = useShellInfo();
  const info = useQuery({
    queryKey: ['jf-system-info', client.base],
    queryFn: () =>
      client.get<{ ServerName?: string; Version?: string }>(
        '/System/Info/Public'
      ),
    staleTime: 5 * 60_000,
  });
  const rows: [string, string | null | undefined][] = [
    ['Server', info.data?.ServerName],
    ['Address', serverAddress(client.base)],
    ['Jellyfin API', info.data?.Version],
    ['Web app', __APP_VERSION__],
    ...(shell
      ? ([
          ['Desktop app', shell.app],
          ['mpv', shell.mpv],
          ['FFmpeg', shell.ffmpeg],
        ] as [string, string | null][])
      : []),
  ];
  return (
    <SettingsCard>
      {rows.map(([label, value]) => (
        <SettingsRow key={label} label={label}>
          <span className="break-all text-sm text-[--muted]">
            {value || '…'}
          </span>
        </SettingsRow>
      ))}
    </SettingsCard>
  );
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
      description: 'Languages, subtitles and controls',
      icon: LuCirclePlay,
      group: 'Watching',
      Content: PlaybackSection,
    },
    {
      id: 'subtitles',
      label: 'Subtitles',
      description: 'How subtitles look',
      icon: LuCaptions,
      group: 'Watching',
      Content: SubtitlesSection,
    },
    ...(playbackHost() === 'shell'
      ? [
          {
            id: 'desktop',
            label: 'Desktop app',
            description: 'The player on this computer',
            icon: LuMonitor,
            group: 'Watching',
            Content: DesktopSection,
          },
        ]
      : []),
    {
      id: 'interface',
      label: 'Interface',
      description: 'Home, grids and episodes',
      icon: LuLayoutGrid,
      group: 'App',
      Content: InterfaceSection,
    },
    {
      id: 'account',
      label: 'Account',
      description: 'Who you are signed in as',
      icon: LuUser,
      group: 'App',
      Content: AccountSection,
    },
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
  const active = all.find((s) => s.id === tab) ?? all[0];
  const groups = new Map<string, Section[]>();
  for (const s of all) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);

  return (
    <PageBody>
      <h1 className="text-3xl font-bold">Settings</h1>
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
                <TabsTrigger key={s.id} value={s.id} className="group">
                  <s.icon className="mr-3 text-xl transition-transform duration-200 group-hover:translate-x-0.5" />
                  {s.label}
                </TabsTrigger>
              ))}
            </Card>
          ))}
        </TabsList>
        <div className="min-w-0">
          {all.map((s) => (
            <TabsContent
              key={s.id}
              value={s.id}
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
    </PageBody>
  );
}
