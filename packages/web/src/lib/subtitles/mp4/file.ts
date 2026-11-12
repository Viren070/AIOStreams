import { readAll, withStart, type ByteReader } from '@/lib/byte-reader';
import type { Span } from '@/lib/subtitles/align';
import type { FileSubtitle } from '@/lib/subtitles/file-subtitle';

/** The index of a film of many hours and tracks can pass this; it isn't worth the read. */
const MAX_MOOV = 24 * 1024 * 1024;
const MAX_SAMPLE = 64 * 1024;
const MAX_BOXES = 64;

/* eslint-disable lingui/no-unlocalized-strings -- MP4 box types */
const SUBTITLE_HANDLERS = ['sbtl', 'text', 'subt', 'subp'];
/** An empty sample, a gap between lines: two length bytes for text, an 8-byte vtte box for WebVTT. */
const EMPTY_SIZES: Record<string, number> = { tx3g: 2, text: 2, wvtt: 8 };
/* eslint-enable lingui/no-unlocalized-strings */

export interface Mp4Sample {
  at: number;
  size: number;
  startMs: number;
  endMs: number;
}

export interface Mp4File {
  reader: ByteReader;
  subtitles: FileSubtitle[];
  /** Each text track's lines, by track number, in time order. */
  samples: Map<number, Mp4Sample[]>;
}

const u16 = (b: Uint8Array, i: number) =>
  i + 2 <= b.length ? (b[i] << 8) | b[i + 1] : undefined;
const u32 = (b: Uint8Array, i: number) =>
  i + 4 <= b.length
    ? b[i] * 2 ** 24 + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]
    : undefined;
const u64 = (b: Uint8Array, i: number) => {
  const high = u32(b, i);
  const low = u32(b, i + 4);
  return high === undefined || low === undefined
    ? undefined
    : high * 2 ** 32 + low;
};
const i32 = (b: Uint8Array, i: number) => {
  const value = u32(b, i);
  return value === undefined ? undefined : value | 0;
};
const i64 = (b: Uint8Array, i: number) => {
  const high = i32(b, i);
  const low = u32(b, i + 4);
  return high === undefined || low === undefined
    ? undefined
    : high * 2 ** 32 + low;
};
const typeAt = (b: Uint8Array, i: number) =>
  String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

function* boxes(b: Uint8Array): Generator<{ type: string; body: Uint8Array }> {
  let i = 0;
  while (i + 8 <= b.length) {
    let size = u32(b, i)!;
    let head = 8;
    if (size === 1) {
      size = u64(b, i + 8) ?? 0;
      head = 16;
    } else if (size === 0) size = b.length - i;
    if (size < head || i + size > b.length) return;
    yield { type: typeAt(b, i + 4), body: b.subarray(i + head, i + size) };
    i += size;
  }
}

function child(b: Uint8Array, type: string): Uint8Array | undefined {
  for (const box of boxes(b)) if (box.type === type) return box.body;
  return undefined;
}

function firstBox(b: Uint8Array) {
  for (const box of boxes(b)) return box;
  return undefined;
}

const path = (b: Uint8Array, types: string[]) =>
  types.reduce<Uint8Array | undefined>((at, type) => at && child(at, type), b);

/** A box's version decides the width of its times. */
const wide = (b: Uint8Array) => b[0] === 1;

const text = new TextDecoder();

/** Null for a file that isn't MP4, is fragmented, or keeps its index too far in. */
async function moovOf(reader: ByteReader): Promise<Uint8Array | null> {
  let at = 0;
  for (let hops = 0; hops < MAX_BOXES; hops++) {
    const head = await readAll(reader, at, 16);
    if (head.length < 8) return null;
    const type = typeAt(head, 4);
    const long = u32(head, 0) === 1;
    const size = long ? (u64(head, 8) ?? 0) : u32(head, 0)!;
    if ((at === 0 && type !== 'ftyp') || type === 'moof') return null;
    // A size of 0 runs to the end of the file, so nothing comes after it.
    if (size < (long ? 16 : 8)) return null;
    if (type === 'moov') {
      if (size > MAX_MOOV) return null;
      const length = size - (long ? 16 : 8);
      const body = await readAll(reader, at + (long ? 16 : 8), length);
      return body.length === length ? body : null;
    }
    at += size;
  }
  return null;
}

