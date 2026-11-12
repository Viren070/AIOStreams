import {
  concat,
  readAll,
  ReadError,
  StreamCursor,
  streamOf,
  withStart,
  type ByteReader,
} from '@/lib/byte-reader';
import type { FileSubtitle, SubtitleKind } from '@/lib/subtitles/file-subtitle';
import {
  ATTACHED_FILE,
  ATTACHMENTS,
  CLUSTER,
  CODEC_ID,
  CODEC_PRIVATE,
  CONTENT_COMP_ALGO,
  CONTENT_COMP_SETTINGS,
  CONTENT_COMPRESSION,
  CONTENT_ENCODING,
  CONTENT_ENCODING_SCOPE,
  CONTENT_ENCODING_TYPE,
  CONTENT_ENCODINGS,
  CUE_CLUSTER_POSITION,
  CUE_DURATION,
  CUE_POINT,
  CUE_RELATIVE_POSITION,
  CUE_TIME,
  CUE_TRACK,
  CUE_TRACK_POSITIONS,
  CUES,
  EBML,
  FILE_DATA,
  FILE_MIME_TYPE,
  FILE_NAME,
  FLAG_DEFAULT,
  FLAG_FORCED,
  FLAG_HEARING_IMPAIRED,
  INFO,
  LANGUAGE,
  LANGUAGE_BCP47,
  NAME,
  SEEK,
  SEEK_HEAD,
  SEEK_ID,
  SEEK_POSITION,
  SEGMENT,
  SUBTITLE_TRACK,
  TIMESTAMP_SCALE,
  TRACK_ENTRY,
  TRACK_NUMBER,
  TRACK_TYPE,
  TRACKS,
  children,
  dataOf,
  head,
  text,
  uint,
  whole,
  type Child,
} from './ebml';

const MAX_ELEMENT = 16 * 1024 * 1024;

export interface Encoding {
  /** 0 zlib, 3 header stripping; the others are not read. */
  algo: number;
  settings?: Uint8Array;
  /** 1 the blocks, 2 the codec private data. */
  scope: number;
}

export interface MkvSubtitle extends FileSubtitle {
  /** An ASS track's script header. */
  header: string;
  encoding?: Encoding;
}

export interface Attachment {
  name: string;
  mime: string;
  /** Where the file's bytes start. */
  at: number;
  size: number;
}

export interface CueEntry {
  timeMs: number;
  cluster: number;
  /** In the cluster's data. */
  relative?: number;
  durationMs?: number;
}

export interface MkvFile {
  reader: ByteReader;
  /** Milliseconds in one unit of the file's timestamps. */
  scaleMs: number;
  /** In the order of the file's tracks, so the player's numbering. */
  subtitles: MkvSubtitle[];
  attachmentsAt?: number;
  /** By track number. */
  cues: Map<number, CueEntry[]>;
  /** Every cluster the index points at, by time. */
  clusters: { timeMs: number; at: number }[];
  firstCluster?: number;
}

/* eslint-disable lingui/no-unlocalized-strings -- Matroska codec ids */
const ASS_CODECS = ['S_TEXT/ASS', 'S_TEXT/SSA', 'S_ASS', 'S_SSA'];
const PGS_CODEC = 'S_HDMV/PGS';
const WEBM_VTT = 'D_WEBVTT/';
const TEXT_CODECS = [
  'S_TEXT/UTF8',
  'S_TEXT/ASCII',
  'S_TEXT/WEBVTT',
  `${WEBM_VTT}SUBTITLES`,
  `${WEBM_VTT}CAPTIONS`,
];
/* eslint-enable lingui/no-unlocalized-strings */

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined')
    throw new Error('This TV cannot unpack compressed subtitles');
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decoded(
  bytes: Uint8Array,
  encoding: Encoding | undefined,
  scope: number
): Promise<Uint8Array> {
  if (!encoding || !(encoding.scope & scope)) return bytes;
  if (encoding.algo === 3) {
    const prefix = encoding.settings ?? new Uint8Array();
    return concat([prefix, bytes], prefix.length + bytes.length);
  }
  return inflate(bytes);
}

