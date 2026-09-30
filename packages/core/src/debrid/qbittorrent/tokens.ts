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
const streamRefStore = Cache.getInstance<string, string>(
  'qbittorrent:stream-refs'
);

/**
 * Register a stream entry behind a fresh opaque reference for
 * {@link STREAM_REF_TTL_SECONDS}. The WebUI credential inside the entry is
 * encrypted at rest, so a Redis or SQL cache backend never holds the
 * password in plaintext. Each resolve mints a new reference; references are
 * never reused, so one expiring cannot affect other streams.
 */
export async function registerStreamRef(
  entry: QbittorrentStreamRefEntry
): Promise<string> {
  const ref = randomUUID();
  const sealed = encryptString(JSON.stringify(entry));
  if (!sealed.success) {
    throw new Error('failed to seal qbittorrent stream reference');
  }
  await streamRefStore.set(ref, sealed.data, STREAM_REF_TTL_SECONDS);
  return ref;
}

/**
 * Look up the entry for a stream token reference. Undefined when the
 * reference is unknown, expired, or fails validation (a schema change with
 * references still cached must degrade to an expired link, not a crash);
 * the caller should answer as an expired link.
 */
const SealedStreamRefSchema = z.object({
  credential: QbittorrentCredentialSchema,
  hash: z.string(),
  fileIndex: z.number(),
  filePath: z.string(),
  fileSize: z.number(),
  filename: z.string(),
  addedAt: z.number(),
});

export async function resolveStreamRef(
  ref: string
): Promise<QbittorrentStreamRefEntry | undefined> {
  const sealed = await streamRefStore.get(ref);
  if (!sealed) return undefined;
  const opened = decryptString(sealed);
  if (!opened.success || opened.data == null) return undefined;
  try {
    return SealedStreamRefSchema.parse(JSON.parse(opened.data));
  } catch {
    return undefined;
  }
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


let lastLivePrune = 0;

function liveKey(
  credential: z.infer<typeof QbittorrentCredentialSchema>,
  hash: string
): string {

  const url = credential.url.replace(/\/+$/, '');
  return `${url}|${credential.username}|${hash}`;
}

export function markFileLive(
  credential: z.infer<typeof QbittorrentCredentialSchema>,
  hash: string,
  fileIndex: number,
  ttlMs: number = LIVE_FILE_TTL_MS
): void {
  const now = Date.now();

  if (now - lastLivePrune >= 1_000) {
    lastLivePrune = now;
    pruneLiveFiles(now);
  }
  const key = liveKey(credential, hash);
  let perTorrent = liveFiles.get(key);
  if (!perTorrent) {
    if (liveFiles.size >= MAX_LIVE_TORRENTS) {
      liveFiles.delete(liveFiles.keys().next().value as string);
    }
    perTorrent = new Map();
    liveFiles.set(key, perTorrent);
  }
  perTorrent.set(fileIndex, now + ttlMs);
}

/** The torrent's currently-live file indices (expired touches pruned). */
export function liveFileIndices(
  credential: z.infer<typeof QbittorrentCredentialSchema>,
  hash: string
): Set<number> {
  const key = liveKey(credential, hash);
  const perTorrent = liveFiles.get(key);
  if (!perTorrent) return new Set();
  const now = Date.now();
  for (const [fileIndex, expiresAt] of perTorrent) {
    if (expiresAt <= now) perTorrent.delete(fileIndex);
  }
  if (perTorrent.size === 0) liveFiles.delete(key);
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
