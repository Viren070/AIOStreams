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

async function readBodyCapped(
  res: Response,
  maxBytes: number
): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    throw new Error(`response exceeds the ${maxBytes} byte limit`);
  }
  if (!res.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new Error(`response exceeds the ${maxBytes} byte limit`);
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
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
