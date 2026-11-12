export const EBML = 0x1a45dfa3;
export const SEGMENT = 0x18538067;
export const SEEK_HEAD = 0x114d9b74;
export const SEEK = 0x4dbb;
export const SEEK_ID = 0x53ab;
export const SEEK_POSITION = 0x53ac;
export const INFO = 0x1549a966;
export const TIMESTAMP_SCALE = 0x2ad7b1;
export const TRACKS = 0x1654ae6b;
export const TRACK_ENTRY = 0xae;
export const TRACK_NUMBER = 0xd7;
export const TRACK_TYPE = 0x83;
export const CODEC_ID = 0x86;
export const CODEC_PRIVATE = 0x63a2;
export const LANGUAGE = 0x22b59c;
export const LANGUAGE_BCP47 = 0x22b59d;
export const NAME = 0x536e;
export const FLAG_DEFAULT = 0x88;
export const FLAG_FORCED = 0x55aa;
export const FLAG_HEARING_IMPAIRED = 0x55ab;
export const CONTENT_ENCODINGS = 0x6d80;
export const CONTENT_ENCODING = 0x6240;
export const CONTENT_ENCODING_SCOPE = 0x5032;
export const CONTENT_ENCODING_TYPE = 0x5033;
export const CONTENT_COMPRESSION = 0x5034;
export const CONTENT_COMP_ALGO = 0x4254;
export const CONTENT_COMP_SETTINGS = 0x4255;
export const ATTACHMENTS = 0x1941a469;
export const ATTACHED_FILE = 0x61a7;
export const FILE_NAME = 0x466e;
export const FILE_MIME_TYPE = 0x4660;
export const FILE_DATA = 0x465c;
export const CUES = 0x1c53bb6b;
export const CUE_POINT = 0xbb;
export const CUE_TIME = 0xb3;
export const CUE_TRACK_POSITIONS = 0xb7;
export const CUE_TRACK = 0xf7;
export const CUE_CLUSTER_POSITION = 0xf1;
export const CUE_RELATIVE_POSITION = 0xf0;
export const CUE_DURATION = 0xb2;
export const CLUSTER = 0x1f43b675;
export const TIMESTAMP = 0xe7;
export const SIMPLE_BLOCK = 0xa3;
export const BLOCK_GROUP = 0xa0;
export const BLOCK = 0xa1;
export const BLOCK_DURATION = 0x9b;
export const SUBTITLE_TRACK = 0x11;

export interface Head {
  id: number;
  /** -1 when the file leaves it unknown. */
  size: number;
  /** Bytes the id and size take. */
  length: number;
}

export interface Child extends Head {
  /** In the bytes it was read from. */
  at: number;
  data: number;
}

export function vint(
  bytes: Uint8Array,
  at: number,
  marker: boolean
): [value: number, length: number] | null {
  const first = bytes[at];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (!(first & (0x80 >> (length - 1)))) length++;
  if (at + length > bytes.length) return null;
  const mask = 0xff >> length;
  let value = marker ? first : first & mask;
  let unknown = !marker && (first & mask) === mask;
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[at + i];
    if (bytes[at + i] !== 0xff) unknown = false;
  }
  return [unknown ? -1 : value, length];
}

export function head(bytes: Uint8Array, at: number): Head | null {
  const id = vint(bytes, at, true);
  if (!id || id[1] > 4) return null;
  const size = vint(bytes, at + id[1], false);
  if (!size) return null;
  return { id: id[0], size: size[0], length: id[1] + size[1] };
}

/** Stops after one of unknown size. */
export function* children(
  bytes: Uint8Array,
  from: number,
  to: number
): Generator<Child> {
  let at = from;
  while (at < to) {
    const found = head(bytes, at);
    if (!found) return;
    yield { ...found, at, data: at + found.length };
    if (found.size < 0) return;
    at += found.length + found.size;
  }
}

export const whole = (bytes: Uint8Array, child: Child) =>
  child.size >= 0 && child.data + child.size <= bytes.length;

export const dataOf = (bytes: Uint8Array, child: Child) =>
  bytes.subarray(child.data, child.data + Math.max(child.size, 0));

export function uint(bytes: Uint8Array): number {
  let value = 0;
  for (const byte of bytes) value = value * 256 + byte;
  return value;
}

const utf8 = new TextDecoder('utf-8');

export const text = (bytes: Uint8Array) =>
  utf8.decode(bytes).replace(/\0+$/, '');
