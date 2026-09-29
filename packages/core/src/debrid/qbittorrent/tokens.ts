import z from 'zod';
import { decryptString, encryptString } from '../../utils/index.js';
import { QbittorrentCredentialSchema } from './client.js';

/** Decoded payload of a qBittorrent stream token. */
export const QbittorrentStreamTokenSchema = z.object({
  /** Full WebUI credential so the byte route can re-authenticate. */
  credential: QbittorrentCredentialSchema,

  hash: z.string().regex(/^[a-f0-9]{40}$/i),

  fileIndex: z.number().int().nonnegative(),

  filePath: z.string().min(1),

  fileSize: z.number().int().positive(),

  filename: z.string(),

  addedAt: z.number().int(),
});

export type QbittorrentStreamToken = z.infer<
  typeof QbittorrentStreamTokenSchema
>;

/** Encrypt a stream token for a URL. */
export function encodeQbittorrentStreamToken(
  token: QbittorrentStreamToken
): string {
  const enc = encryptString(JSON.stringify(token));
  if (!enc.success) {
    throw new Error('failed to encrypt qbittorrent stream token');
  }
  return enc.data;
}

/** Decrypt a stream token, undefined on failure. */
export function decodeQbittorrentStreamToken(
  token: string
): QbittorrentStreamToken | undefined {
  const dec = decryptString(token);
  if (!dec.success || dec.data == null) return undefined;
  try {
    return QbittorrentStreamTokenSchema.parse(JSON.parse(dec.data));
  } catch {
    return undefined;
  }
}
