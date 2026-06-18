import {
  fromUrlSafeBase64,
  encryptString,
  decryptString,
} from '../../utils/index.js';

/** Decoded payload of a native usenet stream token. */
export interface UsenetStreamToken {
  /** Source NZB URL to fetch + parse. */
  nzb: string;
  /** Stable content hash (for caching + health keys). */
  hash: string;
  /** Selected file index within the NZB, if known at resolve time. */
  fileIndex?: number;
  /** Inner path when the selected file lives inside an archive (RAR/7z). */
  innerPath?: string;
  /** Best-effort display filename. */
  filename: string;
}

/**
 * Encrypt a {@link UsenetStreamToken} for embedding in a byte-serving URL. The
 * token is encrypted (not just base64) because it contains the source NZB URL
 * and must not be tamperable by clients.
 */
export function encodeUsenetStreamToken(token: UsenetStreamToken): string {
  const enc = encryptString(JSON.stringify(token));
  if (!enc.success) {
    throw new Error('failed to encrypt usenet stream token');
  }
  return enc.data;
}

/** Inverse of {@link encodeUsenetStreamToken}. Returns undefined on failure. */
export function decodeUsenetStreamToken(
  token: string
): UsenetStreamToken | undefined {
  const dec = decryptString(token);
  if (!dec.success || dec.data == null) return undefined;
  try {
    return JSON.parse(dec.data) as UsenetStreamToken;
  } catch {
    return undefined;
  }
}

/**
 * Parse a native usenet service credential: base64(JSON({ aiostreamsAuth })),
 * as produced by `getServiceCredential`.
 */
export const NativeUsenetCredentialSchema = {
  parse(token: string): { aiostreamsAuth: string } {
    const obj = JSON.parse(fromUrlSafeBase64(token));
    if (!obj || typeof obj.aiostreamsAuth !== 'string') {
      throw new Error('missing aiostreamsAuth');
    }
    return { aiostreamsAuth: obj.aiostreamsAuth };
  },
};
