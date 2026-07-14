import { releaseKeyKind, torrentKey } from './keys.js';

/** The minimal stream shape needed to derive a release key. */
export interface BlocklistKeyableStream {
  type?: string;
  torrent?: { infoHash?: string | null } | null;
  nzbUrl?: string | null;
  /** Precomputed usenet key, set by the producing builtin. */
  releaseKey?: string;
}

function isUsenetStream(stream: BlocklistKeyableStream): boolean {
  return (
    stream.type === 'usenet' ||
    stream.type === 'stremio-usenet' ||
    Boolean(stream.nzbUrl)
  );
}

/**
 * The release key for a stream, or null when it cannot be identified.
 *
 * Usenet streams only ever use their precomputed `releaseKey`: their hash
 * fields carry NZB hashes, and a SHA1 content hash is 40 hex chars, which
 * would otherwise pass as a v1 infohash.
 */
export function streamReleaseKey(
  stream: BlocklistKeyableStream
): string | null {
  if (!isUsenetStream(stream)) {
    const fromInfoHash = torrentKey(stream.torrent?.infoHash);
    if (fromInfoHash) return fromInfoHash;
  }
  if (stream.releaseKey && releaseKeyKind(stream.releaseKey) === 'usenet') {
    return stream.releaseKey;
  }
  return null;
}
