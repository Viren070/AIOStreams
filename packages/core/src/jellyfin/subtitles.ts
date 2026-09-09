import type { ParsedStream, Subtitle } from '../db/schemas.js';
import type { DeviceProfile, SubtitleTrack } from './types.js';

export type SubtitleFormat = 'vtt' | 'srt' | 'ass' | 'json';

/** Stream-attached subtitles first (release specific), then addon subtitles. */
export function mergeSubtitleTracks(
  stream: Pick<ParsedStream, 'subtitles'> | undefined,
  addonSubtitles: SubtitleTrack[]
): SubtitleTrack[] {
  const out: SubtitleTrack[] = [];
  const seen = new Set<string>();
  const push = (t: SubtitleTrack) => {
    if (!t.url || seen.has(t.url)) return;
    seen.add(t.url);
    out.push(t);
  };
  for (const s of stream?.subtitles ?? []) {
    push({ id: s.id, url: s.url, lang: s.lang, source: 'stream' });
  }
  for (const s of addonSubtitles) push(s);
  return out;
}

export function addonSubtitleTracks(subs: Subtitle[]): SubtitleTrack[] {
  return subs.map((s) => ({
    id: s.id,
    url: s.url,
    lang: s.lang,
    source: 'addon',
  }));
}

/**
 * The format the client asked for through its device profile. The track's own
 * format decides only whether a styled script stays styled.
 */
export function subtitleFormatFor(
  profile: DeviceProfile | undefined,
  clientName?: string,
  sourceExtension?: string
): SubtitleFormat {
  const formats = new Set<string>();
  for (const p of profile?.SubtitleProfiles ?? []) {
    if ((p.Method ?? '').toLowerCase() !== 'external') continue;
    const f = (p.Format ?? '').toLowerCase();
    if (f) formats.add(f === 'subrip' ? 'srt' : f === 'webvtt' ? 'vtt' : f);
  }
  // Converting ASS to SRT drops positioning and styling, so keep it when asked.
  const ext = (sourceExtension ?? '').toLowerCase();
  if (
    (ext === 'ass' || ext === 'ssa') &&
    (formats.has('ass') || formats.has('ssa'))
  )
    return 'ass';
  if (/kodi/i.test(clientName ?? '')) return 'srt';
  if (formats.has('vtt')) return 'vtt';
  if (formats.has('srt')) return 'srt';
  if (formats.has('ass') || formats.has('ssa')) return 'ass';
  return 'vtt';
}

export function subtitleCodecFor(format: SubtitleFormat | string): string {
  switch (format) {
    case 'vtt':
    case 'webvtt':
      return 'webvtt';
    case 'ass':
    case 'ssa':
      return 'ass';
    default:
      return 'subrip';
  }
}

export function subtitleExtensionOf(url: string): string {
  const ext = (
    url.split('?')[0].split('#')[0].split('.').pop() ?? ''
  ).toLowerCase();
  return /^(srt|vtt|ass|ssa|sub|sup)$/.test(ext) ? ext : 'srt';
}

export function normaliseSubtitleText(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

const TIME_RE =
  /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})|(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function timeToMs(text: string): number | null {
  const m = TIME_RE.exec(text.trim());
  if (!m) return null;
  if (m[1] !== undefined) {
    return (
      Number(m[1]) * 3_600_000 +
      Number(m[2]) * 60_000 +
      Number(m[3]) * 1000 +
      Number(m[4].padEnd(3, '0'))
    );
  }
  return (
    Number(m[5]) * 60_000 + Number(m[6]) * 1000 + Number(m[7].padEnd(3, '0'))
  );
}

interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

/** Parses SRT or VTT into cues; ignores headers, NOTE/STYLE blocks and ids. */
export function parseCues(input: string): Cue[] {
  const text = normaliseSubtitleText(input);
  const blocks = text.split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.length > 0);
    if (!lines.length) continue;
    if (/^(WEBVTT|NOTE|STYLE|REGION)/.test(lines[0])) continue;
    const arrow = lines.findIndex((l) => l.includes('-->'));
    if (arrow === -1) continue;
    const [start, end] = lines[arrow].split('-->');
    const startMs = timeToMs(start);
    const endMs = timeToMs(end.split(' ')[0] === '' ? end.trim() : end);
    if (startMs === null || endMs === null) continue;
    cues.push({ startMs, endMs, text: lines.slice(arrow + 1).join('\n') });
  }
  return cues;
}

