import type { ShrinkJob, ShrinkReply } from './artwork';
import { readImage, writeImage } from './cache/store';

const scope = self as unknown as Worker;

/** Decoding to about this much over the box keeps the filtered last step sharp. */
const HEADROOM = 1.5;
/** An image no larger than this over its box is drawn as it is, which shrinks it cleanly. */
const PLAIN = 1.5;

interface Head {
  type: string;
  width?: number;
  height?: number;
}

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    )
      return {
        height: (b[i + 5] << 8) | b[i + 6],
        width: (b[i + 7] << 8) | b[i + 8],
      };
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return null;
}

function webpSize(b: Uint8Array): { width: number; height: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  switch (String.fromCharCode(...b.subarray(12, 16))) {
    case 'VP8X':
      return {
        width: 1 + (v.getUint32(24, true) & 0xffffff),
        height: 1 + (v.getUint32(27, true) & 0xffffff),
      };
    case 'VP8 ':
      return {
        width: v.getUint16(26, true) & 0x3fff,
        height: v.getUint16(28, true) & 0x3fff,
      };
    case 'VP8L': {
      const bits = v.getUint32(21, true);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
  }
  return null;
}

/** From the first image spatial extents box. */
function avifSize(b: Uint8Array): { width: number; height: number } | null {
  for (let i = 4; i + 16 <= b.length; i++) {
    if (
      b[i] !== 0x69 ||
      b[i + 1] !== 0x73 ||
      b[i + 2] !== 0x70 ||
      b[i + 3] !== 0x65
    )
      continue;
    const v = new DataView(b.buffer, b.byteOffset + i + 8, 8);
    return { width: v.getUint32(0), height: v.getUint32(4) };
  }
  return null;
}

// The type is read from the bytes, as image hosts often send a generic one.
function sniff(b: Uint8Array): Head | null {
  if (b[0] === 0xff && b[1] === 0xd8)
    return { type: 'image/jpeg', ...jpegSize(b) };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset);
    return {
      type: 'image/png',
      width: v.getUint32(16),
      height: v.getUint32(20),
    };
  }
  const tag = String.fromCharCode(...b.subarray(0, 12));
  if (tag.startsWith('RIFF') && tag.endsWith('WEBP'))
    return { type: 'image/webp', ...webpSize(b) };
  if (tag.slice(4, 12) === 'ftypavif')
    return { type: 'image/avif', ...avifSize(b) };
  return null;
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decode(
  data: ArrayBuffer,
  type: string,
  size?: { width: number; height: number }
): Promise<Decoded> {
  // Without ImageDecoder there is no reduced-size decode, only a whole one.
  if (typeof ImageDecoder !== 'function') {
    const bitmap = await createImageBitmap(new Blob([data], { type }));
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }
  const decoder = new ImageDecoder({
    data,
    type,
    ...(size && { desiredWidth: size.width, desiredHeight: size.height }),
  });
  try {
    const { image } = await decoder.decode();
    return {
      source: image,
      width: image.displayWidth,
      height: image.displayHeight,
      close: () => image.close(),
    };
  } finally {
    decoder.close();
  }
}

/** The source rectangle `object-fit: cover` shows of a `w`x`h` image in the box. */
function cover(w: number, h: number, width: number, height: number) {
  const scale = Math.max(width / w, height / h);
  // WebKit draws nothing for a source rectangle a rounding error past the image.
  const sw = Math.min(w, width / scale);
  const sh = Math.min(h, height / scale);
  return [(w - sw) / 2, (h - sh) / 2, sw, sh] as const;
}

