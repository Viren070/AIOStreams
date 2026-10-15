import { Select } from '@aiostreams/ui/select';
import { Switch } from '@aiostreams/ui/switch';
import { Slider } from '@aiostreams/ui/slider';
import { ColorInput } from '@aiostreams/ui/color-input';
import {
  subtitleCss,
  subtitleLine,
  SUBTITLE_SIZE_LABELS,
} from '../../lib/subtitles/style';
import { subtitleTypes, type SubtitleType } from '../../lib/subtitles/tracks';
import {
  subtitleLanguages,
  usePlaybackPrefs,
  type SubtitleMode,
} from '../../lib/user-config';
import {
  settings,
  useSetting,
  SUBTITLE_POSITION_MAX,
  SUBTITLE_SIZES,
  type SubtitleFont,
  type SubtitleOutline,
  type SubtitleSize,
} from '../../lib/settings';
import { SettingsCard } from '../../components/settings-card';
import {
  LANGUAGE_OPTIONS,
  LanguageList,
  ON_DEVICE,
  ON_ACCOUNT,
} from './common';

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

const FONT_OPTIONS: { value: SubtitleFont; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'sans-serif', label: 'Sans serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Monospace' },
  { value: 'serif-monospace', label: 'Typewriter' },
  { value: 'casual', label: 'Casual' },
  { value: 'cursive', label: 'Cursive' },
];

const SUBTITLE_TYPE_OPTIONS: { value: SubtitleType; label: string }[] = [
  { value: 'normal', label: 'Full' },
  { value: 'sdh', label: 'SDH, with sounds described' },
  { value: 'forced', label: 'Forced, for foreign parts only' },
  { value: 'signs', label: 'Signs and songs' },
];

export function SubtitlesSection() {
  const { prefs, update } = usePlaybackPrefs();
  const mode = prefs.SubtitleMode ?? 'Default';
  const subtitleLists = Array.isArray(prefs.SubtitleLanguages);
  const [size, setSize] = useSetting(settings.subtitle.size);
  const [font, setFont] = useSetting(settings.subtitle.font);
  const [bold, setBold] = useSetting(settings.subtitle.bold);
  const [textColor, setTextColor] = useSetting(settings.subtitle.textColor);
  const [outline, setOutline] = useSetting(settings.subtitle.outline);
  const [outlineColor, setOutlineColor] = useSetting(
    settings.subtitle.outlineColor
  );
  const [shadow, setShadow] = useSetting(settings.subtitle.shadow);
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
  const [style] = useSetting(settings.subtitle.style);
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
        {Array.isArray(prefs.SubtitleTypes) && (
          <LanguageList
            label="Subtitle types"
            help="When a version has more than one subtitle in your language, the first of these it has shows. Commentary comes last."
            options={SUBTITLE_TYPE_OPTIONS}
            value={subtitleTypes(prefs)}
            fixed
            onChange={(next) => update({ SubtitleTypes: next })}
          />
        )}
        {typeof prefs.ListPreferredSubtitlesOnly === 'boolean' && (
          <Switch
            side="right"
            label="List only my languages"
            help="The player's subtitle menu lists subtitles in your languages, ones without a language and the one on. The rest wait under More languages."
            value={prefs.ListPreferredSubtitlesOnly}
            onValueChange={(v) => update({ ListPreferredSubtitlesOnly: v })}
          />
        )}
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
        <Select
          label="Font"
          options={FONT_OPTIONS}
          value={font}
          onValueChange={(v) => setFont(v as SubtitleFont)}
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
      <SettingsCard title="Outline and shadow">
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
        <Switch
          side="right"
          label="Shadow"
          value={shadow}
          onValueChange={setShadow}
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
