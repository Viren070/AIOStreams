import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { TextDecoder } from 'node:util';
import { createGunzip } from 'node:zlib';
import { makeRequest } from '../../utils/index.js';
import { config as appConfig } from '../../config/index.js';

/** Least bytes per piece, as the XMLTV reader copies its leftover on each. */
const PIECE_BYTES = 16 * 1024;

/** Compressions refused rather than read as text. */
const UNSUPPORTED: [Buffer, string][] = [
  [Buffer.from('fd377a585a00', 'hex'), 'xz'],
  [Buffer.from('504b0304', 'hex'), 'zip'],
];

const LIMITS = {
  playlist: () => ({
    timeout: appConfig.builtins.m3u.timeout,
    timeoutEnv: 'BUILTIN_M3U_TIMEOUT',
    maxBytes: appConfig.builtins.m3u.playlistMaxBytes,
    maxBytesEnv: 'BUILTIN_M3U_PLAYLIST_MAX_BYTES',
  }),
  guide: () => ({
    timeout: appConfig.builtins.m3u.guideTimeout,
    timeoutEnv: 'BUILTIN_M3U_GUIDE_TIMEOUT',
    maxBytes: appConfig.builtins.m3u.guideMaxBytes,
    maxBytesEnv: 'BUILTIN_M3U_GUIDE_MAX_BYTES',
  }),
};

export class TooLargeError extends Error {
  constructor(maxBytes: number, env: string) {
    super(`larger than ${maxBytes} bytes, past ${env}`);
  }
}

/**
 * A download chunk by chunk: gunzipped when it is gzip, whatever its name, and
 * refused once past `maxBytes`, compressed or not.
 */
export async function* download(
  url: string,
  kind: keyof typeof LIMITS
): AsyncGenerator<Buffer> {
  const { timeout, timeoutEnv, maxBytes, maxBytesEnv } = LIMITS[kind]();
  const abort = new AbortController();
  const deadline = AbortSignal.timeout(timeout);
  try {
    const res = await makeRequest(url, {
      timeout,
      signal: AbortSignal.any([abort.signal, deadline]),
      headers: {
        'User-Agent':
          appConfig.builtins.m3u.userAgent ?? appConfig.http.defaultUserAgent,
      },
    });
    if (!res.ok) throw new Error(`answered ${res.status}`);
    if (Number(res.headers.get('content-length')) > maxBytes)
      throw new TooLargeError(maxBytes, maxBytesEnv);
    if (!res.body) return;
    const body = Readable.fromWeb(
      res.body as Parameters<typeof Readable.fromWeb>[0]
    );
    const it = body[Symbol.asyncIterator]();
    let head = Buffer.alloc(0);
    // Enough for the magic bytes, which a first chunk may split.
    while (head.length < 6) {
      const next = await it.next();
      if (next.done) break;
      head = Buffer.concat([head, next.value as Buffer]);
    }
    if (!head.length) return;
    for (const [magic, name] of UNSUPPORTED)
      if (head.subarray(0, magic.length).equals(magic))
        throw new Error(`${name}-compressed, which isn't supported; gzip is`);
    const raw = (async function* () {
      yield head;
      for (let next = await it.next(); !next.done; next = await it.next())
        yield next.value as Buffer;
    })();
    let bytes: AsyncIterable<Buffer> = raw;
    if (head[0] === 0x1f && head[1] === 0x8b) {
      const gunzip = createGunzip();
      // Its failures reach the reader through the gunzip stream.
      void pipeline(raw, gunzip).catch(() => undefined);
      bytes = gunzip;
    }
    let total = 0;
    let pieces: Buffer[] = [];
    let size = 0;
    for await (const chunk of bytes) {
      total += chunk.byteLength;
      if (total > maxBytes) throw new TooLargeError(maxBytes, maxBytesEnv);
      pieces.push(chunk);
      size += chunk.byteLength;
      if (size < PIECE_BYTES) continue;
      yield Buffer.concat(pieces, size);
      pieces = [];
      size = 0;
    }
    if (size) yield Buffer.concat(pieces, size);
  } catch (err) {
    if (deadline.aborted)
      throw new Error(`took over ${timeout} ms, past ${timeoutEnv}`);
    throw err;
  } finally {
    // Ends the download wherever reading stopped.
    abort.abort();
  }
}

/** The encoding an XML declaration names, as TextDecoder knows it; UTF-8 without one. */
function xmlEncoding(head: Buffer): string {
  const label = /<\?xml[^>]*?encoding\s*=\s*["']([^"']+)["']/.exec(
    head.toString('latin1', 0, 256)
  )?.[1];
  try {
    return new TextDecoder(label).encoding;
  } catch {
    return 'utf-8';
  }
}

/** Bytes as text: UTF-8, as playlists are, or an XML document's own encoding. */
export async function* textOf(
  chunks: AsyncIterable<Buffer>,
  xml = false
): AsyncGenerator<string> {
  let decoder: TextDecoder | undefined;
  for await (const chunk of chunks) {
    decoder ??= new TextDecoder(xml ? xmlEncoding(chunk) : 'utf-8');
    yield decoder.decode(chunk, { stream: true });
  }
  if (decoder) yield decoder.decode();
}

/** Longer lines are skipped, as splitting one could take much memory. */
const MAX_LINE = 64 * 1024;

/** Text chunks as lines, without their line ends. */
export async function* linesOf(
  chunks: AsyncIterable<string>
): AsyncGenerator<string> {
  let rest = '';
  for await (const chunk of chunks) {
    // Only the new chunk is searched, however long the line so far.
    const lines = chunk.split(/\r?\n|\r/);
    lines[0] = rest + lines[0];
    // A line past the limit keeps only enough to stay past it.
    rest = lines.pop()!.slice(0, MAX_LINE + 1);
    for (const line of lines) if (line.length <= MAX_LINE) yield line;
  }
  if (rest && rest.length <= MAX_LINE) yield rest;
}
