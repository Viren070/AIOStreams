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

/** How long a file stays live after its last consumer touch. */
export const LIVE_FILE_TTL_MS = 15 * 60_000;

const MAX_LIVE_TORRENTS = 512;

/** hash -> fileIndex -> expiry (epoch ms) of the last touch. */
const liveFiles = new Map<string, Map<number, number>>();

function pruneLiveFiles(now: number): void {
  for (const [hash, perTorrent] of liveFiles) {
    for (const [fileIndex, expiresAt] of perTorrent) {
      if (expiresAt <= now) perTorrent.delete(fileIndex);
    }
    if (perTorrent.size === 0) liveFiles.delete(hash);
  }
}


export function markFileLive(
  hash: string,
  fileIndex: number,
  ttlMs: number = LIVE_FILE_TTL_MS
): void {
  const now = Date.now();
  pruneLiveFiles(now);
  let perTorrent = liveFiles.get(hash);
  if (!perTorrent) {
    if (liveFiles.size >= MAX_LIVE_TORRENTS) {
      liveFiles.delete(liveFiles.keys().next().value as string);
    }
    perTorrent = new Map();
    liveFiles.set(hash, perTorrent);
  }
  perTorrent.set(fileIndex, now + ttlMs);
}

/** The torrent's currently-live file indices (expired touches pruned). */
export function liveFileIndices(hash: string): Set<number> {
  const perTorrent = liveFiles.get(hash);
  if (!perTorrent) return new Set();
  const now = Date.now();
  for (const [fileIndex, expiresAt] of perTorrent) {
    if (expiresAt <= now) perTorrent.delete(fileIndex);
  }
  if (perTorrent.size === 0) liveFiles.delete(hash);
  return new Set(perTorrent.keys());
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
