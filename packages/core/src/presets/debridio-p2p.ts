import type { Stream } from '../db/index.js';

export function extractDebridioInfoHash(stream: Stream): string | undefined {
  if (!stream.url) return undefined;
  try {
    const url = new URL(stream.url);
    if (
      url.hostname !== 'debridio.com' &&
      !url.hostname.endsWith('.debridio.com')
    ) {
      return undefined;
    }
    return url.pathname
      .match(/(?:^|\/)([a-f0-9]{40})(?=\/|$)/i)?.[1]
      ?.toLowerCase();
  } catch {
    return undefined;
  }
}

export function toDebridioP2PStream(stream: Stream): Stream {
  const infoHash = extractDebridioInfoHash(stream);
  if (!infoHash) return stream;

  const displayName = String(stream.name || 'Debridio')
    .replace(/^\s*\[[^\]]+\]\s*/u, '')
    .trim();
  return {
    ...stream,
    url: undefined,
    infoHash,
    name: `[P2P WARNING] ${displayName || 'Debridio'}`,
    behaviorHints: {
      ...(stream.behaviorHints || {}),
      bingeGroup: `debridio-p2p-${stream.behaviorHints?.bingeGroup || 'torrent'}`,
    },
  };
}
