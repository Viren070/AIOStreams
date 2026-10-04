import { pipeline, Readable, Transform } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { openUsenetFile } from '../usenet/integration/stream-session.js';
import { makeRequest, rewriteRequestUrl } from '../utils/index.js';
import type { UsenetStreamToken } from '../usenet/integration/tokens.js';
import {
  isOwnHostRedirect,
  MIN_PLAUSIBLE_FILE_SIZE,
} from '../main/failover.js';
import type { OpenedFile } from './probe.js';

/** No probe reads more than this from a remote file, however it seeks. */
const HTTP_READ_CAP = 96 * 1024 * 1024;

const VIDEO_EXTENSION = /\.(mkv|mp4|m4v|avi|ts|m2ts|mov|webm|wmv|mpg|mpeg)$/i;

export function engineReader(decoded: UsenetStreamToken): Promise<OpenedFile> {
  return openUsenetFile(decoded);
}

export function contentDispositionName(
  header: string | null
): string | undefined {
  if (!header) return undefined;
  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[2].trim());
    } catch {
      // fall through to the plain form
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || undefined;
}

/** A video file's name in the URL path, as most stores' links carry it. */
function pathName(url: string): string | undefined {
  try {
    const last = new URL(url).pathname.split('/').pop();
    const name = last ? decodeURIComponent(last) : '';
    return VIDEO_EXTENSION.test(name) ? name : undefined;
  } catch {
    return undefined;
  }
}

function totalSize(range: string | null): number | undefined {
  const total = range?.match(/\/\s*(\d+)\s*$/)?.[1];
  return total ? Number(total) : undefined;
}

/**
 * A server that ignores ranges can't be seeked, so it is refused, as is what
 * looks like an addon's error video.
 */
export async function httpReader(
  url: string,
  signal: AbortSignal,
  headers: Record<string, string> = {}
): Promise<OpenedFile> {
  // Through makeRequest, so reads take the instance's proxy and host rules.
  const read = (target: string, range: string, readSignal: AbortSignal) =>
    makeRequest(target, {
      timeout: 0,
      signal: readSignal,
      headers: { ...headers, Range: range },
      ignoreRecursion: true,
    });
  const head = await read(url, 'bytes=0-0', signal);
  await head.body?.cancel().catch(() => undefined);
  const size =
    head.status === 206
      ? totalSize(head.headers.get('content-range'))
      : undefined;
  if (!size) {
    throw new Error(
      `no ranged reads from ${new URL(url).host} (${head.status})`
    );
  }
  const first = rewriteRequestUrl(new URL(url));
  first.hash = '';
  if (head.url !== first.href && isOwnHostRedirect(url, head.url)) {
    throw new Error('redirected to an error video');
  }
  if (size < MIN_PLAUSIBLE_FILE_SIZE) {
    throw new Error(`a ${size}-byte file is too small to be the release`);
  }
  const name =
    contentDispositionName(head.headers.get('content-disposition')) ??
    pathName(head.url) ??
    pathName(url);
  const target = head.url || url;
  let bytesRead = 0;
  return {
    size,
    name,
    open: async (start, end, rangeSignal) => {
      const response = await read(
        target,
        `bytes=${start}-${end - 1}`,
        AbortSignal.any([signal, rangeSignal])
      );
      if (response.status !== 206 || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`range read failed (${response.status})`);
      }
      // Counted in a stage rather than a 'data' listener, which would start
      // the flow before the loopback pipes it and drop the first chunks.
      const counted = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          bytesRead += chunk.length;
          if (bytesRead > HTTP_READ_CAP) done(new Error('read cap reached'));
          else done(null, chunk);
        },
      });
      pipeline(
        Readable.fromWeb(
          response.body as unknown as WebReadableStream<Uint8Array>
        ),
        counted,
        () => undefined
      );
      return counted;
    },
  };
}
