import { t } from '@lingui/core/macro';
import {
  settings,
  SUBTITLE_POSITION_MAX,
  SUBTITLE_SIZES,
  type SubtitleFont,
  type SubtitleOutline,
  type SubtitleSize,
  type SubtitleStyle,
} from '../settings';

const SCALE: Record<SubtitleSize, number> = {
  small: 0.8,
  normal: 1,
  large: 1.25,
  huge: 1.5,
};

export const subtitleSizeLabel = (size: SubtitleSize) =>
  ({
    small: t`Small`,
    normal: t`Normal`,
    large: t`Large`,
    huge: t`Huge`,
  })[size];

/** One size up or down; null at either end. */
export function stepSubtitleSize(sign: number): SubtitleSize | null {
  const at = SUBTITLE_SIZES.indexOf(settings.subtitle.size.read());
  const next = SUBTITLE_SIZES[at + sign];
  if (!next) return null;
  settings.subtitle.size.write(next);
  return next;
}

const HEIGHT_STEP = 2;

/** A little higher or lower; null at either end. */
export function stepSubtitleHeight(sign: number): number | null {
  const height = settings.subtitle.position.read();
  const next = Math.min(
    SUBTITLE_POSITION_MAX,
    Math.max(0, height + sign * HEIGHT_STEP)
  );
  if (next === height) return null;
  settings.subtitle.position.write(next);
  return next;
}

const OUTLINE_PX: Record<SubtitleOutline, number> = {
  none: 0,
  thin: 1,
  normal: 2,
  thick: 3,
};

/** mpv's outline sizes, in its own scaled units. */
export const MPV_OUTLINE: Record<SubtitleOutline, number> = {
  none: 0,
  thin: 1,
  normal: 1.65,
  thick: 3,
};

/** The desktop app's fonts first, then the Android app's names for them. */
/* eslint-disable lingui/no-unlocalized-strings -- CSS font families */
const FONT_FAMILIES: Record<Exclude<SubtitleFont, 'default'>, string> = {
  'sans-serif': 'sans-serif',
  serif: 'serif',
  monospace: 'Consolas, Menlo, monospace',
  'serif-monospace': '"Courier New", serif-monospace, monospace',
  casual: '"Comic Sans MS", casual, sans-serif',
  cursive: '"Segoe Script", "Snell Roundhand", cursive',
};
/* eslint-enable lingui/no-unlocalized-strings */

/** mpv's shadow offset, in the same units, from the outline's edge. */
export const MPV_SHADOW = 3;

export const subtitleScale = (style: SubtitleStyle) => SCALE[style.size];

/** How high subtitles sit, in percent: the chosen height, or above what covers the bottom. */
export const subtitleHeight = (style?: SubtitleStyle, lift = 0) =>
  Math.max(style?.position ?? 0, Math.round(lift * 100));

/** Percent from the top where an unplaced subtitle's bottom sits, as mpv places it. */
export const subtitleLine = (style?: SubtitleStyle, lift = 0) =>
  97 - subtitleHeight(style, lift);

/* eslint-disable lingui/no-unlocalized-strings -- CSS values */
function rgba(hex: string, opacity: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity / 100})`;
}

export function subtitleCss(style: SubtitleStyle): {
  color: string;
  backgroundColor: string;
  textShadow: string;
  fontSize: string;
  fontWeight: number;
  fontFamily?: string;
} {
  const px = OUTLINE_PX[style.outline];
  const c = style.outlineColor;
  const shadows = px
    ? [
        `${-px}px ${-px}px 0 ${c}`,
        `${px}px ${-px}px 0 ${c}`,
        `${-px}px ${px}px 0 ${c}`,
        `${px}px ${px}px 0 ${c}`,
      ]
    : [];
  // A text shadow starts from the letters, so it clears the outline as mpv's does.
  const offset = `calc(${px}px + 0.08em)`;
  if (style.shadow) shadows.push(`${offset} ${offset} 0 ${c}`);
  return {
    color: style.textColor,
    backgroundColor: rgba(style.backgroundColor, style.backgroundOpacity),
    textShadow: shadows.join(', ') || 'none',
    fontSize: `${SCALE[style.size] * 100}%`,
    fontWeight: style.bold ? 700 : 500,
    fontFamily:
      style.font === 'default' ? undefined : FONT_FAMILIES[style.font],
  };
}
/* eslint-enable lingui/no-unlocalized-strings */

/** mpv writes colours with the alpha first: `#AARRGGBB`. */
export function mpvColor(hex: string, opacity = 100): string {
  const alpha = Math.round((opacity / 100) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${alpha}${hex.slice(1)}`.toUpperCase();
}
