import { t } from '@lingui/core/macro';
import { Select } from '@aiostreams/ui/select';
import { Combobox } from '@aiostreams/ui/combobox';
import { Switch } from '@aiostreams/ui/switch';
import { Slider } from '@aiostreams/ui/slider';
import { currentHost } from '../../lib/hosts';
import { useShellInfo, shellHost } from '../../lib/hosts/shell';
import { useAudioDevices } from '../../lib/hosts/shell/desktop';
import { audioTypes, type AudioType } from '../../lib/playback/audio-tracks';
import {
  audioLanguages,
  ORIGINAL_LANGUAGE,
  usePlaybackPrefs,
} from '../../lib/user-config';
import { audioDelayLabel, dialogueLabel } from '../../lib/playback/sound';
import {
  settings,
  useSetting,
  AUDIO_CHANNELS,
  AUDIO_DELAY_LIMIT_MS,
  AUDIO_DELAY_STEP_MS,
  DIALOGUE_BOOSTS,
  PASSTHROUGH_FORMATS,
  type AudioChannels,
  type Passthrough,
  type PassthroughFormat,
} from '../../lib/settings';
import { SettingsCard } from '../../components/settings-card';
import { languageOptions, LanguageList, onDevice, onAccount } from './common';

const audioTypeOptions = (): { value: AudioType; label: string }[] => [
  { value: 'main', label: t`Main` },
  {
    value: 'description',
    label: t`Audio description, narrating what is on screen`,
  },
  { value: 'commentary', label: t`Commentary` },
];

const passthroughOptions = (): { value: Passthrough; label: string }[] => [
  { value: 'auto', label: t`When the TV or receiver decodes it` },
  { value: 'always', label: t`Always` },
  { value: 'off', label: t`Off` },
];

const passthroughHelp = (passthrough: Passthrough) =>
  ({
    auto: t`Sends Dolby and DTS audio as it is when your TV or receiver says it decodes them, which keeps Atmos. Otherwise this app decodes it.`,
    always: t`Sends Dolby and DTS audio as it is even when your TV or receiver does not say it decodes them, as some do without saying so.`,
    off: t`This app decodes Dolby and DTS audio itself, which loses Atmos.`,
  })[passthrough];

export function AudioSection() {
  const { prefs, update } = usePlaybackPrefs();
  const audio = audioLanguages(prefs);
  const audioLists = Array.isArray(prefs.AudioLanguages);
  return (
    <>
      <SettingsCard
        name="language"
        title={t`Language`}
        description={onAccount()}
      >
        <LanguageList
          label={t`Audio languages`}
          help={t`A version plays the first of these it has, otherwise its own default. Original language is the one the title was made in.`}
          options={[
            { value: ORIGINAL_LANGUAGE, label: t`Original language` },
            ...languageOptions(),
          ]}
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
            label={t`Play the version's default track first`}
            help={t`A track the version marks as its default plays even when another is in one of your languages. Turn this off for your languages to always win.`}
            value={prefs.PlayDefaultAudioTrack !== false}
            onValueChange={(v) => update({ PlayDefaultAudioTrack: v })}
          />
        )}
        {Array.isArray(prefs.AudioTypes) && (
          <LanguageList
            label={t`Audio types`}
            help={t`When a version has more than one kind of audio track, the first of these it has plays.`}
            options={audioTypeOptions()}
            value={audioTypes(prefs)}
            fixed
            onChange={(next) => update({ AudioTypes: next })}
          />
        )}
        <Switch
          side="right"
          label={t`Remember picks per show`}
          help={t`An audio track you pick while watching a show sets the language for its other episodes. Picking what the settings above would play forgets it.`}
          value={prefs.RememberAudioSelections !== false}
          onValueChange={(v) => update({ RememberAudioSelections: v })}
        />
      </SettingsCard>
      {shellHost() && (
        <>
          <OutputCard />
          <SoundCard />
        </>
      )}
    </>
  );
}

/* eslint-disable lingui/no-unlocalized-strings -- format names */
const FORMAT_LABELS: Record<PassthroughFormat, string> = {
  ac3: 'Dolby Digital',
  eac3: 'Dolby Digital Plus',
  dts: 'DTS',
  'dts-hd': 'DTS-HD',
  truehd: 'Dolby TrueHD',
};
/* eslint-enable lingui/no-unlocalized-strings */

