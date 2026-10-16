import React from 'react';
import { Select } from '@aiostreams/ui/select';
import { Switch } from '@aiostreams/ui/switch';
import { TextInput } from '@aiostreams/ui/text-input';
import { Button } from '@aiostreams/ui/button';
import { currentHost } from '../../lib/hosts';
import {
  shellHost,
  chooseExternalPlayer,
  useExternalPlayers,
} from '../../lib/hosts/shell';
import { usePlaybackPrefs } from '../../lib/user-config';
import {
  CUSTOM_LINK,
  LAUNCHED_PLAYERS,
  linkPreset,
  playerOptions,
} from '../../lib/playback/player-choice';
import {
  settings,
  useSetting,
  NEXT_COUNTDOWNS,
  NEXT_LEADS,
  STILL_WATCHING_AFTER,
  HOLD_RATES,
  SEEK_STEPS,
  VOLUME_STEPS,
  SEGMENT_ACTIONS,
  SEGMENT_TYPES,
  type PlayerEngine,
  type NextPrompt,
  type SegmentAction,
  type SegmentType,
} from '../../lib/settings';
import { useFeature } from '../../lib/server-info';
import { SettingsCard, SettingsRow } from '../../components/settings-card';
import { ON_DEVICE, FOLLOWS_YOU } from './common';

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
  const [action, setAction] = useSetting(settings.playback.segment[type]);
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

export function PlaybackSection() {
  const { prefs, update } = usePlaybackPrefs();
  const [seekStep, setSeekStep] = useSetting(settings.controls.seekStep);
  const [volumeStep, setVolumeStep] = useSetting(settings.controls.volumeStep);
  const [holdRate, setHoldRate] = useSetting(settings.controls.holdRate);
  const [autoPlay, setAutoPlay] = useSetting(settings.playback.autoPlayFirst);
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
  const parties = useFeature('parties');
  const [partyMessages, setPartyMessages] = useSetting(settings.party.messages);
  const [partyReactions, setPartyReactions] = useSetting(
    settings.party.reactions
  );
  const autoplay = prefs.EnableNextEpisodeAutoPlay !== false;
  const [hardwareDecoding, setHardwareDecoding] = useSetting(
    settings.video.hardwareDecoding
  );
  const [chapterSkips, setChapterSkips] = useSetting(
    settings.playback.chapterSkips
  );
  const [dolbyVision, setDolbyVision] = useSetting(settings.video.dolbyVision);
  const bingeGroups = useFeature('versions');
  const shell = !!shellHost();
  const [engine] = useSetting(settings.player.engine);
  const [frameRate, setFrameRate] = useSetting(settings.video.frameRate);
  const [tunneling, setTunneling] = useSetting(settings.video.tunneling);
  const androidTv = currentHost().name === 'android-app' && !!currentHost().tv;
  // ExoPlayer decodes with the hardware it picks itself; `auto` may still use mpv.
  const decoding =
    shell && !(currentHost().name === 'android-app' && engine === 'exoplayer');

  return (
    <>
      <SettingsCard title="Versions" description={FOLLOWS_YOU}>
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
      <SettingsCard title="Next episode" description={FOLLOWS_YOU}>
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
      <SettingsCard title="Skipping" description={FOLLOWS_YOU}>
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
      {parties && (
        <SettingsCard title="Watch parties" description={FOLLOWS_YOU}>
          <Switch
            side="right"
            label="Show messages over the video"
            help="What the people you watch with say shows for a few seconds. It always stays in the party's chat."
            value={partyMessages}
            onValueChange={setPartyMessages}
          />
          <Switch
            side="right"
            label="Show reactions over the video"
            value={partyReactions}
            onValueChange={setPartyReactions}
          />
        </SettingsCard>
      )}
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
        {!currentHost().tv && (
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
        )}
        <Select
          label="Held speed"
          help="How fast playback runs while you press and hold the video, or hold Space or Select."
          options={HOLD_RATES.map((r) => ({
            value: String(r),
            label: `${r}×`,
          }))}
          value={String(holdRate)}
          onValueChange={(v) => setHoldRate(Number(v))}
        />
      </SettingsCard>
      {shell && (
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
          <Switch
            side="right"
            label="Dolby Vision"
            help="Plays Dolby Vision where the screen shows it. Turn it off to play the HDR10 picture most of these videos also carry, if Dolby Vision looks dim or flickers. Videos with no HDR10 picture still play in Dolby Vision."
            value={dolbyVision}
            onValueChange={setDolbyVision}
          />
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
  { value: 'exoplayer', label: 'ExoPlayer' },
  { value: 'mpv', label: 'mpv' },
];

const ENGINE_HELP: Record<PlayerEngine, string> = {
  auto: 'ExoPlayer, which uses less battery, and mpv for a video this device has no decoder for.',
  mpv: 'Decodes nearly any video, in software where the device has no decoder for it. Takes your mpv.conf under Android app.',
  exoplayer:
    "Android's own player, which uses less battery: the screen shows the video as the device decodes it, at the video's frame rate. Plays video the device can decode. Styled subtitles look as they do in mpv.",
};

function PlayerCard() {
  const [player, setPlayer] = useSetting(settings.player.choice);
  const [link, setLink] = useSetting(settings.player.link);
  const [engine, setEngine] = useSetting(settings.player.engine);
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
