import React from 'react';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Select } from '@aiostreams/ui/select';
import { Switch } from '@aiostreams/ui/switch';
import { TextInput } from '@aiostreams/ui/text-input';
import { Button } from '@aiostreams/ui/button';
import { formatBytes } from '@aiostreams/ui/core/format';
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
  CACHE_SIZES,
  type CacheSize,
  type PlayerEngine,
  type NextPrompt,
  type SegmentAction,
  type SegmentType,
} from '../../lib/settings';
import { useFeature } from '../../lib/server-info';
import { SettingsCard, SettingsRow } from '../../components/settings-card';
import { BadgesRow, QuickFiltersRow } from '../../components/version-settings';
import { onDevice, followsYou } from './common';

const nextPromptHelp = (prompt: NextPrompt) =>
  ({
    credits: t`When the credits start, if they run to the end; otherwise a set time before the end.`,
    end: t`A set time before the end.`,
    off: t`Episodes end without offering the next one.`,
  })[prompt];

const segmentLabel = (type: SegmentType) =>
  ({
    Intro: t`Intros`,
    Recap: t`Recaps`,
    Outro: t`Credits`,
    Preview: t`Previews`,
    Commercial: t`Ads`,
  })[type];

const segmentActionLabel = (action: SegmentAction) =>
  ({
    ask: t`Show a skip button`,
    skip: t`Skip automatically`,
    none: t`Do nothing`,
  })[action];

const seconds = (count: number) =>
  plural(count, { one: '# second', other: '# seconds' });

const minutes = (count: number) =>
  plural(count, { one: '# minute', other: '# minutes' });

