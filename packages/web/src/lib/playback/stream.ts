import { useQuery } from '@tanstack/react-query';
import type { JellyfinClient } from '../client';
import { currentHost } from '../hosts';
import type { SourceInfo } from '../types';

/**
 * The server's stream route. A player cannot send the sign-in header, so the
 * token rides in the query, which servers that guard the route require.
 */
function streamUrl(
  client: JellyfinClient,
  itemId: string,
  source: SourceInfo
): string {
  return client.url(`/Videos/${itemId}/stream`, {
    static: true,
    MediaSourceId: source.Id,
    ApiKey: client.token,
  });
}

/**
 * The source's own address, which outlives this session. Players open it
 * rather than the stream route, as mpv reads a playlist's relative parts
 * against the address it opened, not the one a redirect led to.
 */
export function directUrl(
  client: JellyfinClient,
  itemId: string,
  source: SourceInfo
): string {
  return source.Path && /^https?:\/\//i.test(source.Path)
    ? source.Path
    : streamUrl(client, itemId, source);
}

export function requiredHeaders(
  source: SourceInfo
): Record<string, string> | undefined {
  const entries = Object.entries(source.RequiredHttpHeaders ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export const needsAppPlayer = (source: SourceInfo) =>
  !!source.aiostreams?.ytId || !!requiredHeaders(source);

async function youTubeStream(id: string): Promise<string | null> {
  return (await currentHost().resolveYouTube?.(id)) ?? null;
}

export async function playerUrl(
  client: JellyfinClient,
  itemId: string,
  source: SourceInfo
): Promise<string | null> {
  const id = source.aiostreams?.ytId;
  return id ? youTubeStream(id) : directUrl(client, itemId, source);
}

/** Asked for on every play, as YouTube's links expire. */
export const useYouTubeStream = (id: string | undefined) =>
  useQuery({
    queryKey: ['youtube-stream', id],
    queryFn: () => youTubeStream(id!),
    enabled: !!id,
    gcTime: 0,
  });
