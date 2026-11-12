/** Blu-ray picture subtitles. Each block holds a display set: what shows from its time until the next set, with palettes and pictures the later sets of its epoch may reuse. */

const PALETTE = 0x14;
const OBJECT = 0x15;
const COMPOSITION = 0x16;
const EPOCH_START = 0x80;
const FIRST_FRAGMENT = 0x80;

interface Placed {
  objectId: number;
  x: number;
  y: number;
  crop?: { x: number; y: number; width: number; height: number };
}

interface Composition {
  width: number;
  height: number;
  epochStart: boolean;
  paletteId: number;
  placed: Placed[];
}

interface Picture {
  width: number;
  height: number;
  rle: Uint8Array;
}

export interface DisplaySet {
  composition: Composition | null;
  /** Y, Cr, Cb and alpha by palette id and entry. */
  palettes: Map<number, Map<number, [number, number, number, number]>>;
  pictures: Map<number, Picture>;
}

/** In the video's pixels. */
export interface ShownPicture {
  x: number;
  y: number;
  width: number;
  height: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

export function parseDisplaySet(bytes: Uint8Array): DisplaySet {
  const set: DisplaySet = {
    composition: null,
    palettes: new Map(),
    pictures: new Map(),
  };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Joined once the set is read.
  const fragments = new Map<
    number,
    { width: number; height: number; parts: Uint8Array[] }
  >();
  for (let at = 0; at + 3 <= bytes.length;) {
    const type = bytes[at];
    const size = view.getUint16(at + 1);
    const start = at + 3;
    const end = Math.min(start + size, bytes.length);
    at = end;
    if (type === COMPOSITION && end - start >= 11) {
      const count = bytes[start + 10];
      const placed: Placed[] = [];
      for (let i = 0, p = start + 11; i < count && p + 8 <= end; i++) {
        // 0x80 cropped, 0x40 forced.
        const cropped = (bytes[p + 3] & 0x80) !== 0;
        placed.push({
          objectId: view.getUint16(p),
          x: view.getUint16(p + 4),
          y: view.getUint16(p + 6),
          ...(cropped &&
            p + 16 <= end && {
              crop: {
                x: view.getUint16(p + 8),
                y: view.getUint16(p + 10),
                width: view.getUint16(p + 12),
                height: view.getUint16(p + 14),
              },
            }),
        });
        p += cropped ? 16 : 8;
      }
      set.composition = {
        width: view.getUint16(start),
        height: view.getUint16(start + 2),
        epochStart: (bytes[start + 7] & EPOCH_START) !== 0,
        paletteId: bytes[start + 9],
        placed,
      };
    } else if (type === PALETTE && end - start >= 2) {
      const entries = new Map<number, [number, number, number, number]>();
      for (let p = start + 2; p + 5 <= end; p += 5)
        entries.set(bytes[p], [
          bytes[p + 1],
          bytes[p + 2],
          bytes[p + 3],
          bytes[p + 4],
        ]);
      set.palettes.set(bytes[start], entries);
    } else if (type === OBJECT && end - start >= 4) {
      const id = view.getUint16(start);
      if (bytes[start + 3] & FIRST_FRAGMENT) {
        if (end - start < 11) continue;
        fragments.set(id, {
          width: view.getUint16(start + 7),
          height: view.getUint16(start + 9),
          parts: [bytes.subarray(start + 11, end)],
        });
      } else fragments.get(id)?.parts.push(bytes.subarray(start + 4, end));
    }
  }
  for (const [id, { width, height, parts }] of fragments) {
    const length = parts.reduce((n, part) => n + part.length, 0);
    const rle = new Uint8Array(length);
    let at = 0;
    for (const part of parts) {
      rle.set(part, at);
      at += part.length;
    }
    set.pictures.set(id, { width, height, rle });
  }
  return set;
}

/** RGBA pixels in little-endian memory order; limited range, BT.709 above SD. */
function colours(
  entries: Map<number, [number, number, number, number]>,
  hd: boolean
): Uint32Array {
  const out = new Uint32Array(256);
  const [rv, gu, gv, bu] = hd
    ? [1.793, 0.213, 0.533, 2.112]
    : [1.596, 0.392, 0.813, 2.017];
  // Rounds and clamps as a canvas's bytes do.
  const clamp = new Uint8ClampedArray(1);
  const byte = (v: number) => ((clamp[0] = v), clamp[0]);
  for (const [index, [y, cr, cb, alpha]] of entries) {
    const l = 1.164 * (y - 16);
    out[index] =
      (byte(l + rv * (cr - 128)) |
        (byte(l - gu * (cb - 128) - gv * (cr - 128)) << 8) |
        (byte(l + bu * (cb - 128)) << 16) |
        (alpha << 24)) >>>
      0;
  }
  return out;
}

function decode(picture: Picture, palette: Uint32Array): Uint32Array {
  const { width, height, rle } = picture;
  const pixels = new Uint32Array(width * height);
  let x = 0;
  let row = 0;
  for (let i = 0; i < rle.length && row < width * height;) {
    const byte = rle[i++];
    if (byte) {
      if (x < width) pixels[row + x] = palette[byte];
      x++;
      continue;
    }
    const flags = rle[i++] ?? 0;
    if (!flags) {
      x = 0;
      row += width;
      continue;
    }
    const length =
      flags & 0x40 ? ((flags & 0x3f) << 8) | (rle[i++] ?? 0) : flags & 0x3f;
    const colour = palette[flags & 0x80 ? (rle[i++] ?? 0) : 0];
    const end = Math.min(x + length, width);
    if (colour) pixels.fill(colour, row + x, row + end);
    x += length;
  }
  return pixels;
}

function cropped(
  pixels: Uint32Array,
  width: number,
  crop: NonNullable<Placed['crop']>
): Uint32Array {
  const out = new Uint32Array(crop.width * crop.height);
  for (let row = 0; row < crop.height; row++) {
    const from = (crop.y + row) * width + crop.x;
    out.set(pixels.subarray(from, from + crop.width), row * crop.width);
  }
  return out;
}

const bytesOf = (pixels: Uint32Array) =>
  new Uint8ClampedArray(pixels.buffer as ArrayBuffer);

/** `sets` in time order; the earlier sets of the epoch supply palettes and pictures. */
export function shownPictures(
  sets: DisplaySet[],
  at: number
): { width: number; height: number; pictures: ShownPicture[] } | null {
  const composition = sets[at]?.composition;
  if (!composition?.placed.length) return null;
  let from = at;
  while (from > 0 && !sets[from].composition?.epochStart) from--;
  const entries = new Map<number, [number, number, number, number]>();
  const pictures = new Map<number, Picture>();
  for (let i = from; i <= at; i++) {
    for (const [index, entry] of sets[i].palettes.get(composition.paletteId) ??
      [])
      entries.set(index, entry);
    for (const [id, picture] of sets[i].pictures) pictures.set(id, picture);
  }
  const palette = colours(entries, composition.height > 576);
  const shown: ShownPicture[] = [];
  for (const placed of composition.placed) {
    const picture = pictures.get(placed.objectId);
    if (!picture?.width || !picture.height) continue;
    const pixels = decode(picture, palette);
    const crop = placed.crop;
    const fits =
      crop &&
      crop.width > 0 &&
      crop.height > 0 &&
      crop.x + crop.width <= picture.width &&
      crop.y + crop.height <= picture.height;
    shown.push(
      fits
        ? {
            x: placed.x,
            y: placed.y,
            width: crop.width,
            height: crop.height,
            rgba: bytesOf(cropped(pixels, picture.width, crop)),
          }
        : {
            x: placed.x,
            y: placed.y,
            width: picture.width,
            height: picture.height,
            rgba: bytesOf(pixels),
          }
    );
  }
  return {
    width: composition.width,
    height: composition.height,
    pictures: shown,
  };
}

export function startsEpoch(bytes: Uint8Array): boolean {
  for (let at = 0; at + 3 <= bytes.length;) {
    if (bytes[at] === COMPOSITION)
      return at + 10 < bytes.length && (bytes[at + 10] & EPOCH_START) !== 0;
    at += 3 + ((bytes[at + 1] << 8) | bytes[at + 2]);
  }
  return false;
}
