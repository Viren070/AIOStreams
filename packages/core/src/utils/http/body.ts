import { pipeline, Transform, type Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import zlib from 'node:zlib';
import { BodyInit, Dispatcher, Headers, Response } from 'undici';
import type { RequestHeaders } from './headers.js';

/** Includes the Content-Type a string or form body implies. */
export async function encodeBody(
  body: BodyInit | undefined,
  headers: RequestHeaders
): Promise<Buffer | undefined> {
  if (body == null) return undefined;
  const encoded = new Response(body);
  const contentType = encoded.headers.get('content-type');
  if (contentType && !headers.has('content-type')) {
    headers.set('content-type', contentType);
  }
  return Buffer.from(await encoded.arrayBuffer());
}

// Tolerates truncated streams.
const ZLIB_SYNC = {
  flush: zlib.constants.Z_SYNC_FLUSH,
  finishFlush: zlib.constants.Z_SYNC_FLUSH,
};
const BROTLI_SYNC = {
  flush: zlib.constants.BROTLI_OPERATION_FLUSH,
  finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH,
};
/** `deflate` bodies come zlib-wrapped or raw. */
function createInflate(): Transform {
  let inner: Transform | undefined;
  const outer = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (!inner) {
        if (chunk.length === 0) return callback();
        inner =
          (chunk[0] & 0x0f) === 0x08
            ? zlib.createInflate(ZLIB_SYNC)
            : zlib.createInflateRaw(ZLIB_SYNC);
        inner.on('data', (data) => outer.push(data));
        inner.on('error', (err) => outer.destroy(err));
      }
      inner.write(chunk, callback);
    },
    flush(callback) {
      if (!inner) return callback();
      inner.once('end', () => callback());
      inner.end();
    },
  });
  return outer;
}

const DECODERS: Record<string, () => Transform> = {
  gzip: () => zlib.createGunzip(ZLIB_SYNC),
  'x-gzip': () => zlib.createGunzip(ZLIB_SYNC),
  deflate: createInflate,
  br: () => zlib.createBrotliDecompress(BROTLI_SYNC),
  zstd: () => zlib.createZstdDecompress(),
};
const MAX_CONTENT_CODINGS = 5;

function decodersFor(contentEncoding: string | string[] | undefined) {
  if (typeof contentEncoding !== 'string') return [];
  const codings = contentEncoding.toLowerCase().split(',').reverse();
  if (codings.length > MAX_CONTENT_CODINGS) {
    throw new Error(
      `Too many content-encodings in response: ${codings.length}`
    );
  }
  const decoders: Transform[] = [];
  for (const coding of codings) {
    const decoder = DECODERS[coding.trim()];
    if (!decoder) return [];
    decoders.push(decoder());
  }
  return decoders;
}

/** A bare destroy() emits an error nothing handles. */
export function releaseBody(body: Dispatcher.ResponseData['body']): void {
  body.dump().catch(() => {});
}

const NULL_BODY_STATUSES = [101, 204, 205, 304];
const REASON_PHRASE = /^[\t\x20-\x7e\x80-\xff]*$/;

// Frees the connection under a response nobody reads.
const unread = new FinalizationRegistry<{
  stream: ReadableStream;
  body: Readable;
}>(({ stream, body }) => {
  if (!stream.locked && !body.readableDidRead) {
    body.on('error', () => {}).destroy();
  }
});

export function toResponse(
  method: string,
  { statusCode, statusText, headers, body }: Dispatcher.ResponseData
): Response {
  if (statusCode > 599) {
    releaseBody(body);
    throw new Error(`Unsupported HTTP status ${statusCode}`);
  }
  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      responseHeaders.append(name, item);
    }
  }
  const init = {
    status: statusCode,
    statusText: REASON_PHRASE.test(statusText) ? statusText : '',
    headers: responseHeaders,
  };
  if (method === 'HEAD' || NULL_BODY_STATUSES.includes(statusCode)) {
    releaseBody(body);
    return new Response(null, init);
  }
  let decoders: Transform[];
  try {
    decoders = decodersFor(headers['content-encoding']);
  } catch (err) {
    releaseBody(body);
    throw err;
  }
  if (decoders.length) pipeline([body, ...decoders], () => {});
  const decoded: Readable = decoders.at(-1) ?? body;
  const response = new Response(decoded, init);
  unread.register(response, { stream: response.body!, body: decoded });
  return response;
}
