import { z } from 'zod';
import { Cache, appConfig, createLogger, makeRequest } from '../utils/index.js';
import {
  MediaInfoRepository,
  type MediaInfoRow,
} from '../db/repositories/media-info.js';
import { isValidReleaseKey } from '../release-blocklist/keys.js';
import { MediaInfoRecordSchema } from './record.js';

const logger = createLogger('media-info');

export const MAX_LOOKUP_KEYS = 100;
/** Rows from another instance; never stored, so never shared on. */
export const REMOTE_ORIGIN_PREFIX = 'remote:';

const NU1_KEY_REGEX = /^nu1:[0-9a-f]{32}$/;
const TIMEOUT_MS = 3_000;
const HIT_TTL = 6 * 60 * 60;
const MISS_TTL = 60 * 60;
const FAILURE_BACKOFF_MS = 60_000;

/** Keys another instance may ask for: content keys and canonical NZB URL keys. */
export function isSharedKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    (isValidReleaseKey(key) || NU1_KEY_REGEX.test(key))
  );
}

const SharedRowSchema = z.object({
  key: z.string(),
  file: z.string().min(1).max(1024),
  origin: z.string().min(1).max(32),
  releaseFiles: z.number().int().nonnegative(),
  size: z.number().nonnegative().nullable(),
  title: z.string().max(1024).nullable(),
  info: MediaInfoRecordSchema,
  version: z.number().int().nonnegative(),
});
export type SharedRow = z.infer<typeof SharedRowSchema>;

const LookupResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({ rows: z.array(SharedRowSchema).max(5_000) }),
});

export async function sharedRows(keys: unknown[]): Promise<SharedRow[]> {
  const wanted = [...new Set(keys.filter(isSharedKey))].slice(
    0,
    MAX_LOOKUP_KEYS
  );
  const rows = await MediaInfoRepository.getByKeys(wanted);
  return rows.map((r) => ({
    key: r.releaseKey,
    file: r.file,
    origin: r.origin,
    releaseFiles: r.releaseFiles,
    size: r.size,
    title: r.title ?? null,
    info: r.info,
    version: r.version,
  }));
}

const cache = Cache.getInstance<string, SharedRow[]>('media-info:remote');
let failedAt = 0;

async function fetchRows(
  base: string,
  keys: string[]
): Promise<SharedRow[] | undefined> {
  try {
    const response = await makeRequest(`${base}/api/v1/media-info/lookup`, {
      method: 'POST',
      timeout: TIMEOUT_MS,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keys }),
      ignoreRecursion: true,
    });
    if (!response.ok) throw new Error(`returned ${response.status}`);
    const parsed = LookupResponseSchema.parse(await response.json());
    const asked = new Set(keys);
    return parsed.data.rows.filter((r) => asked.has(r.key));
  } catch (err) {
    logger.warn(
      { err: (err as Error)?.message },
      'media info lookup on another instance failed'
    );
    return undefined;
  }
}

/** Rows another instance shares for these keys, cached per key. */
export async function remoteRows(keys: string[]): Promise<MediaInfoRow[]> {
  const base = appConfig.mediaInfo.lookupUrl;
  const wanted = [...new Set(keys.filter(isSharedKey))];
  if (!base || wanted.length === 0) return [];
  const cached = await cache.getMany(wanted);
  const rows = cached.flatMap((c) => c ?? []);
  const missing = wanted.filter((_, i) => cached[i] === undefined);
  // A down instance would otherwise add its timeout to every stream list.
  if (missing.length > 0 && Date.now() - failedAt > FAILURE_BACKOFF_MS) {
    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += MAX_LOOKUP_KEYS) {
      chunks.push(missing.slice(i, i + MAX_LOOKUP_KEYS));
    }
    await Promise.all(
      chunks.map(async (chunk) => {
        const fetched = await fetchRows(base, chunk);
        if (!fetched) {
          failedAt = Date.now();
          return;
        }
        rows.push(...fetched);
        await Promise.all(
          chunk.map((key) => {
            const found = fetched.filter((r) => r.key === key);
            return cache.set(key, found, found.length ? HIT_TTL : MISS_TTL);
          })
        );
      })
    );
  }
  return rows.map((r) => ({
    releaseKey: r.key,
    file: r.file,
    origin: `${REMOTE_ORIGIN_PREFIX}${r.origin}`,
    releaseFiles: r.releaseFiles,
    size: r.size,
    info: r.info,
    version: r.version,
    title: r.title,
  }));
}
