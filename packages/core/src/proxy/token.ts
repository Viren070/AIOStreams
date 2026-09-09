import { z } from 'zod';
import { decryptString, fromUrlSafeBase64 } from '../utils/index.js';

export const ProxyDataSchema = z.object({
  url: z.url(),
  filename: z.string().optional(),
  type: z.enum(['nzb', 'stream']).optional(),
  // These are optional, as we'll be forwarding client headers
  requestHeaders: z.record(z.string(), z.string()).optional(),
  responseHeaders: z.record(z.string(), z.string()).optional(),
});
export type ProxyData = z.infer<typeof ProxyDataSchema>;

/** Decodes a `{mode}.{auth}.{data}` (or legacy `{auth}.{data}`, mode 'e') proxy path segment. Null on any malformed input. */
export function decodeProxyToken(
  token: string
): { rawAuth: string; rawData: string } | null {
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
  return rawAuth && rawData ? { rawAuth, rawData } : null;
}