/** A WebM-style WebVTT block starts with its cue's id and settings lines. */
export function blockText(track: MkvSubtitle, bytes: Uint8Array): string {
  const all = text(bytes);
  return track.codec.startsWith(WEBM_VTT)
    ? all.split('\n').slice(2).join('\n')
    : all;
}

function encodingOf(bytes: Uint8Array): Encoding | null | undefined {
  for (const entry of children(bytes, 0, bytes.length)) {
    if (entry.id !== CONTENT_ENCODING || !whole(bytes, entry)) continue;
    const data = dataOf(bytes, entry);
    let scope = 1;
    let type = 0;
    let algo = 0;
    let settings: Uint8Array | undefined;
    for (const field of children(data, 0, data.length)) {
      if (!whole(data, field)) continue;
      const value = dataOf(data, field);
      if (field.id === CONTENT_ENCODING_SCOPE) scope = uint(value);
      if (field.id === CONTENT_ENCODING_TYPE) type = uint(value);
      if (field.id !== CONTENT_COMPRESSION) continue;
      for (const part of children(value, 0, value.length)) {
        if (!whole(value, part)) continue;
        if (part.id === CONTENT_COMP_ALGO) algo = uint(dataOf(value, part));
        if (part.id === CONTENT_COMP_SETTINGS)
          settings = dataOf(value, part).slice();
      }
    }
    // Encrypted, or packed in a way the page can't undo.
    if (type !== 0 || (algo !== 0 && algo !== 3)) return null;
    return { algo, settings, scope };
  }
  return undefined;
}

async function readTracks(bytes: Uint8Array): Promise<MkvSubtitle[]> {
  const out: MkvSubtitle[] = [];
  for (const entry of children(bytes, 0, bytes.length)) {
    if (entry.id !== TRACK_ENTRY || !whole(bytes, entry)) continue;
    const data = dataOf(bytes, entry);
    let type = 0;
    let number = 0;
    let codec = '';
    // Matroska's default
    let language = 'eng';
    let bcp47: string | undefined;
    let name: string | undefined;
    let isDefault = true;
    let isForced = false;
    let hearingImpaired = false;
    let codecPrivate: Uint8Array | undefined;
    let encoding: Encoding | null | undefined;
    for (const field of children(data, 0, data.length)) {
      if (!whole(data, field)) continue;
      const value = dataOf(data, field);
      if (field.id === TRACK_TYPE) type = uint(value);
      else if (field.id === TRACK_NUMBER) number = uint(value);
      else if (field.id === CODEC_ID) codec = text(value);
      else if (field.id === LANGUAGE) language = text(value);
      else if (field.id === LANGUAGE_BCP47) bcp47 = text(value);
      else if (field.id === NAME) name = text(value);
      else if (field.id === FLAG_DEFAULT) isDefault = uint(value) === 1;
      else if (field.id === FLAG_FORCED) isForced = uint(value) === 1;
      else if (field.id === FLAG_HEARING_IMPAIRED)
        hearingImpaired = uint(value) === 1;
      else if (field.id === CODEC_PRIVATE) codecPrivate = value;
      else if (field.id === CONTENT_ENCODINGS) encoding = encodingOf(value);
    }
    if (type !== SUBTITLE_TRACK) continue;
    let kind: SubtitleKind | null = ASS_CODECS.includes(codec)
      ? 'ass'
      : TEXT_CODECS.includes(codec)
        ? 'text'
        : codec === PGS_CODEC
          ? 'pgs'
          : null;
    if (encoding === null) kind = null;
    let header = '';
    if (kind === 'ass' && codecPrivate) {
      try {
        header = text(await decoded(codecPrivate, encoding ?? undefined, 2));
      } catch {
        kind = null;
      }
    }
    const tag = bcp47 ?? language;
    out.push({
      number,
      codec,
      kind,
      language: tag === 'und' ? undefined : tag,
      name,
      isDefault,
      isForced,
      hearingImpaired,
      header,
      encoding: encoding ?? undefined,
    });
  }
  return out;
}

