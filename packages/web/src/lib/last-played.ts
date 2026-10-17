import { itemTitle } from './format';
import { storage } from './storage';
import type { BaseItemDto, SourceInfo } from './types';

const KEY = 'aiostreams-web-last-played';

interface LastPlayed {
  title: string;
  version: string;
  at: number;
}

/** What playback last opened, which a report sent after a crash names. */
export function noteLastPlayed(item: BaseItemDto, source: SourceInfo) {
  storage.set(KEY, {
    title: itemTitle(item),
    version: source.Name ?? '',
    at: Date.now(),
  } satisfies LastPlayed);
}

export function lastPlayedLine(): string | null {
  const last = storage.get<LastPlayed>(KEY);
  if (!last) return null;
  const at = new Date(last.at).toLocaleString();
  // eslint-disable-next-line lingui/no-unlocalized-strings -- report text, not shown
  return `Last played: ${last.title}, ${last.version} (${at})`;
}
