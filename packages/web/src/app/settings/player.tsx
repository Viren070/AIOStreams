import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { toast } from 'sonner';
import { Select } from '@aiostreams/ui/select';
import { Switch } from '@aiostreams/ui/switch';
import { TextInput } from '@aiostreams/ui/text-input';
import { Textarea } from '@aiostreams/ui/textarea';
import { Button } from '@aiostreams/ui/button';
import { formatBytes } from '@aiostreams/ui/core/format';
import { currentHost } from '@/lib/hosts';
import {
  shellHost,
  chooseExternalPlayer,
  useExternalPlayers,
} from '@/lib/hosts/shell';
import {
  openMpvConfig,
  restartApp,
  useVideoOutput,
} from '@/lib/hosts/shell/desktop';
import {
  addMpvShader,
  readMpvConfig,
  readMpvShaders,
  removeMpvShader,
  saveMpvConfig,
} from '@/lib/hosts/shell/android';
import { appBridge, type VideoOutput } from '@/lib/hosts/shell/bridge';
import {
  CUSTOM_LINK,
  LAUNCHED_PLAYERS,
  canPlayWithWebGpu,
  linkPreset,
  canUpscale,
  playerOptions,
} from '@/lib/playback/player-choice';
import { addShader, removeShader, shaderNames } from '@/lib/playback/shaders';
import { canPickPipWindow } from '@/lib/playback/document-pip';
import {
  settings,
  useSetting,
  HOLD_RATES,
  SEEK_STEPS,
  VOLUME_STEPS,
  CACHE_SIZES,
  type CacheSize,
  type PlayerBack,
  type PlayerEngine,
  type PipWindow,
} from '@/lib/settings';
import { useSession } from '@/lib/jellyfin/session';
import { mayConvert, qualityOptions } from '@/lib/playback/quality';
import { canMinimise } from '@/lib/playback/session';
import { SettingsCard, SettingsRow } from './_components/settings-card';
import { GestureSettings } from './_components/gesture-settings';
import { onDevice, seconds, ShaderFilesRow } from './_components/common';

const builtIn = (player: string) =>
  !LAUNCHED_PLAYERS.some((p) => p.id === player) &&
  !linkPreset(player) &&
  player !== CUSTOM_LINK;

export function PlayerSection() {
  const host = currentHost();
  const android = host.name === 'android-app';
  const [engine] = useSetting(settings.player.engine);
  return (
    <>
      {!host.play && <PlayerCard />}
      {android && <LeavingCard />}
      <ControlsCard />
      <VideoCard />
      {host.name === 'desktop' && (
        <SettingsCard name="mpv" title="mpv">
          <SettingsRow
            label={t`mpv configuration`}
            help={t`mpv.conf, input.conf, scripts and shaders in this folder apply to the built-in mpv.`}
          >
            <Button
              intent="gray-outline"
              className="w-full rounded-full sm:w-auto"
              onClick={openMpvConfig}
            >
              <Trans>Open folder</Trans>
            </Button>
          </SettingsRow>
        </SettingsCard>
      )}
      {android && engine !== 'exoplayer' && <MpvConfigCard />}
    </>
  );
}

const backOptions = (): { value: PlayerBack; label: string }[] => [
  { value: 'stop', label: t`Stops playing` },
  { value: 'minimise', label: t`Opens the mini player` },
];

const pipOptions = (): { value: PipWindow; label: string }[] => [
  { value: 'player', label: t`Player window` },
  { value: 'video', label: t`Video only` },
];

const pipHelp = (window: PipWindow) =>
  ({
    player: t`A small window with the player in it: subtitles, controls and the seek bar. The browser adds a bar of its own at the top.`,
    video: t`This browser's own window of the video alone, without that bar, but with no subtitles and only the browser's play and pause.`,
  })[window];

const engineOptions = (): { value: PlayerEngine; label: string }[] => [
  { value: 'auto', label: t`Automatic` },
  { value: 'exoplayer', label: 'ExoPlayer' },
  { value: 'mpv', label: 'mpv' },
];

const browserEngineOptions = (): { value: PlayerEngine; label: string }[] => [
  { value: 'webgpu', label: 'WebGPU' },
  { value: 'browser', label: t`This browser` },
];