/** Adds what `bytes` points at to `into`, and another seek head to `more`. */
function readSeekHead(
  bytes: Uint8Array,
  segment: number,
  into: Map<number, number>,
  more: number[]
): void {
  for (const seek of children(bytes, 0, bytes.length)) {
    if (seek.id !== SEEK || !whole(bytes, seek)) continue;
    const data = dataOf(bytes, seek);
    let id = 0;
    let position = -1;
    for (const field of children(data, 0, data.length)) {
      if (!whole(data, field)) continue;
      if (field.id === SEEK_ID) id = uint(dataOf(data, field));
      if (field.id === SEEK_POSITION) position = uint(dataOf(data, field));
    }
    if (!id || position < 0) continue;
    if (id === SEEK_HEAD) more.push(segment + position);
    else if (!into.has(id)) into.set(id, segment + position);
  }
}

function readCues(
  bytes: Uint8Array,
  segment: number,
  scaleMs: number
): Pick<MkvFile, 'cues' | 'clusters'> {
  const cues = new Map<number, CueEntry[]>();
  const clusters = new Map<number, number>();
  for (const point of children(bytes, 0, bytes.length)) {
    if (point.id !== CUE_POINT || !whole(bytes, point)) continue;
    const data = dataOf(bytes, point);
    let time = 0;
    const positions: Uint8Array[] = [];
    for (const field of children(data, 0, data.length)) {
      if (!whole(data, field)) continue;
      if (field.id === CUE_TIME) time = uint(dataOf(data, field));
      if (field.id === CUE_TRACK_POSITIONS) positions.push(dataOf(data, field));
    }
    for (const position of positions) {
      let track = 0;
      let cluster = -1;
      let relative: number | undefined;
      let duration: number | undefined;
      for (const field of children(position, 0, position.length)) {
        if (!whole(position, field)) continue;
        const value = uint(dataOf(position, field));
        if (field.id === CUE_TRACK) track = value;
        else if (field.id === CUE_CLUSTER_POSITION) cluster = value;
        else if (field.id === CUE_RELATIVE_POSITION) relative = value;
        else if (field.id === CUE_DURATION) duration = value;
      }
      if (!track || cluster < 0) continue;
      const at = segment + cluster;
      const timeMs = time * scaleMs;
      const list = cues.get(track) ?? [];
      list.push({
        timeMs,
        cluster: at,
        relative,
        ...(duration !== undefined && { durationMs: duration * scaleMs }),
      });
      cues.set(track, list);
      const known = clusters.get(at);
      if (known === undefined || timeMs < known) clusters.set(at, timeMs);
    }
  }
  for (const list of cues.values()) list.sort((a, b) => a.timeMs - b.timeMs);
  return {
    cues,
    clusters: Array.from(clusters, ([at, timeMs]) => ({ at, timeMs })).sort(
      (a, b) => a.at - b.at
    ),
  };
}

async function readElement(
  reader: ByteReader,
  at: number,
  id: number
): Promise<Uint8Array | null> {
  const top = await readAll(reader, at, 16);
  const found = head(top, 0);
  if (!found || found.id !== id || found.size < 0 || found.size > MAX_ELEMENT)
    return null;
  return readAll(reader, at + found.length, found.size);
}

const FONT_NAME = /\.(ttf|otf|ttc|otc)$/i;

const MAX_ATTACHMENT = 64 * 1024 * 1024;

export interface AttachedFile extends Attachment {
  bytes: Uint8Array;
  /** Where the next file starts, to go on from if the read is cut off. */
  next: number;
}

/** One read front to back, from `from` where an earlier read was cut off. */
export async function* attachedFiles(
  reader: ByteReader,
  at: number,
  from?: number
): AsyncGenerator<AttachedFile> {
  const found = head(await readAll(reader, at, 16), 0);
  if (!found || found.id !== ATTACHMENTS || found.size < 0) return;
  const end = at + found.length + found.size;
  let next = from ?? at + found.length;
  if (next >= end) return;
  const cursor = new StreamCursor(streamOf(reader, next, end - next));
  // eslint-disable-next-line lingui/no-unlocalized-strings -- only logged
  const cut = () => new ReadError('cut short', false);
  try {
    while (next < end) {
      const file = head(await cursor.peek(Math.min(16, end - next)), 0);
      if (!file || file.size < 0) return;
      const total = file.length + file.size;
      if (file.id !== ATTACHED_FILE || file.size > MAX_ATTACHMENT) {
        if (!(await cursor.skip(total))) throw cut();
        next += total;
        continue;
      }
      const element = await cursor.take(total);
      if (element.length < total) throw cut();
      let name = '';
      let mime = '';
      let data: Child | null = null;
      for (const field of children(element, file.length, total)) {
        if (!whole(element, field)) continue;
        if (field.id === FILE_DATA) data = field;
        if (field.id === FILE_NAME) name = text(dataOf(element, field));
        if (field.id === FILE_MIME_TYPE) mime = text(dataOf(element, field));
      }
      const at = next;
      next += total;
      if (data?.size)
        yield {
          name,
          mime,
          at: at + data.data,
          size: data.size,
          bytes: dataOf(element, data),
          next,
        };
    }
  } finally {
    void cursor.close().catch(() => {});
  }
}

