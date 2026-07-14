import { computeUsenetFingerprint } from './fingerprint.js';
import type { ReleaseKeyKind } from './types.js';

/**
 * A release key is a self-describing, credential-free identity for one
 * release, stable across indexers, providers and instances:
 *
 *   torrent -> `btih:<infohash>` (v1 or v2, lowercase hex)
 *   usenet  -> `wd1:<fingerprint>` (see fingerprint.ts)
 *   usenet  -> `nh1:<content hash>` (SHA1 over the sorted segment
 *              message-ids, i.e. `computeNzbHash`)
 *
 * `wd1:` identifies a release as indexers describe it and is computable at
 * search time; `nh1:` identifies one exact post and is only known after
 * the NZB has been fetched and parsed. Warden-format lists carry only
 * `wd1:`; `nh1:` travels in the native dialect.
 */

export const WD1_KEY_REGEX = /^wd1:[0-9a-f]{32}$/;
export const NH1_KEY_REGEX = /^nh1:[0-9a-f]{40}$/;

const SHA1_REGEX = /^[0-9a-f]{40}$/;
const BTIH_V1_REGEX = /^[0-9a-f]{40}$/;
const BTIH_V2_REGEX = /^[0-9a-f]{64}$/;

export function torrentKey(infoHash: string | null | undefined): string | null {
  if (typeof infoHash !== 'string') return null;
  const hash = infoHash.trim().toLowerCase();
  if (BTIH_V1_REGEX.test(hash) || BTIH_V2_REGEX.test(hash)) {
    return `btih:${hash}`;
  }
  return null;
}

export function usenetKey(
  size: number,
  poster: string | null | undefined,
  usenetDateUnixSeconds: number | null | undefined
): string | null {
  return computeUsenetFingerprint(size, poster, usenetDateUnixSeconds);
}

/** Build an `nh1:` key from an NZB content hash, or null if it isn't one. */
export function nzbContentKey(
  contentHash: string | null | undefined
): string | null {
  if (typeof contentHash !== 'string') return null;
  const hash = contentHash.trim().toLowerCase();
  return SHA1_REGEX.test(hash) ? `nh1:${hash}` : null;
}

export function releaseKeyKind(
  key: string | null | undefined
): ReleaseKeyKind | null {
  if (typeof key !== 'string') return null;
  if (key.startsWith('btih:')) {
    const hash = key.slice(5);
    return BTIH_V1_REGEX.test(hash) || BTIH_V2_REGEX.test(hash)
      ? 'torrent'
      : null;
  }
  if (key.startsWith('wd1:')) {
    return WD1_KEY_REGEX.test(key) ? 'usenet' : null;
  }
  if (key.startsWith('nh1:')) {
    return NH1_KEY_REGEX.test(key) ? 'usenet' : null;
  }
  return null;
}

export function isValidReleaseKey(
  key: string | null | undefined
): key is string {
  return releaseKeyKind(key) !== null;
}
