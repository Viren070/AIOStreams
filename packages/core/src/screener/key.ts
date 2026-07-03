import { computeFingerprint, isValidFingerprint } from './fingerprint.js';
import type { ReleaseKind } from './types.js';

/**
 * A Screener release key is a self-describing, credential-free identity for a
 * release, stable across indexers/providers/servers so verdicts can be shared:
 *
 *   torrent  ->  btih:<infohash>      (lowercase hex; bittorrent v1 or v2)
 *   usenet   ->  wd1:<fingerprint>    (davex-compatible; size|poster|day)
 *
 * `releaseKind` is re-exported from types for callers that key off the prefix.
 */

export type { ReleaseKind } from './types.js';

const BTIH_V1 = /^[0-9a-f]{40}$/;
const BTIH_V2 = /^[0-9a-f]{64}$/;

/** Build a torrent key from an infohash, or null if it isn't recognisable. */
export function torrentKey(infoHash: string | null | undefined): string | null {
  if (typeof infoHash !== 'string') return null;
  const h = infoHash.trim().toLowerCase();
  if (BTIH_V1.test(h) || BTIH_V2.test(h)) return `btih:${h}`;
  return null;
}

/**
 * Build a usenet key from indexer-reported size/poster/date. Returns the
 * `wd1:` fingerprint (already prefix-tagged) or null for non-identifying input.
 */
export function usenetKey(
  size: number,
  poster: string | null | undefined,
  usenetDateUnixSeconds: number | null | undefined
): string | null {
  return computeFingerprint(size, poster, usenetDateUnixSeconds);
}

/** The kind a key denotes, from its prefix, or null if unrecognised/invalid. */
export function keyKind(key: string | null | undefined): ReleaseKind | null {
  if (typeof key !== 'string') return null;
  if (key.startsWith('btih:')) {
    const h = key.slice(5);
    return BTIH_V1.test(h) || BTIH_V2.test(h) ? 'torrent' : null;
  }
  if (key.startsWith('wd1:')) return isValidFingerprint(key) ? 'usenet' : null;
  return null;
}

/** True when `key` is a syntactically valid release key. */
export function isValidKey(key: string | null | undefined): key is string {
  return keyKind(key) !== null;
}

/** Split a key into its kind and raw id (`btih:` keys lose the prefix). */
export function parseKey(
  key: string | null | undefined
): { kind: ReleaseKind; id: string } | null {
  const kind = keyKind(key);
  if (!kind) return null;
  const k = key as string;
  return { kind, id: kind === 'torrent' ? k.slice(5) : k };
}
