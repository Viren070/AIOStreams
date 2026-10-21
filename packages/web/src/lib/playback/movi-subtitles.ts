import type { SubtitleStyle } from '../settings';
import type { SubtitleCue } from '../subtitles/cues';
import { subtitleCss, subtitleLine, subtitleScale } from '../subtitles/style';

const TAGS = /<[^>]*>|\{[^}]*\}/g;

/** Cue text as the page shows it, without markup. */
const plainText = (text: string) =>
  text.replace(/\\N/gi, '\n').replace(/\\h/g, ' ').replace(TAGS, '').trim();

/** The text showing at `ms`, one line per cue. */
export function textAt(cues: readonly SubtitleCue[], ms: number): string {
  let text = '';
  for (const cue of cues) {
    if (cue.startMs > ms) break;
    if (ms >= cue.endMs) continue;
    const line = plainText(cue.text);
    if (line) text = text ? `${text}\n${line}` : line;
  }
  return text;
}

const OVERLAY = '[data-ui="player-subtitle-embedded"]';

/* eslint-disable lingui/no-unlocalized-strings -- CSS */
/**
 * Movi's look for the subtitles it draws lives in its element's stylesheet,
 * which a bare player doesn't have, so these are styled and placed as the
 * page draws its own. Movi sets the overlay's padding and centres a line by
 * padding its row from a measurement of its own font; both are overruled,
 * the padding so it sits as high as the page's, from the bottom of the window
 * rather than the picture, and changes at once. A bitmap's scale is the one
 * part of the style it can take.
 */
export function embeddedCss(style: SubtitleStyle, lift: number): string {
  const css = subtitleCss(style);
  const scale = subtitleScale(style);
  return `${OVERLAY} {
    padding-bottom: ${100 - subtitleLine(style, lift)}vh !important;
    --movi-sub-size-mult: ${scale};
  }
  ${OVERLAY} .movi-subtitle-anchor {
    box-sizing: border-box;
    width: 100%;
    padding: 0 5% !important;
    text-align: center !important;
  }
  ${OVERLAY} .movi-subtitle-line {
    width: fit-content;
    margin-inline: auto;
    padding: 0 0.5rem;
    font-size: calc(${scale} * 5vh);
    font-weight: ${css.fontWeight};
    color: ${css.color};
    background-color: ${css.backgroundColor};
    text-shadow: ${css.textShadow};
    ${css.fontFamily ? `font-family: ${css.fontFamily};` : ''}
  }`;
}
/* eslint-enable lingui/no-unlocalized-strings */
