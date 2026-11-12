import type { YouTubeStream } from '..';
import { ask } from './bridge';

let requests = 0;

export function resolveYouTube(id: string): Promise<YouTubeStream | null> {
  const request = String(++requests);
  return ask({ type: 'youtube-resolve', request, id }, 'youtube-resolved', {
    timeoutMs: 20_000,
    matches: (m) => m.request === request,
  })
    .then(({ url, originalLanguage }) =>
      url ? { url, originalLanguage } : null
    )
    .catch(() => null);
}
