import type { SubtitleOutline, SubtitleSize, SubtitleStyle } from './settings';

const SCALE: Record<SubtitleSize, number> = {
  small: 0.8,
  normal: 1,
  large: 1.25,
  huge: 1.5,
};

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

export const subtitleScale = (style: SubtitleStyle) => SCALE[style.size];

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
} {
  const px = OUTLINE_PX[style.outline];
  const c = style.outlineColor;
  return {
    color: style.textColor,
    backgroundColor: rgba(style.backgroundColor, style.backgroundOpacity),
    textShadow: px
      ? `${-px}px ${-px}px 0 ${c}, ${px}px ${-px}px 0 ${c}, ${-px}px ${px}px 0 ${c}, ${px}px ${px}px 0 ${c}`
      : 'none',
    fontSize: `${SCALE[style.size] * 100}%`,
    fontWeight: style.bold ? 700 : 500,
  };
}

/** mpv writes colours with the alpha first: `#AARRGGBB`. */
export function mpvColor(hex: string, opacity = 100): string {
  const alpha = Math.round((opacity / 100) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${alpha}${hex.slice(1)}`.toUpperCase();
}
