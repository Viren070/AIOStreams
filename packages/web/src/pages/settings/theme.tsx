import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { toast } from 'sonner';
import { ColorInput } from '@aiostreams/ui/color-input';
import { Textarea } from '@aiostreams/ui/textarea';
import {
  DEFAULT_ACCENT,
  DEFAULT_BACKGROUND,
  THEME_PRESETS,
} from '@aiostreams/ui/utils/palette';
import { Button } from '@aiostreams/ui/button';
import { Switch } from '@aiostreams/ui/switch';
import { cn } from '@aiostreams/ui/core/styling';
import {
  settings,
  useSetting,
  CUSTOM_CSS_OFF,
  MAX_CUSTOM_CSS,
} from '../../lib/settings';
import { useServerInfo } from '../../lib/server-info';
import { currentHost } from '../../lib/hosts';
import { SettingsCard } from '../../components/settings-card';
import { Anchor } from '../../components/anchor';
import { followsYou, DOCS_URL } from './common';

const KEEP_CSS_MS = 15_000;

const CSS_DOCS_URL = `${DOCS_URL}/reference/web-app-css`;

/** The presets' names, which the shared palette keeps in English. */
const presetName = (name: string) =>
  ({
    Default: t`Default`,
    Midnight: t`Midnight`,
    'Deep purple': t`Deep purple`,
    Desert: t`Desert`,
    Pink: t`Pink`,
    Sun: t`Sun`,
    Crimson: t`Crimson`,
    Rainforest: t`Rainforest`,
    Ocean: t`Ocean`,
  })[name] ?? name;

export function ThemeSection() {
  const [colors, setColors] = useSetting(settings.theme.colors);
  const [css, setCss] = useSetting(settings.theme.customCss);
  const [serverCss, setServerCss] = useSetting(settings.theme.serverCss);
  const server = useServerInfo();
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
    const id = toast(t`Custom CSS applied`, {
      description: t`It will be undone unless you keep it.`,
      duration: KEEP_CSS_MS,
      action: { label: t`Keep`, onClick: () => undefined },
      onDismiss: () => {
        if (pending.current?.id === id) pending.current = undefined;
      },
      onAutoClose: () => {
        pending.current = undefined;
        setCss(previous);
        toast(t`Custom CSS undone`);
      },
    });
    pending.current = { id, previous };
  };
  return (
    <SettingsCard name="theme" title={t`Theme`} description={followsYou()}>
      <div className="space-y-2">
        <p className="text-sm font-semibold">
          <Trans>Presets</Trans>
        </p>
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
                  'flex items-center gap-2 rounded-full border py-1 ps-1 pe-3 text-sm transition-colors hover:bg-white/5',
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
                {presetName(preset.name)}
              </button>
            );
          })}
        </div>
      </div>
      <ColorInput
        picker={!currentHost().tv}
        swatches={THEME_PRESETS.map((p) => ({
          value: p.accent,
          name: presetName(p.name),
        }))}
        label={t`Accent`}
        help={t`Buttons, progress bars and highlights.`}
        value={accent}
        onValueChange={(value) => pick({ accent: value, background })}
      />
      <ColorInput
        picker={!currentHost().tv}
        swatches={THEME_PRESETS.map((p) => ({
          value: p.background,
          name: presetName(p.name),
        }))}
        label={t`Background`}
        help={t`Pages and panels take their shades from it. Dark colours read best.`}
        value={background}
        onValueChange={(value) => pick({ accent, background: value })}
      />
      {server.css && (
        <Switch
          side="right"
          label={t`Use this server's CSS`}
          help={t`This server styles the app for everyone. Your own CSS applies on top of it.`}
          value={serverCss}
          onValueChange={setServerCss}
        />
      )}
      <Textarea
        data-ui="custom-css-editor"
        label={t`Custom CSS`}
        help={
          CUSTOM_CSS_OFF ? (
            <Trans>
              Off for this visit, since the address ends in <code>?safe</code>.
              Fix or clear it here, then open the app without it.
            </Trans>
          ) : (
            <Trans>
              Applied on top of the theme. Parts of the app carry a{' '}
              <code>data-ui</code> attribute to style them by, such as{' '}
              <code>[data-ui=&quot;progress-bar&quot;]</code>. If it ever hides
              the page, add <code>?safe</code> to the address to turn it off.
              See the{' '}
              <Anchor
                href={CSS_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="text-[--brand] hover:underline"
              >
                guide
              </Anchor>{' '}
              for every selector and examples.
            </Trans>
          )
        }
        value={draft}
        onValueChange={setDraft}
        maxLength={MAX_CUSTOM_CSS}
        spellCheck={false}
        placeholder={
          // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS
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
          <Trans>Apply CSS</Trans>
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
            <Trans>Reset theme</Trans>
          </Button>
        )}
      </div>
    </SettingsCard>
  );
}