const engineHelp = (engine: PlayerEngine) =>
  ({
    auto: t`ExoPlayer, which uses less battery, and mpv for a video this device has no decoder for.`,
    mpv: t`Decodes nearly any video, in software where the device has no decoder for it. Takes your mpv.conf, under mpv below.`,
    exoplayer: t`Android's own player, which uses less battery: the screen shows the video as the device decodes it, at the video's frame rate. Plays video the device can decode. Styled subtitles look as they do in mpv.`,
    webgpu: t`Reads and decodes the file itself and draws it on the graphics card, so it also plays formats this browser can't, such as HEVC, Dolby Vision, AC-3, E-AC-3, TrueHD and DTS. A version it can't play goes to this browser's own player.`,
    browser: t`This browser's own player, which plays the formats this browser supports.`,
  })[engine];

const cacheOptions = () =>
  CACHE_SIZES.map((size) => ({
    value: size,
    label: size === 'auto' ? t`Automatic` : formatBytes(Number(size) * 1e6),
  }));

// What the player link takes, written the same in every language.
const LINK_TOKENS = {
  url: '{url}',
  encodedUrl: '{encodedUrl}',
  scheme: '{scheme}',
  filename: '{filename}',
  subtitles: '{subtitles}',
  title: '{title}',
  position: '{position}',
  positionMs: '{positionMs}',
  returnUrl: '{returnUrl}',
};

function PlayerCard() {
  const [player, setPlayer] = useSetting(settings.player.choice);
  const [link, setLink] = useSetting(settings.player.link);
  const [engine, setEngine] = useSetting(settings.player.engine);
  const browserEngine = engine === 'browser' ? engine : 'webgpu';
  const [cacheSize, setCacheSize] = useSetting(settings.player.cacheSize);
  const [back, setBack] = useSetting(settings.player.back);
  const [pipWindow, setPipWindow] = useSetting(
    settings.player.pictureInPicture
  );
  const [quality, setQuality] = useSetting(settings.player.quality);
  const { user } = useSession();
  const found = useExternalPlayers();
  const launched = LAUNCHED_PLAYERS.find((p) => p.id === player);
  const preset = linkPreset(player);
  const own = builtIn(player);
  const program = found?.find((p) => p.id === player)?.path;
  const name = launched?.name ?? '';
  const target = preset ? (preset.target ?? preset.name) : '';
  let help: React.ReactNode;
  if (launched)
    help = (
      <Trans>
        The {name} installed on this computer, in a window of its own with its
        own controls and configuration. This app still saves your place, marks
        what you watched and plays the next episode. Compared with the built-in
        player, you lose:
        <ul className="mt-1 list-disc ps-5">
          <li>
            The controls, skip buttons and next episode card over the video.
            They stay in this window, which works as a remote.
          </li>
          <li>
            This app&apos;s subtitle style, video fit, hardware decoding and
            audio output settings.
          </li>
        </ul>
      </Trans>
    );
  else if (preset)
    help =
      preset.template.includes('{returnUrl}') &&
      (!preset.template.startsWith('intent:') ||
        currentHost().name === 'android-app')
        ? t`Opens versions in ${target}, which brings you back here with your place saved.`
        : t`Opens versions in ${target}. It can't tell this app where you stopped, so you mark what you watched yourself.`;
  else if (player !== CUSTOM_LINK)
    help =
      currentHost().name === 'desktop'
        ? t`mpv inside this window, with this app's controls and playback settings. Your own mpv.conf, scripts and shaders work here too: put them in its mpv folder, under mpv below.`
        : currentHost().name === 'android-app'
          ? t`Versions play in the app, with its controls and playback settings. Choose another player to open them in it instead.`
          : t`Versions play in this browser. Choose another player to open them in it instead.`;
  const {
    url,
    encodedUrl,
    scheme,
    filename,
    subtitles,
    title,
    position,
    positionMs,
    returnUrl,
  } = LINK_TOKENS;
  return (
    <SettingsCard name="player" title={t`Player`} description={onDevice()}>
      <Select
        label={t`Play versions in`}
        help={help}
        options={playerOptions(found?.map((p) => p.id) ?? [])}
        value={player}
        onValueChange={setPlayer}
      />
      {launched && (
        <SettingsRow
          label={t`Your ${name}`}
          help={
            <span className="[overflow-wrap:anywhere]">
              {program ??
                t`Not found on this computer. Choose where ${name} is installed.`}
            </span>
          }
        >
          <Button
            intent="gray-outline"
            className="w-full rounded-full sm:w-auto"
            onClick={() => chooseExternalPlayer(launched.id)}
          >
            <Trans>Choose</Trans>
          </Button>
        </SettingsRow>
      )}
      {player === CUSTOM_LINK && (
        <TextInput
          label={t`Player link`}
          placeholder="vlc://{url}"
          value={link}
          onValueChange={setLink}
          help={t({
            comment: 'Each {name} is written in the player link as it is here.',
            message: `${url} is the stream address, ${encodedUrl} the same address URL-encoded, ${scheme} its scheme, ${filename} the file's name, ${subtitles} each external subtitle (its parameter repeats per file), ${title} the title with the episode, ${position} the second to start at (${positionMs} in milliseconds), and ${returnUrl} a link back here for a player that reports where it stopped. Values other than ${url} are URL-encoded. After intent://, ${url} goes without its scheme.`,
          })}
        />
      )}
      {!currentHost().player && canPlayWithWebGpu() && own && (
        <Select
          label={t`Engine`}
          help={engineHelp(browserEngine)}
          options={browserEngineOptions()}
          value={browserEngine}
          onValueChange={(v) => setEngine(v as PlayerEngine)}
        />
      )}
      {currentHost().name === 'android-app' && own && (
        <Select
          label={t`Engine`}
          help={engineHelp(engine)}
          options={engineOptions()}
          value={engine}
          onValueChange={(v) => setEngine(v as PlayerEngine)}
        />
      )}
      {mayConvert(user) && own && (
        <Select
          label={t`Quality`}
          help={t`The most a version may stream at. Above it, the server converts it down, which helps on a slow connection. Original plays every version as it is. The player's own quality menu changes this too.`}
          options={qualityOptions().map(({ id, label }) => ({
            value: id,
            label,
          }))}
          value={String(quality)}
          onValueChange={(v) => setQuality(Number(v))}
        />
      )}
      {shellHost() && own && (
        <Select
          label={t`Cache size`}
          help={t`How much of the video the player holds in memory: ahead, to ride out a slow connection, and behind, to seek back at once. Automatic sizes it from this device's memory.`}
          options={cacheOptions()}
          value={cacheSize}
          onValueChange={(v) => setCacheSize(v as CacheSize)}
        />
      )}
      {canMinimise() && own && (
        <Select
          label={t`Back in the player`}
          help={t`The mini player keeps the video going over the pages while you look around. Tap it to open the player again, or close it with its cross.`}
          options={backOptions()}
          value={back}
          onValueChange={(v) => setBack(v as PlayerBack)}
        />
      )}
      {!currentHost().player &&
        !currentHost().tv &&
        canPickPipWindow() &&
        own && (
          <Select
            label={t`Picture-in-picture`}
            help={pipHelp(pipWindow)}
            options={pipOptions()}
            value={pipWindow}
            onValueChange={(v) => setPipWindow(v as PipWindow)}
          />
        )}
    </SettingsCard>
  );
}

