import { isUnsafeRemoteUrl } from './url-safety.js';

const DEFAULT_MAX_REDIRECTS = 5;

export interface FetchRemoteOptions {
  etag?: string | null;
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
}

export type FetchRemoteResult =
  | { notModified: true }
  | { notModified: false; body: Buffer; etag: string | null };

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
 * Fetch an operator-supplied URL with a size cap, following redirects by hand
 * so every hop is re-checked against the SSRF guard. Returns `notModified` on
 * a 304 when an etag was supplied.
 */
export async function fetchRemoteCapped(
  url: string,
  options: FetchRemoteOptions
): Promise<FetchRemoteResult> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (isUnsafeRemoteUrl(current)) {
      throw new Error('URL refused (unsafe scheme or private address)');
    }
    const headers: Record<string, string> = { Accept: '*/*' };
    if (options.etag && current === url)
      headers['If-None-Match'] = options.etag;
    const res = await fetch(current, {
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
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    const body = await readBodyCapped(res, options.maxBytes);
    return { notModified: false, body, etag: res.headers.get('etag') };
  }
  throw new Error('too many redirects');
}
