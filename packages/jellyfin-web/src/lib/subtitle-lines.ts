import { storedMap } from './storage';

export interface SubtitleLine {
  startMs: number;
  text: string;
}

export const SUBTITLE_DELAY_LIMIT_MS = 60_000;
export const SUBTITLE_DELAY_STEP_MS = 100;
/** Pressing on hearing a line comes this late, on average. */
const REACTION_MS = 300;

const TIMING =
  /((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/;

function toMs(stamp: string): number {
  const [clock, fraction = '0'] = stamp.replace(',', '.').split('.');
  const parts = clock.split(':').map(Number);
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds * 1000 + Number(fraction.padEnd(3, '0').slice(0, 3));
}

export interface SubtitleCue extends SubtitleLine {
  endMs: number;
}

const TAGS = /<[^>]*>|\{[^}]*\}/g;

/** The cues of a WebVTT or SRT file, markup kept. */
export function parseCues(body: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  for (const block of body.replace(/\r/g, '').split(/\n{2,}/)) {
    const rows = block.split('\n');
    const at = rows.findIndex((row) => TIMING.test(row));
    if (at < 0) continue;
    const text = rows
      .slice(at + 1)
      .join('\n')
      .trim();
    const [, start, end] = TIMING.exec(rows[at])!;
    if (text) cues.push({ startMs: toMs(start), endMs: toMs(end), text });
  }
  return cues;
}

/** The dialogue of an ASS or SSA file as plain cues, without its styling or drawings. */
export function parseAssCues(body: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let events = false;
  let fields: string[] = [];
  for (const row of body.replace(/\r/g, '').split('\n')) {
    const line = row.trim();
    if (line.startsWith('[')) {
      events = line.toLowerCase() === '[events]';
      continue;
    }
    const colon = line.indexOf(':');
    if (!events || colon < 0) continue;
    const key = line.slice(0, colon).toLowerCase();
    const values = line.slice(colon + 1).split(',');
    if (key === 'format') fields = values.map((f) => f.trim().toLowerCase());
    if (key !== 'dialogue' || !fields.includes('text')) continue;
    const field = (name: string) => values[fields.indexOf(name)]?.trim() ?? '';
    const raw = values.slice(fields.indexOf('text')).join(',');
    if (/\{[^}]*\\p[1-9]/.test(raw)) continue;
    const text = raw
      .replace(TAGS, '')
      .replace(/\\n/gi, '\n')
      .replace(/\\h/g, ' ')
      .trim();
    if (text)
      cues.push({
        startMs: toMs(field('start')),
        endMs: toMs(field('end')),
        text,
      });
  }
  return cues.sort((a, b) => a.startMs - b.startMs);
}

/** The lines of a WebVTT or SRT file, tags stripped. */
export function parseSubtitleLines(body: string): SubtitleLine[] {
  return parseCues(body).flatMap(({ startMs, text }) => {
    const plain = text.replace(/\n/g, ' ').replace(TAGS, '').trim();
    return plain ? [{ startMs, text: plain }] : [];
  });
}

export function clampDelay(ms: number): number {
  return Math.max(
    -SUBTITLE_DELAY_LIMIT_MS,
    Math.min(SUBTITLE_DELAY_LIMIT_MS, Math.round(ms))
  );
}

/** The delay that shows `line` at `heardAtMs`, the moment it was heard. */
export function delayForLine(heardAtMs: number, line: SubtitleLine): number {
  return clampDelay(heardAtMs - line.startMs - REACTION_MS);
}

/** Taps further apart than this were two different lines. */
const MAX_TAP_GAP_MS = 30_000;

/**
 * The delay from when a line was heard and when its subtitle showed; null when
 * too far apart to be one line. Reaction time is in both taps and cancels out.
 */
export function delayForTaps(
  delayMs: number,
  heardAtMs: number,
  sawAtMs: number
): number | null {
  const gap = heardAtMs - sawAtMs;
  return Math.abs(gap) > MAX_TAP_GAP_MS ? null : clampDelay(delayMs + gap);
}

export function delayLabel(ms: number): string {
  if (!ms) return 'In sync';
  return `${ms > 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(1)}s`;
}

/*
 * Kept per version rather than per title: two releases of one episode are
 * rarely off by the same amount.
 */
const delays = storedMap<number>('aiostreams-web-subtitle-delays', 200);

export function savedSubtitleDelay(
  sourceId: string | null | undefined
): number {
  return (sourceId && delays.get(sourceId)) || 0;
}

export function saveSubtitleDelay(
  sourceId: string | null | undefined,
  ms: number
): void {
  if (sourceId) delays.set(sourceId, ms || undefined);
}
