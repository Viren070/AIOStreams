import { isUnsafeRemoteUrl } from './url-safety.js';

const DEFAULT_MAX_REDIRECTS = 5;

export interface FetchRemoteOptions {
  etag?: string | null;
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  method?: 'GET' | 'HEAD';
  /** Skip the SSRF guard. Only for URLs an operator has opted in to. */
  allowPrivateHosts?: boolean;
  /** Defaults to true: a non-2xx response throws rather than being returned. */
  throwOnHttpError?: boolean;
  /** Defaults to true. When false the body is discarded and comes back empty. */
  readBody?: boolean;
}

export type FetchRemoteResult =
  | { notModified: true }
  | { notModified: false; status: number; body: Buffer; etag: string | null };

export interface CappedBody {
  body: Buffer;
  bytes: number;
  /** The body was longer than `maxBytes`; everything past it was dropped. */
  truncated: boolean;
}

/**
 * Reads at most `maxBytes`, then stops and cancels the rest of the stream.
 * Unlike {@link readBodyCapped} an over-long body is not an error: the caller
 * gets the prefix that fit and decides what a partial answer is worth.
 */
export async function readBodyUpTo(
  res: Response,
  maxBytes: number
): Promise<CappedBody> {
  if (!res.body) return { body: Buffer.alloc(0), bytes: 0, truncated: false };
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    const room = maxBytes - total;
    if (chunk.byteLength > room) {
      if (room > 0) {
        chunks.push(Buffer.from(chunk.subarray(0, room)));
        total += room;
      }
      truncated = true;
      // Leaving the loop cancels the underlying stream.
      break;
    }
    chunks.push(Buffer.from(chunk));
    total += chunk.byteLength;
  }
  return { body: Buffer.concat(chunks, total), bytes: total, truncated };
}

/**
 * Reads a response body, refusing it above `maxBytes` on the declared length
 * and again as the bytes arrive. Throws rather than truncating, so a caller
 * cannot mistake a short read for a complete answer.
 */
export async function readBodyCapped(
  res: Response,
  maxBytes: number
): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    throw new Error(`response exceeds the ${maxBytes} byte limit`);
  }
  const { body, truncated } = await readBodyUpTo(res, maxBytes);
  if (truncated) {
    throw new Error(`response exceeds the ${maxBytes} byte limit`);
  }
  return body;
}

/**
 * Fetch a URL with a size cap, following redirects by hand so every hop is
 * re-checked against the SSRF guard, unless an operator has opted this URL out
 * of it. Returns `notModified` on a 304 when an etag was supplied.
 */
export async function fetchRemoteCapped(
  url: string,
  options: FetchRemoteOptions
): Promise<FetchRemoteResult> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!options.allowPrivateHosts && isUnsafeRemoteUrl(current)) {
      throw new Error('URL refused (unsafe scheme or private address)');
    }
    const headers: Record<string, string> = { Accept: '*/*' };
    if (options.etag && current === url)
      headers['If-None-Match'] = options.etag;
    const res = await fetch(current, {
      method: options.method ?? 'GET',
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs),
    });

    if (res.status === 304) {
      await res.body?.cancel().catch(() => {});
      return { notModified: true };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await res.body?.cancel().catch(() => {});
      if (!location)
        throw new Error(`redirect without location (${res.status})`);
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok && options.throwOnHttpError !== false) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    let body: Buffer = Buffer.alloc(0);
    if (options.readBody === false || options.method === 'HEAD') {
      await res.body?.cancel().catch(() => {});
    } else {
      body = await readBodyCapped(res, options.maxBytes);
    }
    return {
      notModified: false,
      status: res.status,
      body,
      etag: res.headers.get('etag'),
    };
  }
  throw new Error('too many redirects');
}
