export interface SubtitleLine {
  startMs: number;
  text: string;
}

const STAMP = String.raw`(?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3}`;
const TIMING = new RegExp(`(${STAMP})\\s*-->\\s*(${STAMP})`);
const ASS = /^﻿?[ \t]*\[(?:script info|events)\][ \t]*\r?$/im;

function toMs(stamp: string): number {
  const [clock, fraction = '0'] = stamp.replace(',', '.').split('.');
  const parts = clock.split(':').map(Number);
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds * 1000 + Number(fraction.padEnd(3, '0').slice(0, 3));
}

/** `stamp` times `ratio`, written the way it was. */
function restamp(stamp: string, ratio: number): string {
  const [clock, fraction] = stamp.split(/[.,]/);
  const perSecond = 10 ** fraction.length;
  const total = Math.round((toMs(stamp) * ratio * perSecond) / 1000);
  const seconds = Math.floor(total / perSecond);
  const hours = Math.floor(seconds / 3600);
  const hoursWidth =
    clock.split(':').length === 3 ? clock.indexOf(':') : hours ? 2 : 0;
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return (
    (hoursWidth ? `${pad(hours, hoursWidth)}:` : '') +
    `${pad(Math.floor(seconds / 60) % 60, 2)}:${pad(seconds % 60, 2)}` +
    stamp[clock.length] +
    pad(total % perSecond, fraction.length)
  );
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

/** The cues of a WebVTT, SRT, ASS or SSA file. */
export function parseSubtitle(body: string): SubtitleCue[] {
  return ASS.test(body) ? parseAssCues(body) : parseCues(body);
}

export function subtitleExtension(body: string): 'ass' | 'vtt' | 'srt' {
  if (ASS.test(body)) return 'ass';
  return /^﻿?WEBVTT/.test(body) ? 'vtt' : 'srt';
}

/** `body` with its lines' times multiplied by `ratio`, everything else kept. */
export function retimeSubtitle(body: string, ratio: number): string {
  if (!ASS.test(body))
    return body.replace(
      new RegExp(`(${STAMP})(\\s*-->\\s*)(${STAMP})`, 'g'),
      (_, from: string, arrow: string, to: string) =>
        restamp(from, ratio) + arrow + restamp(to, ratio)
    );
  let events = false;
  let fields: string[] = [];
  return body
    .split('\n')
    .map((row) => {
      const line = row.trim();
      if (line.startsWith('[')) {
        events = line.toLowerCase() === '[events]';
        return row;
      }
      const colon = row.indexOf(':');
      if (!events || colon < 0) return row;
      const key = row.slice(0, colon).trim().toLowerCase();
      const values = row.slice(colon + 1).split(',');
      if (key === 'format') fields = values.map((f) => f.trim().toLowerCase());
      if (key !== 'dialogue' && key !== 'comment') return row;
      for (const field of ['start', 'end']) {
        const at = fields.indexOf(field);
        if (at >= 0 && at < values.length)
          values[at] = values[at].replace(new RegExp(STAMP), (stamp) =>
            restamp(stamp, ratio)
          );
      }
      return row.slice(0, colon + 1) + values.join(',');
    })
    .join('\n');
}

/** Cues as one line of text each, tags stripped. */
export function plainLines(cues: SubtitleCue[]): SubtitleLine[] {
  return cues.flatMap(({ startMs, text }) => {
    const plain = text.replace(/\n/g, ' ').replace(TAGS, '').trim();
    return plain ? [{ startMs, text: plain }] : [];
  });
}