/** Parses the Dialogue lines of an ASS/SSA script; styling is dropped. */
export function parseAssCues(input: string): Cue[] {
  const text = normaliseSubtitleText(input);
  const cues: Cue[] = [];
  let textIndex = 9; // ASS default field order when no Format line is present
  for (const line of text.split('\n')) {
    const formatMatch = /^\s*Format:\s*(.+)$/i.exec(line);
    if (formatMatch) {
      const fields = formatMatch[1]
        .split(',')
        .map((f) => f.trim().toLowerCase());
      const at = fields.indexOf('text');
      if (at >= 0) textIndex = at;
      continue;
    }
    const dialogue = /^\s*Dialogue:\s*(.+)$/i.exec(line);
    if (!dialogue) continue;
    const parts = dialogue[1].split(',');
    if (parts.length <= textIndex) continue;
    const startMs = timeToMs(parts[1] ?? '');
    const endMs = timeToMs(parts[2] ?? '');
    if (startMs === null || endMs === null) continue;
    const body = parts
      .slice(textIndex)
      .join(',')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\[Nnh]/g, '\n')
      .trim();
    if (body) cues.push({ startMs, endMs, text: body });
  }
  return cues.sort((a, b) => a.startMs - b.startMs);
}

function pad(n: number, len = 2) {
  return String(n).padStart(len, '0');
}

function msToVtt(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

export function cuesToVtt(cues: Cue[]): string {
  const body = cues
    .map(
      (c, i) =>
        `${i + 1}\n${msToVtt(c.startMs)} --> ${msToVtt(c.endMs)}\n${c.text}`
    )
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

export function cuesToSrt(cues: Cue[]): string {
  return (
    cues
      .map(
        (c, i) =>
          `${i + 1}\n${msToVtt(c.startMs).replace('.', ',')} --> ${msToVtt(c.endMs).replace('.', ',')}\n${c.text}`
      )
      .join('\n\n') + '\n'
  );
}

/** Jellyfin's JSON track format (100 ns ticks). */
export function cuesToJellyfinJson(cues: Cue[]): string {
  return JSON.stringify({
    TrackEvents: cues.map((c, i) => ({
      Id: String(i + 1),
      Text: c.text,
      StartPositionTicks: c.startMs * 10_000,
      EndPositionTicks: c.endMs * 10_000,
    })),
  });
}

/* The types Jellyfin itself serves for these formats. */
const VTT_TYPE = 'text/vtt; charset=utf-8';
const SRT_TYPE = 'application/x-subrip; charset=utf-8';
const ASS_TYPE = 'text/x-ssa; charset=utf-8';

export function convertSubtitle(
  body: string,
  fromExt: string,
  to: SubtitleFormat
): { body: string; contentType: string } {
  const from = fromExt.toLowerCase();
  const isAss = from === 'ass' || from === 'ssa';
  const textual = from === 'srt' || from === 'vtt' || from === 'sub';
  const cuesOf = () =>
    isAss ? parseAssCues(body) : textual ? parseCues(body) : [];

  if (to === 'json') {
    return {
      body: cuesToJellyfinJson(cuesOf()),
      contentType: 'application/json; charset=utf-8',
    };
  }
  if (to === 'ass') {
    if (isAss)
      return { body: normaliseSubtitleText(body), contentType: ASS_TYPE };
    // Nothing here writes ASS, so serve what we have under its own type.
    return { body: cuesToSrt(cuesOf()), contentType: SRT_TYPE };
  }
  if (to === 'vtt') {
    if (from === 'vtt') {
      return { body: normaliseSubtitleText(body), contentType: VTT_TYPE };
    }
    const cues = cuesOf();
    if (cues.length) return { body: cuesToVtt(cues), contentType: VTT_TYPE };
    return {
      body: normaliseSubtitleText(body),
      contentType: 'text/plain; charset=utf-8',
    };
  }
  if (from === 'srt') {
    return { body: normaliseSubtitleText(body), contentType: SRT_TYPE };
  }
  const cues = cuesOf();
  if (cues.length) return { body: cuesToSrt(cues), contentType: SRT_TYPE };
  return {
    body: normaliseSubtitleText(body),
    contentType: 'text/plain; charset=utf-8',
  };
}
