import { randomUUID } from 'crypto';
import z from 'zod';
import { Cache, decryptString, encryptString } from '../../utils/index.js';
import { QbittorrentCredentialSchema } from './client.js';

/** How long a stream reference stays resolvable after a resolve. */
export const STREAM_REF_TTL_SECONDS = 12 * 60 * 60;


export interface QbittorrentStreamRefEntry {
  credential: z.infer<typeof QbittorrentCredentialSchema>;

  hash: string;

  fileIndex: number;

  filePath: string;

  fileSize: number;

  filename: string;

  addedAt: number;
}

/**
 * Server-side store for stream references. Tokens carry only an opaque
 * reference (plus expiry), so a leaked or tampered stream URL can neither
 * disclose the WebUI credential nor reach a path that was not registered by
 * a resolve.
 */
const streamRefStore = Cache.getInstance<string, QbittorrentStreamRefEntry>(
  'qbittorrent:stream-refs'
);

/** Register a stream entry behind a fresh opaque ref. */
export async function registerStreamRef(
  entry: QbittorrentStreamRefEntry
): Promise<string> {
  const ref = randomUUID();
  await streamRefStore.set(ref, entry, STREAM_REF_TTL_SECONDS);
  return ref;
}

/** Look up a ref, undefined means expired. */
export function resolveStreamRef(
  ref: string
): Promise<QbittorrentStreamRefEntry | undefined> {
  return streamRefStore.get(ref);
}

/** Opaque token for byte URLs, carries only a ref id and expiry. */
export const QbittorrentStreamTokenSchema = z.object({
  ref: z.string().min(1),

  exp: z.number().int().positive(),
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
