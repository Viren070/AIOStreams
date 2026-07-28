export type TorrentClawPlaybackOptions = {
  watchInBrowser?: boolean;
  downloadActions?: boolean;
  unavailableNotices?: boolean;
};

export type TorrentClawStreamShape = {
  name?: string | null;
  title?: string | null;
  description?: string | null;
  url?: string | null;
  infoHash?: string | null;
  externalUrl?: string | null;
  behaviorHints?: Record<string, unknown>;
};

export function streamText(stream: TorrentClawStreamShape): string {
  return `${stream.name || ''} ${stream.title || ''} ${stream.description || ''}`;
}

/**
 * Classify TorrentClaw's provider-backed streams using its explicit Stremio
 * response signals. Structured hints win, then uncached markers win over
 * cached markers so a "not cached"/"caches on play" action is never promoted
 * by a stray cache-related word.
 */
export function getTorrentClawCachedStatus(
  stream: TorrentClawStreamShape
): boolean {
  const hinted = stream.behaviorHints?.cached;
  if (typeof hinted === 'boolean') return hinted;

  const text = streamText(stream);
  if (
    /\b(?:uncached|not[\s-]*cached|no instant)\b/i.test(text) ||
    /\bcache(?:s|d)?\s+on\s+play\b/i.test(text) ||
    /[⏳☁]/u.test(text) ||
    (Boolean(stream.externalUrl) && /(?:^|\s)download\b/i.test(text))
  ) {
    return false;
  }
  if (/\b(?:instant|cached)\b/i.test(text) || /[⚡🚀🌩📫]/u.test(text)) {
    return true;
  }

  // Unknown provider-backed streams remain conservatively uncached.
  return false;
}

function isWatchInBrowser(stream: TorrentClawStreamShape): boolean {
  return /watch in your browser/i.test(streamText(stream));
}

function isDownloadAction(stream: TorrentClawStreamShape): boolean {
  return /(?:^|\s)download\b|cache(?:s|d)? on play/i.test(streamText(stream));
}

function isUnavailableNotice(stream: TorrentClawStreamShape): boolean {
  return /debrid-only:\s*no instant|no instant streams/i.test(
    streamText(stream)
  );
}

export function filterTorrentClawPlaybackActions<
  T extends TorrentClawStreamShape,
>(streams: T[], playback: TorrentClawPlaybackOptions): T[] {
  return streams.filter((stream) => {
    if (stream.url || stream.infoHash) return true;
    if (isWatchInBrowser(stream)) return playback.watchInBrowser === true;
    if (isDownloadAction(stream)) return playback.downloadActions !== false;
    if (isUnavailableNotice(stream))
      return playback.unavailableNotices === true;
    return false;
  });
}
