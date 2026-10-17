import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Select } from '@aiostreams/ui/select';
import { Switch } from '@aiostreams/ui/switch';
import { Slider } from '@aiostreams/ui/slider';
import {
  subtitleCss,
  subtitleLine,
  subtitleSizeLabel,
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
import { ColorInput } from '@aiostreams/ui/color-input';
import { currentHost } from '../../lib/hosts';
import { SettingsCard } from '../../components/settings-card';
import { languageOptions, LanguageList, followsYou, onAccount } from './common';

const subtitleModes = (): {
  value: SubtitleMode;
  label: string;
  help: string;
}[] => [
  {
    value: 'Default',
    label: t`Default`,
    help: t`Subtitles the version marks as default or forced, in your language when it has them.`,
  },
  {
    value: 'Always',
    label: t`Always`,
    help: t`Always shows subtitles, in your language when the version has them.`,
  },
  {
    value: 'Smart',
    label: t`When the audio is not in my language`,
    help: t`Shows subtitles in your language unless the audio already is.`,
  },
  {
    value: 'OnlyForced',
    label: t`Only forced`,
    help: t`Only subtitles for foreign-language parts.`,
  },
  { value: 'None', label: t`Off`, help: t`Starts without subtitles.` },
];

const fontOptions = (): { value: SubtitleFont; label: string }[] => [
  { value: 'default', label: t`Default` },
  { value: 'sans-serif', label: t`Sans serif` },
  { value: 'serif', label: t`Serif` },
  { value: 'monospace', label: t`Monospace` },
  { value: 'serif-monospace', label: t`Typewriter` },
  { value: 'casual', label: t`Casual` },
  { value: 'cursive', label: t`Cursive` },
];

const subtitleTypeOptions = (): { value: SubtitleType; label: string }[] => [
  { value: 'normal', label: t`Full` },
  { value: 'sdh', label: t`SDH, with sounds described` },
  { value: 'forced', label: t`Forced, for foreign parts only` },
  { value: 'signs', label: t`Signs and songs` },
];

export function SubtitlesSection() {
  const { prefs, update } = usePlaybackPrefs();
  const mode: SubtitleMode = prefs.SubtitleMode ?? 'Default';
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
  const modes = subtitleModes();
  return (
    <>
      <SettingsCard
        name="language"
        title={t`Language`}
        description={onAccount()}
      >
        <LanguageList
          label={t`Subtitle languages`}
          help={t`Tried in order for the subtitles the setting below shows.`}
          options={languageOptions()}
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
          label={t`Subtitles`}
          help={modes.find((m) => m.value === mode)?.help}
          options={modes.map(({ value, label }) => ({ value, label }))}
          value={mode}
          onValueChange={(v) => update({ SubtitleMode: v as SubtitleMode })}
        />
        {Array.isArray(prefs.SubtitleTypes) && (
          <LanguageList
            label={t`Subtitle types`}
            help={t`When a version has more than one subtitle in your language, the first of these it has shows. Commentary comes last.`}
            options={subtitleTypeOptions()}
            value={subtitleTypes(prefs)}
            fixed
            onChange={(next) => update({ SubtitleTypes: next })}
          />
        )}
        {typeof prefs.ListPreferredSubtitlesOnly === 'boolean' && (
          <Switch
            side="right"
            label={t`List only my languages`}
            help={t`The player's subtitle menu lists subtitles in your languages, ones without a language and the one on. The rest wait under More languages.`}
            value={prefs.ListPreferredSubtitlesOnly}
            onValueChange={(v) => update({ ListPreferredSubtitlesOnly: v })}
          />
        )}
        <Switch
          side="right"
          label={t`Remember picks per show`}
          help={t`Subtitles you pick or turn off while watching a show stay that way for its other episodes. Picking what the settings above would show forgets it.`}
          value={prefs.RememberSubtitleSelections !== false}
          onValueChange={(v) => update({ RememberSubtitleSelections: v })}
        />
      </SettingsCard>
      <SettingsCard name="preview" title={t`Preview`}>
        <div className="relative aspect-[16/5] rounded-lg bg-gradient-to-br from-gray-700 to-gray-950">
          <span
            className="absolute left-1/2 w-max max-w-[90%] -translate-x-1/2 rounded px-2 py-0.5 text-center text-lg"
            style={{ ...css, bottom: `${100 - subtitleLine(style)}%` }}
          >
            <Trans>This is how subtitles will look.</Trans>
          </span>
        </div>
      </SettingsCard>
      <SettingsCard name="text" title={t`Text`} description={followsYou()}>
        <Select
          label={t`Size`}
          options={SUBTITLE_SIZES.map((value) => ({
            value,
            label: subtitleSizeLabel(value),
          }))}
          value={size}
          onValueChange={(v) => setSize(v as SubtitleSize)}
        />
        <Select
          label={t`Font`}
          options={fontOptions()}
          value={font}
          onValueChange={(v) => setFont(v as SubtitleFont)}
        />
        <ColorInput
          picker={!currentHost().tv}
          label={t`Colour`}
          value={textColor}
          onValueChange={setTextColor}
        />
        <Switch
          side="right"
          label={t`Bold`}
          value={bold}
          onValueChange={setBold}
        />
        <Slider
          label={t`Height: ${position}%`}
          help={t`How far subtitles sit above their usual place near the bottom.`}
          min={0}
          max={SUBTITLE_POSITION_MAX}
          step={1}
          value={[position]}
          onValueChange={([v]) => setPosition(v)}
        />
      </SettingsCard>
      <SettingsCard name="outline-and-shadow" title={t`Outline and shadow`}>
        <Select
          label={t`Width`}
          options={[
            { value: 'none', label: t`None` },
            { value: 'thin', label: t`Thin` },
            { value: 'normal', label: t`Normal` },
            { value: 'thick', label: t`Thick` },
          ]}
          value={outline}
          onValueChange={(v) => setOutline(v as SubtitleOutline)}
        />
        <Switch
          side="right"
          label={t`Shadow`}
          value={shadow}
          onValueChange={setShadow}
        />
        <ColorInput
          picker={!currentHost().tv}
          label={t`Colour`}
          value={outlineColor}
          onValueChange={setOutlineColor}
        />
      </SettingsCard>
      <SettingsCard name="background" title={t`Background`}>
        <ColorInput
          picker={!currentHost().tv}
          label={t`Colour`}
          value={backgroundColor}
          onValueChange={setBackgroundColor}
        />
        <Slider
          label={t`Opacity: ${backgroundOpacity}%`}
          help={t`At 0% there is no background.`}
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
          label={t`Apply to styled subtitles too`}
          help={t`Styled subtitles, common in anime, keep their own fonts and colours unless this is on. Blu-ray and DVD subtitles always keep their look and size. Only in the desktop app.`}
          value={overrideStyled}
          onValueChange={setOverrideStyled}
        />
      </SettingsCard>
    </>
  );
}