function languageOf(mdia: Uint8Array): string | undefined {
  const elng = child(mdia, 'elng');
  if (elng && elng.length > 4) {
    const tag = text.decode(elng.subarray(4)).replace(/\0+$/, '');
    if (tag && tag !== 'und') return tag;
  }
  const mdhd = child(mdia, 'mdhd');
  const packed = mdhd && u16(mdhd, wide(mdhd) ? 32 : 20);
  if (packed === undefined) return undefined;
  const code = [10, 5, 0]
    .map((shift) => String.fromCharCode(((packed >> shift) & 0x1f) + 0x60))
    .join('');
  return /^[a-z]{3}$/.test(code) && code !== 'und' ? code : undefined;
}

/** A track's title, as MP4 muxers keep it in a `name` box, its text plain or in a `data` box. */
function nameOf(trak: Uint8Array): string | undefined {
  const name = path(trak, ['udta', 'name']);
  if (!name) return undefined;
  const data = child(name, 'data');
  const value = text
    .decode(data ? data.subarray(8) : name)
    .replace(/\0+$/, '')
    .trim();
  return value || undefined;
}

function samplesOf(
  trak: Uint8Array,
  mdia: Uint8Array,
  movieScale: number,
  empty: number
): Mp4Sample[] {
  const mdhd = child(mdia, 'mdhd');
  const scale = mdhd && u32(mdhd, wide(mdhd) ? 20 : 12);
  const stbl = path(mdia, ['minf', 'stbl']);
  if (!scale || !stbl) return [];
  const stsz = child(stbl, 'stsz');
  const stts = child(stbl, 'stts');
  const stsc = child(stbl, 'stsc');
  const stco = child(stbl, 'stco');
  const co64 = child(stbl, 'co64');
  const offsets = stco ?? co64;
  if (!stsz || !stts || !stsc || !offsets) return [];
  const fixed = u32(stsz, 4) ?? 0;
  const count = u32(stsz, 8) ?? 0;
  const sizeOf = (sample: number) => fixed || (u32(stsz, 12 + 4 * sample) ?? 0);
  const chunkAt = (chunk: number) =>
    stco ? u32(stco, 8 + 4 * chunk) : u64(co64!, 8 + 8 * chunk);
  const runs = Array.from({ length: u32(stsc, 4) ?? 0 }, (_, i) => ({
    firstChunk: u32(stsc, 8 + 12 * i) ?? 1,
    perChunk: u32(stsc, 12 + 12 * i) ?? 0,
  }));
  // Empty edits delay the track, and its first edit's media time starts it.
  let delayMs = 0;
  let first = 0;
  const elst = path(trak, ['edts', 'elst']);
  if (elst) {
    const entry = wide(elst) ? 20 : 12;
    for (let i = 0; i < (u32(elst, 4) ?? 0); i++) {
      const at = 8 + entry * i;
      const length = wide(elst) ? u64(elst, at) : u32(elst, at);
      const media = wide(elst) ? i64(elst, at + 8) : i32(elst, at + 4);
      if (length === undefined || media === undefined) break;
      if (media >= 0) {
        first = media;
        break;
      }
      delayMs += (length * 1000) / movieScale;
    }
  }
  const ms = (time: number) =>
    delayMs + (Math.max(0, time - first) * 1000) / scale;
  const out: Mp4Sample[] = [];
  const timings = u32(stts, 4) ?? 0;
  let timing = 0;
  let left = 0;
  let delta = 0;
  let sample = 0;
  let decodeTime = 0;
  let run = 0;
  const chunks = u32(offsets, 4) ?? 0;
  for (let chunk = 0; chunk < chunks && sample < count; chunk++) {
    while (run + 1 < runs.length && runs[run + 1].firstChunk <= chunk + 1)
      run++;
    let at = chunkAt(chunk) ?? 0;
    for (let n = 0; n < (runs[run]?.perChunk ?? 0) && sample < count; n++) {
      while (left === 0) {
        if (timing >= timings) return out;
        left = u32(stts, 8 + 8 * timing) ?? 0;
        delta = u32(stts, 12 + 8 * timing) ?? 0;
        timing++;
      }
      const size = sizeOf(sample);
      if (size > empty && size <= MAX_SAMPLE && decodeTime + delta > first)
        out.push({
          at,
          size,
          startMs: ms(decodeTime),
          endMs: ms(decodeTime + delta),
        });
      at += size;
      decodeTime += delta;
      left--;
      sample++;
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/** Null for a file that isn't MP4 or has no subtitle track. `start` is the file's first bytes. */
export async function openMp4(
  source: ByteReader,
  start: Uint8Array
): Promise<Mp4File | null> {
  const reader = withStart(source, start);
  const moov = await moovOf(reader);
  if (!moov || child(moov, 'mvex')) return null;
  const mvhd = child(moov, 'mvhd');
  const movieScale = (mvhd && u32(mvhd, wide(mvhd) ? 20 : 12)) || 1000;
  const traks = [...boxes(moov)].filter((box) => box.type === 'trak');
  // Players list chapter titles as chapters, not subtitles.
  const chapters = new Set<number>();
  for (const { body } of traks) {
    const tref = child(body, 'tref');
    if (!tref) continue;
    for (const ref of boxes(tref))
      if (ref.type === 'chap')
        for (let i = 0; i + 4 <= ref.body.length; i += 4)
          chapters.add(u32(ref.body, i)!);
  }
  const subtitles: FileSubtitle[] = [];
  const samples = new Map<number, Mp4Sample[]>();
  for (const { body: trak } of traks) {
    const mdia = child(trak, 'mdia');
    const hdlr = mdia && child(mdia, 'hdlr');
    if (!mdia || !hdlr || !SUBTITLE_HANDLERS.includes(typeAt(hdlr, 8)))
      continue;
    const tkhd = child(trak, 'tkhd');
    const number = tkhd ? u32(tkhd, wide(tkhd) ? 20 : 12) : undefined;
    if (!number || chapters.has(number)) continue;
    const stsd = path(mdia, ['minf', 'stbl', 'stsd']);
    const codec = (stsd && firstBox(stsd.subarray(8))?.type) ?? '';
    const empty = EMPTY_SIZES[codec];
    subtitles.push({
      number,
      codec,
      kind: empty === undefined ? null : 'text',
      language: languageOf(mdia),
      name: nameOf(trak),
      // Its enabled flag.
      isDefault: !!tkhd && (tkhd[3] & 1) === 1,
      isForced: false,
      hearingImpaired: false,
    });
    if (empty !== undefined)
      samples.set(number, samplesOf(trak, mdia, movieScale, empty));
  }
  return subtitles.length ? { reader, subtitles, samples } : null;
}

export const sampleLines = (file: Mp4File, number: number): Span[] =>
  (file.samples.get(number) ?? []).map(({ startMs, endMs }) => ({
    startMs,
    endMs,
  }));

/** A text sample is its length and the text; a WebVTT one, its cues' payloads. */
export function sampleText(codec: string, bytes: Uint8Array): string {
  if (codec === 'wvtt') {
    const cues: string[] = [];
    for (const box of boxes(bytes)) {
      const payload = box.type === 'vttc' && child(box.body, 'payl');
      if (payload) cues.push(text.decode(payload));
    }
    return cues.join('\n');
  }
  const length = u16(bytes, 0) ?? 0;
  const body = bytes.subarray(2, 2 + length);
  const decoded =
    body[0] === 0xfe && body[1] === 0xff
      ? new TextDecoder('utf-16be').decode(body.subarray(2))
      : text.decode(body);
  return decoded.replace(/\r\n?/g, '\n');
}