function SegmentActionSelect({ type }: { type: SegmentType }) {
  const [action, setAction] = useSetting(settings.playback.segment[type]);
  return (
    <Select
      label={segmentLabel(type)}
      help={
        type === 'Outro' && action === 'skip'
          ? t`Credits that end an episode are left to the next episode prompt when it shows.`
          : undefined
      }
      options={SEGMENT_ACTIONS.map((a) => ({
        value: a,
        label: segmentActionLabel(a),
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
      <SettingsCard
        name="versions"
        title={t`Versions`}
        description={followsYou()}
      >
        <Switch
          side="right"
          label={t`Auto-play the first version`}
          help={
            autoPlay
              ? t`Play starts the first version, and resuming goes back to the version you were watching. Hold Play to choose instead.`
              : t`Play lists the versions to choose from, but resuming goes back to the version you were watching. Hold Play to do the other: start the first version, or list them when resuming.`
          }
          value={autoPlay}
          onValueChange={setAutoPlay}
        />
        <QuickFiltersRow />
        <BadgesRow />
      </SettingsCard>
      <SettingsCard
        name="next-episode"
        title={t`Next episode`}
        description={followsYou()}
      >
        <Switch
          side="right"
          label={t`Play it automatically`}
          help={
            bingeGroups
              ? t`Counts down, then plays the next episode in the same kind of version. Off, the prompt waits for you.`
              : t`Counts down, then plays the next episode. Off, the prompt waits for you.`
          }
          value={autoplay}
          onValueChange={(v) => update({ EnableNextEpisodeAutoPlay: v })}
        />
        <Switch
          side="right"
          label={
            bingeGroups
              ? t`Play the first version when none matches`
              : t`Play the first version`
          }
          help={
            bingeGroups
              ? t`Otherwise the next episode's version list opens when none is like the one you watched.`
              : t`Otherwise the next episode's version list opens when it has more than one.`
          }
          value={nextFallbackFirst}
          onValueChange={setNextFallbackFirst}
        />
        <Select
          label={t`Show the prompt`}
          help={nextPromptHelp(nextPrompt)}
          options={[
            { value: 'credits', label: t`When the credits start` },
            { value: 'end', label: t`Before the end` },
            { value: 'off', label: t`Never` },
          ]}
          value={nextPrompt}
          onValueChange={(v) => setNextPrompt(v as NextPrompt)}
        />
        {nextPrompt !== 'off' && (
          <Select
            label={t`Before the end`}
            help={
              nextPrompt === 'credits'
                ? t`Used when an episode has no credits marked.`
                : undefined
            }
            options={NEXT_LEADS.map((s) => ({
              value: String(s),
              label: s < 60 ? seconds(s) : minutes(s / 60),
            }))}
            value={String(nextLead)}
            onValueChange={(v) => setNextLead(Number(v))}
          />
        )}
        {nextPrompt !== 'off' && (
          <Select
            label={t`Countdown`}
            options={NEXT_COUNTDOWNS.map((s) => ({
              value: String(s),
              label: seconds(s),
            }))}
            value={String(nextCountdown)}
            onValueChange={(v) => setNextCountdown(Number(v))}
          />
        )}
        {marked && (
          <Switch
            side="right"
            label={t`Skip filler episodes`}
            help={t`Playing on and the next and previous buttons pass over episodes marked as filler. You can still play one yourself.`}
            value={skipFillers}
            onValueChange={setSkipFillers}
          />
        )}
        {marked && (
          <Switch
            side="right"
            label={t`Skip recap episodes`}
            help={t`The same for episodes marked as a recap.`}
            value={skipRecaps}
            onValueChange={setSkipRecaps}
          />
        )}
        {autoplay && (
          <Select
            label={t`Ask if you are still watching`}
            help={t`Pauses and asks before the next episode once this many have played in a row without a key, click or button press.`}
            options={STILL_WATCHING_AFTER.map((n) => ({
              value: String(n),
              label: n
                ? plural(n, {
                    one: 'After # episode',
                    other: 'After # episodes',
                  })
                : t`Never`,
            }))}
            value={String(stillWatching)}
            onValueChange={(v) => setStillWatching(Number(v))}
          />
        )}
      </SettingsCard>
      <SettingsCard
        name="skipping"
        title={t`Skipping`}
        description={followsYou()}
      >
        {SEGMENT_TYPES.map((type) => (
          <SegmentActionSelect key={type} type={type} />
        ))}
        {shell && (
          <Switch
            side="right"
            label={t`Skip by the file's chapters`}
            help={t`Where a file names its intro, credits, recap or preview chapters, skipping uses them instead of the server's times, since they fit that exact file. The rest still come from the server.`}
            value={chapterSkips}
            onValueChange={setChapterSkips}
          />
        )}
      </SettingsCard>
      {parties && (
        <SettingsCard
          name="watch-parties"
          title={t`Watch parties`}
          description={followsYou()}
        >
          <Switch
            side="right"
            label={t`Show messages over the video`}
            help={t`What the people you watch with say shows for a few seconds. It always stays in the party's chat.`}
            value={partyMessages}
            onValueChange={setPartyMessages}
          />
          <Switch
            side="right"
            label={t`Show reactions over the video`}
            value={partyReactions}
            onValueChange={setPartyReactions}
          />
        </SettingsCard>
      )}
      <SettingsCard
        name="controls"
        title={t`Controls`}
        description={onDevice()}
      >
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
      </SettingsCard>
      {shell && (
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
          <Switch
            side="right"
            label={t`Dolby Vision`}
            help={t`Plays Dolby Vision where the screen shows it. Turn it off to play the HDR10 picture most of these videos also carry, if Dolby Vision looks dim or flickers. Videos with no HDR10 picture still play in Dolby Vision.`}
            value={dolbyVision}
            onValueChange={setDolbyVision}
          />
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
        </SettingsCard>
      )}
      {!currentHost().play && <PlayerCard />}
    </>
  );
}

const engineOptions = (): { value: PlayerEngine; label: string }[] => [
  { value: 'auto', label: t`Automatic` },
  { value: 'exoplayer', label: 'ExoPlayer' },
  { value: 'mpv', label: 'mpv' },
];

const engineHelp = (engine: PlayerEngine) =>
  ({
    auto: t`ExoPlayer, which uses less battery, and mpv for a video this device has no decoder for.`,
    mpv: t`Decodes nearly any video, in software where the device has no decoder for it. Takes your mpv.conf under Android app.`,
    exoplayer: t`Android's own player, which uses less battery: the screen shows the video as the device decodes it, at the video's frame rate. Plays video the device can decode. Styled subtitles look as they do in mpv.`,
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
  const [cacheSize, setCacheSize] = useSetting(settings.player.cacheSize);
  const found = useExternalPlayers();
  const launched = LAUNCHED_PLAYERS.find((p) => p.id === player);
  const preset = linkPreset(player);
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
        ? t`mpv inside this window, with this app's controls and playback settings. Your own mpv.conf, scripts and shaders work here too: put them in its mpv folder under Desktop app.`
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
      {currentHost().name === 'android-app' &&
        !launched &&
        !preset &&
        player !== CUSTOM_LINK && (
          <>
            <Select
              label={t`Engine`}
              help={engineHelp(engine)}
              options={engineOptions()}
              value={engine}
              onValueChange={(v) => setEngine(v as PlayerEngine)}
            />
            <Select
              label={t`Cache size`}
              help={t`How much of the video the player holds in memory: ahead, to ride out a slow connection, and behind, to seek back at once. Automatic sizes it from this device's memory.`}
              options={cacheOptions()}
              value={cacheSize}
              onValueChange={(v) => setCacheSize(v as CacheSize)}
            />
          </>
        )}
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
    </SettingsCard>
  );
}
