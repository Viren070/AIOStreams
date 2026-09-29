import { randomUUID } from 'crypto';
import z from 'zod';
import { Cache, decryptString, encryptString } from '../../utils/index.js';
import { QbittorrentCredentialSchema } from './client.js';

/** How long a credential reference stays resolvable after a resolve. */
export const CREDENTIAL_REF_TTL_SECONDS = 12 * 60 * 60;

/**
 * Server-side store for WebUI credentials referenced by stream tokens. Tokens
 * carry only an opaque reference (plus expiry), so a leaked stream URL cannot
 * disclose the credential itself.
 */
const credentialStore = Cache.getInstance<string, z.infer<
  typeof QbittorrentCredentialSchema
>>('qbittorrent:credentials');

/** Register a stream entry behind a fresh opaque ref. */
export async function registerCredentialRef(
  credential: z.infer<typeof QbittorrentCredentialSchema>
): Promise<string> {
  const ref = randomUUID();
  await credentialStore.set(ref, credential, CREDENTIAL_REF_TTL_SECONDS);
  return ref;
}

/** Look up a ref, undefined means expired. */
export function resolveCredentialRef(
  ref: string
): Promise<z.infer<typeof QbittorrentCredentialSchema> | undefined> {
  return credentialStore.get(ref);
}

/** Decoded payload of a qBittorrent stream token. */
export const QbittorrentStreamTokenSchema = z.object({
  /** Opaque reference to the server-side credential entry. */
  credentialRef: z.string().min(1),
  /** Expiry (epoch seconds); matches the credential reference's TTL. */
  exp: z.number().int().positive(),

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
