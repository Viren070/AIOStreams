import { deflateSync, inflateSync } from 'node:zlib';

export const NEWSHOSTING_MAX_FRAME_BYTES = 16 * 1024 * 1024;

export function encodeNewshostingFrame(xml: string): Buffer {
  const xmlBytes = Buffer.from(xml, 'utf8');
  const compressed = deflateSync(xmlBytes);
  const body = Buffer.allocUnsafe(4 + compressed.length);
  body.writeUInt32BE(xmlBytes.length, 0);
  compressed.copy(body, 4);
  return Buffer.concat([Buffer.from(`C${body.length}\r\n`, 'ascii'), body]);
}

async function readExactly(
  stream: NodeJS.ReadableStream,
  size: number,
  timeoutMs: number
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  while (total < size) {
    const chunk = stream.read() as Buffer | null;
    if (chunk) {
      const remaining = size - total;
      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        total += remaining;
        const unread = chunk.subarray(remaining);
        const pushback = stream as NodeJS.ReadableStream & {
          unshift?: (value: Buffer) => void;
        };
        if (!pushback.unshift) {
          throw new Error('newshosting_stream_cannot_unshift');
        }
        pushback.unshift(unread);
      } else {
        chunks.push(chunk);
        total += chunk.length;
      }
      continue;
    }

    await new Promise<void>((resolve, reject) => {
      const onReadable = () => cleanup(resolve);
      const onError = (error: Error) => cleanup(() => reject(error));
      const onEnd = () =>
        cleanup(() => reject(new Error('newshosting_stream_ended')));
      const onTimeout = () =>
        cleanup(() => reject(new Error('newshosting_read_timeout')));
      const cleanup = (done: () => void) => {
        clearTimeout(timeout);
        stream.off('readable', onReadable);
        stream.off('error', onError);
        stream.off('end', onEnd);
        done();
      };
      const timeout = setTimeout(onTimeout, timeoutMs);
      stream.once('readable', onReadable);
      stream.once('error', onError);
      stream.once('end', onEnd);
    });
  }

  return Buffer.concat(chunks, total);
}

export async function decodeNewshostingFrame(
  stream: NodeJS.ReadableStream,
  timeoutMs = 25_000
): Promise<string> {
  const headerBytes: number[] = [];
  while (true) {
    const byte = await readExactly(stream, 1, timeoutMs);
    headerBytes.push(byte[0]);
    if (
      headerBytes.length >= 2 &&
      headerBytes.at(-2) === 13 &&
      headerBytes.at(-1) === 10
    ) {
      break;
    }
    if (headerBytes.length > 32) {
      throw new Error('newshosting_invalid_frame_header');
    }
  }

  const header = Buffer.from(headerBytes.slice(0, -2))
    .toString('ascii')
    .trim();
  const bodyLength = Number.parseInt(
    header.startsWith('C') ? header.slice(1) : header,
    10
  );
  if (!Number.isFinite(bodyLength) || bodyLength <= 4) {
    throw new Error('newshosting_invalid_frame_length');
  }
  if (bodyLength > NEWSHOSTING_MAX_FRAME_BYTES) {
    throw new Error('newshosting_frame_too_large');
  }

  const body = await readExactly(stream, bodyLength, timeoutMs);
  const uncompressedLength = body.readUInt32BE(0);
  if (uncompressedLength > NEWSHOSTING_MAX_FRAME_BYTES) {
    throw new Error('newshosting_frame_too_large');
  }
  const inflated = inflateSync(body.subarray(4));
  if (inflated.length !== uncompressedLength) {
    throw new Error('newshosting_invalid_uncompressed_length');
  }
  return inflated.toString('utf8');
}