function LeavingCard() {
  const [pip, setPip] = useSetting(settings.app.pip);
  const [background, setBackground] = useSetting(settings.app.background);
  const canPip = appBridge()?.pip !== false;
  return (
    <SettingsCard
      name="leaving-the-app"
      title={t`Leaving the app`}
      description={onDevice()}
    >
      {canPip && (
        <Switch
          side="right"
          label={t`Picture-in-picture`}
          help={t`Keeps the video playing in a small window when you leave the app.`}
          value={pip}
          onValueChange={setPip}
        />
      )}
      <Switch
        side="right"
        label={t`Play in the background`}
        help={
          canPip
            ? t`Keeps the sound going with the screen off, or when you leave without picture-in-picture.`
            : t`Keeps the sound going with the screen off, or when you leave the app.`
        }
        value={background}
        onValueChange={setBackground}
      />
    </SettingsCard>
  );
}

function ControlsCard() {
  const [seekStep, setSeekStep] = useSetting(settings.controls.seekStep);
  const [volumeStep, setVolumeStep] = useSetting(settings.controls.volumeStep);
  const [holdRate, setHoldRate] = useSetting(settings.controls.holdRate);
  const [thumbnails, setThumbnails] = useSetting(settings.controls.thumbnails);
  const [clock, setClock] = useSetting(settings.controls.clock);
  const [showOnPauseAndSkip, setShowOnPauseAndSkip] = useSetting(
    settings.controls.showOnPauseAndSkip
  );
  return (
    <SettingsCard name="controls" title={t`Controls`} description={onDevice()}>
      <Select
        label={t`Skip length`}
        help={t`How far the skip buttons, double taps and the arrow keys jump.`}
        options={SEEK_STEPS.map((s) => ({
          value: String(s),
          label: seconds(s),
        }))}
        value={String(seekStep)}
        onValueChange={(v) => setSeekStep(Number(v))}
      />
      {!currentHost().tv && (
        <Select
          label={t`Volume step`}
          help={t`How much the volume keys and the scroll wheel change the volume.`}
          options={VOLUME_STEPS.map((s) => ({
            value: String(s),
            label: t`${s}%`,
          }))}
          value={String(volumeStep)}
          onValueChange={(v) => setVolumeStep(Number(v))}
        />
      )}
      <Select
        label={t`Held speed`}
        help={t`How fast playback runs while you press and hold the video, or hold Space or Select.`}
        options={HOLD_RATES.map((r) => ({
          value: String(r),
          label: t`${r}×`,
        }))}
        value={String(holdRate)}
        onValueChange={(v) => setHoldRate(Number(v))}
      />
      {!currentHost().tv && <GestureSettings />}
      <Switch
        side="right"
        label={t`Show the controls on pause and skip`}
        help={t`Pausing, playing or skipping with a remote or the keyboard brings the controls up, for a moment after a skip. Turned off, only a brief icon shows.`}
        value={showOnPauseAndSkip}
        onValueChange={setShowOnPauseAndSkip}
      />
      <Switch
        side="right"
        label={t`Show the time`}
        help={t`Shows the time of day at the top of the player with the controls.`}
        value={clock}
        onValueChange={setClock}
      />
      <Switch
        side="right"
        label={t`Seek bar previews`}
        help={t`Shows a picture of the video where you point, drag or skip to on the seek bar. Each one loads a little data, so turn them off to save it.`}
        value={thumbnails}
        onValueChange={setThumbnails}
      />
    </SettingsCard>
  );
}

