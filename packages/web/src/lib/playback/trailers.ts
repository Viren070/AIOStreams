import { t } from '@lingui/core/macro';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { currentHost } from '../hosts';
import type { BaseItemDto } from '../types';

export interface Trailer {
  name: string;
  url: string;
}

export const trailersOf = (item: BaseItemDto): Trailer[] =>
  (item.RemoteTrailers ?? []).flatMap((trailer) =>
    trailer.Url ? [{ name: trailer.Name || t`Trailer`, url: trailer.Url }] : []
  );

export function youTubeId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^(www|m)\./, '');
  const id =
    host === 'youtu.be'
      ? parsed.pathname.slice(1)
      : host === 'youtube.com' || host === 'youtube-nocookie.com'
        ? (parsed.searchParams.get('v') ??
          parsed.pathname.match(/^\/(?:embed|shorts|v)\/([^/]+)/)?.[1])
        : null;
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

export type TrailerPlayback =
  | { kind: 'video'; url: string }
  | { kind: 'embed'; id: string }
  | { kind: 'external'; url: string };

async function playbackOf(url: string): Promise<TrailerPlayback> {
  const id = youTubeId(url);
  if (!id) return { kind: 'video', url };
  const { resolveYouTube } = currentHost();
  if (resolveYouTube) {
    const stream = await resolveYouTube(id);
    return stream ? { kind: 'video', url: stream } : { kind: 'external', url };
  }
  // YouTube's embed refuses a page without a web address.
  return location.protocol.startsWith('http')
    ? { kind: 'embed', id }
    : { kind: 'external', url };
}

// YouTube's links expire after some hours.
const trailerQuery = (url: string) => ({
  queryKey: ['trailer', url] as const,
  queryFn: () => playbackOf(url),
  staleTime: 60 * 60_000,
  gcTime: 60 * 60_000,
});

export const useTrailerPlayback = (url: string | undefined) =>
  useQuery({ ...trailerQuery(url ?? ''), enabled: !!url });

export function usePrefetchTrailer() {
  const queryClient = useQueryClient();
  return (url: string | undefined) => {
    if (url) void queryClient.prefetchQuery(trailerQuery(url));
  };
}
