import { useQuery } from '@tanstack/react-query';
import type { JellyfinClient } from '@/lib/jellyfin/client';
import { currentHost } from '@/lib/hosts';
import type { SourceInfo } from '@/lib/jellyfin/types';

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

/** Servers that send no extensions, which stream what they have themselves. */
const streaming = new Set<string>();

export function noteStreamsItself(base: string, yes: boolean): void {
  if (yes) streaming.add(base);
  else streaming.delete(base);
}

export const streamsItself = (base: string) => streaming.has(base);

/**
 * The source's own address, which outlives this session. Players open it
 * rather than the stream route, as mpv reads a playlist's relative parts
 * against the address it opened, not the one a redirect led to. A server
 * that streams itself may hold an address only it can reach.
 */
export function directUrl(
  client: JellyfinClient,
  itemId: string,
  source: SourceInfo
): string {
  return source.Path &&
    /^https?:\/\//i.test(source.Path) &&
    !streamsItself(client.base)
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
  return (await currentHost().resolveYouTube?.(id))?.url ?? null;
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