function VideoCard() {
  const host = currentHost();
  const shell = !!shellHost();
  const android = host.name === 'android-app';
  const androidTv = android && !!host.tv;
  const [player] = useSetting(settings.player.choice);
  const [engine] = useSetting(settings.player.engine);
  const [hardwareDecoding, setHardwareDecoding] = useSetting(
    settings.video.hardwareDecoding
  );
  const [dolbyVision, setDolbyVision] = useSetting(settings.video.dolbyVision);
  const [upscaling, setUpscaling] = useSetting(settings.video.upscaling);
  const [hdrOutput, setHdrOutput] = useSetting(settings.video.hdrOutput);
  const [frameRate, setFrameRate] = useSetting(settings.video.frameRate);
  const [tunneling, setTunneling] = useSetting(settings.video.tunneling);
  const [gpuSubtitles, setGpuSubtitles] = useSetting(
    settings.video.gpuSubtitles
  );
  // ExoPlayer decodes with the hardware it picks itself; `auto` may still use mpv.
  const decoding = shell && !(android && engine === 'exoplayer');
  const webGpu =
    !host.player &&
    canPlayWithWebGpu() &&
    builtIn(player) &&
    engine !== 'browser';
  if (!shell && !webGpu) return null;
  return (
    <SettingsCard name="video" title={t`Video`} description={onDevice()}>
      {decoding && (
        <Switch
          side="right"
          label={t`Hardware decoding`}
          help={t`Decodes on the graphics card. Turn it off if video shows artefacts or stays black.`}
          value={hardwareDecoding}
          onValueChange={setHardwareDecoding}
        />
      )}
      {shell && (
        <Switch
          side="right"
          label={t`Dolby Vision`}
          help={t`Plays Dolby Vision where the screen shows it. Turn it off to play the HDR10 picture most of these videos also carry, if Dolby Vision looks dim or flickers. Videos with no HDR10 picture still play in Dolby Vision.`}
          value={dolbyVision}
          onValueChange={setDolbyVision}
        />
      )}
      {(shell ? canUpscale() : webGpu) && (
        <Switch
          side="right"
          label={t`Anime upscaling`}
          help={t`Sharpens the lines and cleans up the compression in anime as it plays, most of all in older and lower-resolution shows. It applies to titles marked as anime. With a keyboard, U in the player switches it for what's playing. Uses more power, and turns itself off for a video this device can't keep up with. HDR videos, and videos about as large as the screen, stay as they are.`}
          value={upscaling}
          onValueChange={setUpscaling}
        />
      )}
      {webGpu && (
        <Switch
          side="right"
          label={t`HDR output`}
          help={t`Shows HDR video in HDR on a screen that can show it, instead of converting it to SDR. Leave it off on a screen without HDR.`}
          value={hdrOutput}
          onValueChange={setHdrOutput}
        />
      )}
      {webGpu && (
        <ShaderFilesRow
          help={t`Shader files (.wgsl) for the WebGPU engine, applied in name order to what plays. They stay in this browser. Heavy ones can make video stutter.`}
          accept=".wgsl"
          read={shaderNames}
          add={addShader}
          remove={removeShader}
        />
      )}
      {androidTv && (
        <Switch
          side="right"
          label={t`Match the video's frame rate`}
          help={t`Switches the TV to a refresh rate that suits each video, so motion plays smoothly, and back when you stop. The screen goes blank for a moment as it switches.`}
          value={frameRate}
          onValueChange={setFrameRate}
        />
      )}
      {androidTv && engine !== 'mpv' && (
        <Switch
          side="right"
          label={t`Tunneled playback`}
          help={
            engine === 'auto'
              ? t`Lets the TV's decoder keep picture and sound in step itself, which plays 4K and HDR more smoothly on some TVs. Only for videos ExoPlayer plays. Turn it off if video stutters or stays black.`
              : t`Lets the TV's decoder keep picture and sound in step itself, which plays 4K and HDR more smoothly on some TVs. Turn it off if video stutters or stays black.`
          }
          value={tunneling}
          onValueChange={setTunneling}
        />
      )}
      {android && engine !== 'mpv' && (
        <Switch
          side="right"
          label={t`Draw subtitles on the graphics card`}
          help={
            engine === 'auto'
              ? t`Blends subtitles on the graphics card instead of the processor, which takes less processor time. Only for videos ExoPlayer plays. Turn it off if subtitles look wrong.`
              : t`Blends subtitles on the graphics card instead of the processor, which takes less processor time. Turn it off if subtitles look wrong.`
          }
          value={gpuSubtitles}
          onValueChange={setGpuSubtitles}
        />
      )}
      {host.name === 'desktop' && <VideoOutputRows />}
    </SettingsCard>
  );
}

