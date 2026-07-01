import { keyKind, torrentKey } from './key.js';

/** The minimal shape of a stream needed to derive its Screener release key. */
export interface KeyableStream {
  type?: string;
  /** Top-level infohash on raw stream objects (parsed streams nest it below). */
  infoHash?: string | null;
  torrent?: { infoHash?: string | null } | null;
  /** Precomputed usenet key (`wd1:...`), set by the producing builtin. */
  screenerKey?: string;
}

/**
 * The release key for a stream, or null if it can't be identified. Torrents and
 * debrid-over-torrent resolve from their infohash; usenet uses the key the
 * builtin precomputed from size/poster/date (external usenet addons that don't
 * provide one are simply not screened, they do their own filtering).
 */
export function streamReleaseKey(stream: KeyableStream): string | null {
  const fromInfoHash = torrentKey(stream.torrent?.infoHash ?? stream.infoHash);
  if (fromInfoHash) return fromInfoHash;
  // screenerKey is usenet-only (wd1); a torrent key here would already have come
  // from the infohash above.
  const sk = stream.screenerKey;
  if (sk && keyKind(sk) === 'usenet') return sk;
  return null;
}
