import type { SubtitleCue, SubtitleLine } from '../subtitles/cues';

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

export const linesOf = (cues: readonly SubtitleCue[]): SubtitleLine[] =>
  cues.flatMap(({ startMs, text }) => {
    const line = plainText(text).replace(/\n/g, ' ');
    return line ? [{ startMs, text: line }] : [];
  });