const videoOutputs = (output: VideoOutput): { label: string; help: string } =>
  ({
    mpv: {
      label: 'mpv',
      help: t`mpv draws the video, with your mpv.conf and shaders.`,
    },
    system: {
      label: t`System`,
      help: t`macOS draws the video, using less power, and shows Dolby Vision itself. Shaders and mpv's picture options do not apply.`,
    },
    compatibility: {
      label: t`Compatibility`,
      help: t`The older way mpv draws, for Macs where the others fail. Some Dolby Vision videos show the wrong colours.`,
    },
  })[output];

function VideoOutputRows() {
  const [state, choose] = useVideoOutput();
  if (!state?.outputs.length) return null;
  return (
    <>
      <Select
        label={t`Video output`}
        help={videoOutputs(state.chosen).help}
        options={state.outputs.map((value) => ({
          value,
          label: videoOutputs(value).label,
        }))}
        value={state.chosen}
        onValueChange={(v) => choose(v as VideoOutput)}
      />
      {state.chosen !== state.running && (
        <SettingsRow
          label={t`Restart to switch`}
          help={t`The video output changes when the app opens again.`}
        >
          <Button
            intent="white"
            className="w-full rounded-full sm:w-auto"
            onClick={restartApp}
          >
            <Trans>Restart</Trans>
          </Button>
        </SettingsRow>
      )}
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
    <SettingsCard name="mpv" title="mpv">
      <Textarea
        label="mpv.conf"
        help={t`Options for the built-in mpv, one per line, as mpv's manual lists them.`}
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
              () => toast.success(t`Saved`),
              (e: Error) => toast.error(e.message)
            )
            .finally(() => setSaving(false));
        }}
      >
        <Trans>Save</Trans>
      </Button>
      <ShaderFilesRow
        help={t`GLSL shader files for the built-in mpv, applied in name order to what plays. Heavy ones can make video stutter.`}
        accept=".glsl,.hook"
        read={readMpvShaders}
        add={addMpvShader}
        remove={removeMpvShader}
      />
    </SettingsCard>
  );
}
