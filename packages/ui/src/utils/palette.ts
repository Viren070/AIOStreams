import { colord, extend } from 'colord';
import mixPlugin from 'colord/plugins/mix';

extend([mixPlugin]);

export const DEFAULT_BACKGROUND = '#070707';
export const DEFAULT_ACCENT = '#6152df';

export interface ThemePreset {
  name: string;
  background: string;
  accent: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { name: 'Default', background: DEFAULT_BACKGROUND, accent: DEFAULT_ACCENT },
  { name: 'Midnight', background: '#000000', accent: '#5649bb' },
  { name: 'Deep purple', background: '#0a050d', accent: '#8659c9' },
  { name: 'Desert', background: '#090e11', accent: '#c08b57' },
  { name: 'Pink', background: '#0f060c', accent: '#bb5889' },
  { name: 'Sun', background: '#0b0803', accent: '#c17e21' },
  { name: 'Crimson', background: '#0c0d10', accent: '#8c1d1d' },
  { name: 'Rainforest', background: '#050d0c', accent: '#1d975a' },
  { name: 'Ocean', background: '#050a0d', accent: '#1a72a8' },
];

const rgb = (color: ReturnType<typeof colord>) => {
  const { r, g, b } = color.toRgb();
  return `${r} ${g} ${b}`;
};

/**
 * The theme's CSS variables for a dark background and an accent colour, each
 * left out when not given so the stylesheet's own values stay.
 */
export function themeVariables(opts: {
  background?: string;
  accent?: string;
}): Record<string, string> {
  const vars: Record<string, string> = {};
  const bg = opts.background ? colord(opts.background) : null;
  if (bg?.isValid()) {
    const light = colord('#f8fafc').mix(bg, 0.15);
    const tint = colord('#f8fafc').mix(bg, 0.7);
    vars['--background'] = bg.toHex();
    vars['--paper'] = bg.mix(tint, 0.03).toHex();
    const grays: [number, number, typeof light][] = [
      [950, 0.02, tint],
      [900, 0.05, tint],
      [800, 0.1, tint],
      [700, 0.18, light],
      [600, 0.32, light],
      [500, 0.48, light],
      [400, 0.64, light],
      [300, 0.78, light],
      [200, 0.88, light],
      [100, 0.94, light],
      [50, 0.98, light],
    ];
    for (const [step, amount, towards] of grays)
      vars[`--color-gray-${step}`] = rgb(bg.mix(towards, amount));
  }
  const accent = opts.accent ? colord(opts.accent) : null;
  if (accent?.isValid()) {
    const brand: [number, string, number][] = [
      [50, '#ffffff', 0.9],
      [100, '#ffffff', 0.75],
      [200, '#ffffff', 0.55],
      [300, '#ffffff', 0.35],
      [400, '#ffffff', 0.15],
      [600, '#000000', 0.15],
      [700, '#000000', 0.3],
      [800, '#000000', 0.45],
      [900, '#000000', 0.6],
      [950, '#000000', 0.75],
    ];
    vars['--color-brand-500'] = rgb(accent);
    vars['--color-brand-default'] = rgb(accent);
    for (const [step, towards, amount] of brand)
      vars[`--color-brand-${step}`] = rgb(accent.mix(towards, amount));
    vars['--brand'] = accent.mix('#ffffff', 0.35).toHex();
  }
  return vars;
}