export const isFont = (file: Attachment) =>
  /font|truetype|opentype|sfnt/i.test(file.mime) || FONT_NAME.test(file.name);

/** Null for a file that isn't Matroska or has no subtitle track. `start` is the file's first bytes. */
export async function openMatroska(
  source: ByteReader,
  start: Uint8Array
): Promise<MkvFile | null> {
  const reader = withStart(source, start);
  const ebml = head(start, 0);
  if (!ebml || ebml.id !== EBML || ebml.size < 0) return null;
  let segment: Child | undefined;
  for (const child of children(start, ebml.length + ebml.size, start.length)) {
    if (child.id === SEGMENT) {
      segment = child;
      break;
    }
  }
  if (!segment) return null;
  const segmentAt = segment.data;
  const found = new Map<number, number>();
  const seen: number[] = [];
  const more: number[] = [];
  let firstCluster: number | undefined;
  let after = segmentAt;
  for (const child of children(start, segmentAt, start.length)) {
    if (child.id === CLUSTER) {
      firstCluster = child.at;
      break;
    }
    after = child.size < 0 ? Infinity : child.data + child.size;
    if (child.id !== SEEK_HEAD) {
      if (!found.has(child.id)) found.set(child.id, child.at);
      continue;
    }
    seen.push(child.at);
    if (whole(start, child))
      readSeekHead(dataOf(start, child), segmentAt, found, more);
    else more.push(child.at);
  }
  // A seek head can point at a second one, often at the end of the file.
  for (const at of more.filter((at) => !seen.includes(at)).slice(0, 2)) {
    const bytes = await readElement(reader, at, SEEK_HEAD);
    if (bytes) readSeekHead(bytes, segmentAt, found, []);
  }
  const at = (id: number) => found.get(id);
  const tracksAt = at(TRACKS);
  if (tracksAt === undefined) return null;
  const tracks = await readElement(reader, tracksAt, TRACKS);
  if (!tracks) return null;
  const subtitles = await readTracks(tracks);
  if (!subtitles.length) return null;
  let scaleMs = 1;
  const infoAt = at(INFO);
  const info =
    infoAt === undefined ? null : await readElement(reader, infoAt, INFO);
  if (info) {
    for (const field of children(info, 0, info.length)) {
      if (field.id === TIMESTAMP_SCALE && whole(info, field))
        scaleMs = uint(dataOf(info, field)) / 1e6 || 1;
    }
  }
  const attachmentsAt = at(ATTACHMENTS);
  const cuesAt = at(CUES);
  const cueBytes =
    cuesAt === undefined ? null : await readElement(reader, cuesAt, CUES);
  const index = cueBytes
    ? readCues(cueBytes, segmentAt, scaleMs)
    : { cues: new Map<number, CueEntry[]>(), clusters: [] };
  // Without an index the clusters are walked from the first, which can lie past big attachments.
  for (
    let hops = 0;
    !cueBytes && firstCluster === undefined && hops < 32;
    hops++
  ) {
    if (!Number.isFinite(after)) break;
    const found = head(await readAll(reader, after, 16), 0);
    if (!found || found.size < 0) break;
    if (found.id === CLUSTER) firstCluster = after;
    else after += found.length + found.size;
  }
  return {
    reader,
    scaleMs,
    subtitles,
    attachmentsAt,
    ...index,
    firstCluster,
  };
}
