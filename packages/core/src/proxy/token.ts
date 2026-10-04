import { z } from 'zod';
import { decryptString, fromUrlSafeBase64 } from '../utils/index.js';

export const ProxyDataSchema = z.object({
  url: z.url(),
  filename: z.string().optional(),
  type: z.enum(['nzb', 'stream']).optional(),
  // These are optional, as we'll be forwarding client headers
  requestHeaders: z.record(z.string(), z.string()).optional(),
  responseHeaders: z.record(z.string(), z.string()).optional(),
  /** The release a proxied stream plays, so its play can be probed. */
  mediaInfo: z
    .object({
      keys: z.array(z.string().max(80)).min(1).max(4),
      file: z.string().max(1024).optional(),
    })
    .optional(),
});
export type ProxyData = z.infer<typeof ProxyDataSchema>;

export function decodeProxyToken(
  token: string
): { rawAuth: string; rawData: string; encrypted: boolean } | null {
  const parts = token.split('.');
  let encodedAuth: string;
  let encodedData: string;
  let mode: 'e' | 'u';
  if (parts.length === 2) {
    mode = 'e';
    [encodedAuth, encodedData] = parts;
  } else if (parts.length === 3) {
    mode = parts[0] as 'e' | 'u';
    [, encodedAuth, encodedData] = parts;
  } else {
    return null;
  }

  const decode = (s: string) =>
    mode === 'e' ? decryptString(s).data : fromUrlSafeBase64(s);
  const rawAuth = decode(encodedAuth);
  const rawData = decode(encodedData);
  return rawAuth && rawData
    ? { rawAuth, rawData, encrypted: mode === 'e' }
    : null;
}

/** The upstream URL behind one of our proxy URLs, or the URL itself. */
export function unwrapProxyUrl(url: string): string {
  if (!url.includes('/proxy/')) return url;
  try {
    const segments = new URL(url).pathname.split('/');
    const token = segments[segments.indexOf('proxy') + 1];
    if (!token) return url;
    const decoded = decodeProxyToken(token);
    if (!decoded) return url;
    const data = ProxyDataSchema.safeParse(JSON.parse(decoded.rawData));
    return data.success ? data.data.url : url;
  } catch {
    return url;
  }
}
