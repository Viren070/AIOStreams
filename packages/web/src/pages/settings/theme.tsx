import React from 'react';
import { toast } from 'sonner';
import { ColorInput } from '@aiostreams/ui/color-input';
import { Textarea } from '@aiostreams/ui/textarea';
import {
  DEFAULT_ACCENT,
  DEFAULT_BACKGROUND,
  THEME_PRESETS,
} from '@aiostreams/ui/utils/palette';
import { Button } from '@aiostreams/ui/button';
import { cn } from '@aiostreams/ui/core/styling';
import {
  settings,
  useSetting,
  CUSTOM_CSS_OFF,
  MAX_CUSTOM_CSS,
} from '../../lib/settings';
import { SettingsCard } from '../../components/settings-card';
import { Anchor } from '../../components/anchor';
import { FOLLOWS_YOU, DOCS_URL } from './common';

const KEEP_CSS_MS = 15_000;

const CSS_DOCS_URL = `${DOCS_URL}/reference/web-app-css`;

export function ThemeSection() {
  const [colors, setColors] = useSetting(settings.theme.colors);
  const [css, setCss] = useSetting(settings.theme.customCss);
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
    <SettingsCard title="Theme" description={FOLLOWS_YOU}>
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
              <Anchor
                href={CSS_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="text-[--brand] hover:underline"
              >
                guide
              </Anchor>{' '}
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
