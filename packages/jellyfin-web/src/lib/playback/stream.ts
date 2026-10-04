import type { JellyfinClient } from '../client';
import type { SourceInfo } from '../types';

/**
 * The server's stream route. A player cannot send the sign-in header, so the
 * token rides in the query, which servers that guard the route require.
 */
export function streamUrl(
  client: JellyfinClient,
  itemId: string,
  source: SourceInfo,
  playSessionId?: string | null
): string {
  return client.url(`/Videos/${itemId}/stream`, {
    static: true,
    MediaSourceId: source.Id,
    PlaySessionId: playSessionId,
    ApiKey: client.token,
  });
}

/** The source's own address, which outlives this session. */
export function directUrl(
  client: JellyfinClient,
  itemId: string,
  source: SourceInfo
): string {
  return source.Path && /^https?:\/\//i.test(source.Path)
    ? source.Path
    : streamUrl(client, itemId, source);
}
