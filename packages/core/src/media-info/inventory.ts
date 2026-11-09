import { createHash } from 'node:crypto';
import { TorboxApi } from '@torbox/torbox-api';
import { z } from 'zod';
import type { UserData } from '../db/schemas.js';
import type { DebridFile } from '../debrid/base.js';
import { Cache } from '../utils/cache.js';
import type { MediaInfoIdentity } from './identity.js';

const singleFile = z.object({
  hash: z.string(),
  size: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  files: z
    .array(
      z.object({
        name: z.string().min(1),
        size: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      })
    )
    .length(1),
});

const cache = Cache.getInstance<string, DebridFile | null>(
  'media-info:torbox-inventory',
  1000,
  'memory'
);

/**
 * TorBox downloads all files and its native cache check lists that inventory.
 * Generic StremThru checks may contain only observed/selected files, so they
 * cannot establish that an unknown-count probe is the torrent's only file.
 */
export async function torrentInventories(
  identities: MediaInfoIdentity[],
  userData: UserData | undefined
): Promise<Map<MediaInfoIdentity, DebridFile[]>> {
  const found = new Map<MediaInfoIdentity, DebridFile[]>();
  const token = userData?.services?.find(
    (s) => s.id === 'torbox' && s.enabled !== false
  )?.credentials.apiKey;
  if (!token) return found;
  const eligible = identities.filter((i) => i.service === 'torbox');
  if (!eligible.length) return found;
  const hashes = [...new Set(eligible.map((i) => i.releaseKeys[0].slice(5)))];
  const scope = createHash('sha256').update(token).digest('hex');
  const key = (hash: string) => `${scope}:${hash}`;
  const files = new Map<string, DebridFile | null>();
  const missing: string[] = [];
  const cached = await cache.getMany(hashes.map(key));
  hashes.forEach((hash, index) => {
    const hit = cached[index];
    if (hit === undefined) missing.push(hash);
    else files.set(hash, hit);
  });
  const api = new TorboxApi({ token, timeoutMs: 3000, retry: { attempts: 1 } });
  const batches: string[][] = [];
  for (let i = 0; i < missing.length; i += 100)
    batches.push(missing.slice(i, i + 100));
  await Promise.all(
    batches.map(async (hashes) => {
      let items: unknown[] = [];
      try {
        const response = await api.torrents.getTorrentCachedAvailability('v1', {
          hash: hashes.join(','),
          format: 'list',
          listFiles: 'true',
        });
        if (response.data?.success && Array.isArray(response.data.data)) {
          items = response.data.data;
        }
      } catch {
        // An optional enrichment must not fail the listing when TorBox is unavailable.
      }
      for (const hash of hashes) {
        const matches = items.filter(
          (item) =>
            !!item &&
            typeof item === 'object' &&
            'hash' in item &&
            typeof item.hash === 'string' &&
            item.hash.toLowerCase() === hash
        );
        const parsed = singleFile.safeParse(
          matches.length === 1 ? matches[0] : undefined
        );
        const file =
          parsed.success && parsed.data.size === parsed.data.files[0].size
            ? parsed.data.files[0]
            : null;
        files.set(hash, file);
        await cache.set(key(hash), file, file ? 3600 : 30);
      }
    })
  );
  for (const identity of eligible) {
    const file = files.get(identity.releaseKeys[0].slice(5));
    if (file) found.set(identity, [file]);
  }
  return found;
}