function OutputCard() {
  const android = currentHost().name === 'android-app';
  const [audioChannels, setAudioChannels] = useSetting(settings.audio.channels);
  const [passthrough, setPassthrough] = useSetting(settings.audio.passthrough);
  const [formats, setFormats] = useSetting(settings.audio.passthroughFormats);
  const [ac3Encode, setAc3Encode] = useSetting(settings.audio.ac3Encode);
  const info = useShellInfo();
  const passing = passthrough !== 'off';
  return (
    <SettingsCard name="output" title={t`Output`} description={onDevice()}>
      {!android && <AudioDeviceSelect />}
      <Select
        label={t`Channels`}
        help={t`What your speakers or receiver take. Surround sound with more is mixed down, with its dialogue kept in.`}
        options={AUDIO_CHANNELS.map((c) => ({
          value: c,
          label: channelLabel(c),
        }))}
        value={audioChannels}
        onValueChange={(v) => setAudioChannels(v as AudioChannels)}
      />
      {android ? (
        <Select
          label={t`Pass surround audio through`}
          help={passthroughHelp(passthrough)}
          options={passthroughOptions()}
          value={passthrough}
          onValueChange={(v) => setPassthrough(v as Passthrough)}
        />
      ) : (
        <Switch
          side="right"
          label={t`Pass surround audio through`}
          help={t`Sends Dolby and DTS audio to your receiver as it is. Only turn this on if your receiver decodes them.`}
          value={passing}
          onValueChange={(on) => setPassthrough(on ? 'always' : 'off')}
        />
      )}
      {passing && (
        <Combobox
          multiple
          label={t`Formats`}
          help={t`Only the ones your TV or receiver decodes; this app decodes the rest. DTS-HD needs DTS too.`}
          placeholder={t`None`}
          emptyMessage={t`Nothing matches.`}
          options={PASSTHROUGH_FORMATS.map((f) => ({
            value: f,
            label: FORMAT_LABELS[f],
            textValue: FORMAT_LABELS[f],
          }))}
          value={PASSTHROUGH_FORMATS.filter((f) => formats[f])}
          onValueChange={(on) =>
            setFormats(
              Object.fromEntries(
                PASSTHROUGH_FORMATS.map((f) => [f, on.includes(f)])
              ) as Record<PassthroughFormat, boolean>
            )
          }
        />
      )}
      {passing && formats.ac3 && info?.ac3Encoder !== false && (
        <Switch
          side="right"
          label={t`Turn other surround sound into Dolby Digital`}
          help={t`For a receiver on an optical or ARC link, which gets other surround formats as stereo otherwise.`}
          value={ac3Encode}
          onValueChange={setAc3Encode}
        />
      )}
    </SettingsCard>
  );
}

function AudioDeviceSelect() {
  const [audioDevice, setAudioDevice] = useSetting(settings.audio.device);
  const devices = useAudioDevices();
  const options = (devices ?? []).map((d) => ({
    value: d.name,
    label: d.name === 'auto' ? t`System default` : d.description || d.name,
  }));
  // One unplugged now stays picked until another is.
  if (!options.some((o) => o.value === audioDevice))
    options.push({ value: audioDevice, label: audioDevice });
  return (
    <Select
      label={t`Device`}
      options={options}
      value={audioDevice}
      onValueChange={setAudioDevice}
    />
  );
}

function SoundCard() {
  const [boost, setBoost] = useSetting(settings.audio.dialogueBoost);
  const [nightMode, setNightMode] = useSetting(settings.audio.nightMode);
  const [delay, setDelay] = useSetting(settings.audio.delayMs);
  const delayLabel = audioDelayLabel(delay);
  return (
    <SettingsCard name="sound" title={t`Sound`} description={onDevice()}>
      <Select
        label={t`Dialogue boost`}
        help={t`Raises the centre channel, where surround sound puts dialogue. Not for sound passed through.`}
        options={DIALOGUE_BOOSTS.map((db) => ({
          value: String(db),
          label: dialogueLabel(db),
        }))}
        value={String(boost)}
        onValueChange={(v) => setBoost(Number(v))}
      />
      <Switch
        side="right"
        label={t`Night mode`}
        help={t`Evens out loud and quiet scenes, for listening at a low volume. Not for sound passed through.`}
        value={nightMode}
        onValueChange={setNightMode}
      />
      <Slider
        label={t`Delay: ${delayLabel}`}
        help={t`Below zero plays the sound earlier, as for wireless headphones that lag behind the picture.`}
        min={-AUDIO_DELAY_LIMIT_MS}
        max={AUDIO_DELAY_LIMIT_MS}
        step={AUDIO_DELAY_STEP_MS}
        value={[delay]}
        onValueChange={([v]) => setDelay(v)}
      />
    </SettingsCard>
  );
}

const channelLabel = (channels: AudioChannels) =>
  ({
    auto: t`Automatic`,
    stereo: t`Stereo`,
    '5.1': t`5.1 surround`,
    '7.1': t`7.1 surround`,
  })[channels];
