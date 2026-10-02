import type { ShrinkJob, ShrinkReply } from './artwork';

const scope = self as unknown as Worker;

/** Decoding to about this much over the box keeps the filtered last step sharp. */
const HEADROOM = 1.5;

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
    return { type: 'image/webp' };
  if (tag.slice(4, 12) === 'ftypavif') return { type: 'image/avif' };
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
  const sw = width / scale;
  const sh = height / scale;
  return [(w - sw) / 2, (h - sh) / 2, sw, sh] as const;
}

async function shrink({
  id,
  url,
  width,
  height,
}: ShrinkJob): Promise<ShrinkReply> {
  if (typeof OffscreenCanvas !== 'function')
    return { id, error: 'no OffscreenCanvas', unsupported: true };
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    // Usually a host that does not allow reading its images across origins.
    return { id, error: String(err), blocked: true };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.arrayBuffer();
  const head = sniff(new Uint8Array(data, 0, Math.min(data.byteLength, 65536)));
  if (!head) throw new Error('unknown image type');

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
  try {
    const canvas = new OffscreenCanvas(width, height);
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
    return { id, bitmap: canvas.transferToImageBitmap() };
  } finally {
    image.close();
  }
}

scope.onmessage = (e: MessageEvent<ShrinkJob>) => {
  shrink(e.data).then(
    (reply) => scope.postMessage(reply, reply.bitmap ? [reply.bitmap] : []),
    (err) =>
      scope.postMessage({
        id: e.data.id,
        error: String(err),
      } satisfies ShrinkReply)
  );
};