async function load(
  url: string,
  accept: string
): Promise<ArrayBuffer | Omit<ShrinkReply, 'id'>> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: accept } });
  } catch (err) {
    // Usually a host that does not allow reading its images across origins.
    return { error: String(err), blocked: true };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

async function shrink({
  id,
  url,
  width,
  height,
  save,
  look,
  accept,
}: ShrinkJob): Promise<ShrinkReply> {
  if (typeof OffscreenCanvas !== 'function')
    return { id, error: 'no OffscreenCanvas', unsupported: true };
  const kept = look ? await readImage(url).catch(() => null) : null;
  const data = kept ? await kept.blob.arrayBuffer() : await load(url, accept);
  if (!(data instanceof ArrayBuffer)) return { id, ...data };
  const head = sniff(new Uint8Array(data, 0, Math.min(data.byteLength, 65536)));
  if (!head) throw new Error('unknown image type');
  // Saved alongside, so drawing never waits on the disk.
  if (save && !kept)
    void writeImage(url, head.type, data).then(
      () => scope.postMessage({ id: -1, saved: url } satisfies ShrinkReply),
      () => undefined
    );

  // Mostly a server's rendition near the box's size, which an `<img>` decodes
  // when shown and can let go of again, unlike a canvas.
  if (
    head.width &&
    head.height &&
    Math.min(head.width / width, head.height / height) <= PLAIN
  )
    return {
      id,
      src: URL.createObjectURL(new Blob([data], { type: head.type })),
      bytes: data.byteLength,
    };

  let size: { width: number; height: number } | undefined;
  if (head.type === 'image/jpeg' && head.width && head.height) {
    // JPEG decodes in eighths and rounds a requested size down, so ask for the eighth above.
    const need = Math.min(
      1,
      Math.max(width / head.width, height / head.height) * HEADROOM
    );
    const eighths = Math.ceil(need * 8 - 1e-9);
    if (eighths < 8)
      size = {
        width: Math.ceil((head.width * eighths) / 8),
        height: Math.ceil((head.height * eighths) / 8),
      };
  }
  // Some JPEGs fail to decode at a reduced size but decode whole.
  const image = await decode(data, head.type, size).catch((err) =>
    size ? decode(data, head.type) : Promise.reject(err)
  );
  const canvas = new OffscreenCanvas(width, height);
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { id, error: 'no 2d context', unsupported: true };
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      image.source,
      ...cover(image.width, image.height, width, height),
      0,
      0,
      width,
      height
    );
  } finally {
    image.close();
  }
  const bitmap = await createImageBitmap(canvas);
  later.push({ url, width, height, canvas });
  if (later.length > LATER_MAX) later.shift();
  return { id, bitmap };
}

/**
 * Shrunk images waiting for a small encoded copy, made only while no image
 * waits on this worker, so a page can swap its canvases for images it keeps.
 */
const later: {
  url: string;
  width: number;
  height: number;
  canvas: OffscreenCanvas;
}[] = [];
const LATER_MAX = 60;
let active = 0;
let encoding = false;

async function encodeLater() {
  if (encoding) return;
  encoding = true;
  try {
    while (active === 0 && later.length) {
      const { url, width, height, canvas } = later.shift()!;
      const blob = await canvas
        .convertToBlob({ type: 'image/webp', quality: 0.92 })
        .catch(() => null);
      if (!blob) continue;
      scope.postMessage({
        id: -1,
        encoded: {
          url,
          width,
          height,
          src: URL.createObjectURL(blob),
          bytes: blob.size,
        },
      } satisfies ShrinkReply);
    }
  } finally {
    encoding = false;
  }
}

scope.onmessage = (e: MessageEvent<ShrinkJob | { revoke: string }>) => {
  // An address made here, which the page no longer shows.
  if ('revoke' in e.data) return URL.revokeObjectURL(e.data.revoke);
  const job = e.data;
  active++;
  shrink(job)
    .then(
      (reply) => scope.postMessage(reply, reply.bitmap ? [reply.bitmap] : []),
      (err) =>
        scope.postMessage({
          id: job.id,
          error: String(err),
        } satisfies ShrinkReply)
    )
    .finally(() => {
      active--;
      if (!active) void encodeLater();
    });
};
