import type { ParsedStream } from '../db/schemas.js';
import { canonicalNzbHash, playbackNzbHash } from '../debrid/utils.js';
import { isTrustedAddon } from '../presets/trust.js';
import { unwrapProxyUrl } from '../proxy/token.js';
import { torrentKey } from '../release-blocklist/keys.js';
import { streamReleaseKey } from '../release-blocklist/stream-keys.js';

/** What finds a stream's probed files, without its NZB URL's credentials. */
export interface MediaInfoIdentity {
  releaseKeys: string[];
  /** Search-time NZB hash, which the library aliases to the exact post. */
  nzbHash?: string;
  file?: string;
  filename?: string;
  title?: string;
}

/**
 * A local-only key for an indexer's NZB, the same whatever proxy or service
 * fetched it. Only for known URL shapes: an unknown one may have lost its id
 * when cleaned, and would put every NZB from that host under one key.
 */
export function nzbUrlKey(nzbUrl: string | undefined): string | undefined {
  if (!nzbUrl) return undefined;
  const { hash, known } = canonicalNzbHash(nzbUrl);
  return known ? `nu1:${hash}` : undefined;
}

function isUsenet(stream: ParsedStream): boolean {
  return (
    stream.type === 'usenet' ||
    stream.type === 'stremio-usenet' ||
    !!stream.nzbUrl
  );
}

function usenetIdentity(stream: ParsedStream): MediaInfoIdentity | undefined {
  const releaseKeys: string[] = [];
  const fingerprint = streamReleaseKey(stream);
  if (fingerprint) releaseKeys.push(fingerprint);
  let nzbHash: string | undefined;
  if (stream.nzbUrl) {
    const { hash, known } = canonicalNzbHash(stream.nzbUrl);
    nzbHash = hash;
    if (known) releaseKeys.push(`nu1:${hash}`);
  } else if (stream.url) {
    // Library streams carry no NZB URL; their playback URL names the entry.
    nzbHash = playbackNzbHash(unwrapProxyUrl(stream.url));
  }
  if (!releaseKeys.length && !nzbHash) return undefined;
  return {
    releaseKeys,
    nzbHash,
    filename: stream.filename,
    title: stream.folderName ?? stream.filename,
  };
}

function torrentIdentity(stream: ParsedStream): MediaInfoIdentity | undefined {
  if (!isTrustedAddon(stream.addon)) return undefined;
  const key = torrentKey(stream.torrent?.infoHash);
  if (!key) return undefined;
  return {
    releaseKeys: [key],
    file: stream.torrent?.file,
    filename: stream.filename,
    title: stream.torrent?.title ?? stream.folderName ?? stream.filename,
  };
}

/** The keys a stream's probed files are stored under, when it can be trusted. */
export function mediaInfoIdentity(
  stream: ParsedStream
): MediaInfoIdentity | undefined {
  return isUsenet(stream) ? usenetIdentity(stream) : torrentIdentity(stream);
}
