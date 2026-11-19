import React from 'react';
import { useSession } from '@/lib/jellyfin/session';
import {
  useCachedItem,
  useFetchItem,
  useFetchNextUp,
  useFetchShowAhead,
} from '@/lib/jellyfin/queries';
import {
  backdropUrls,
  logoUrl,
  personImageUrl,
  posterUrl,
} from '@/lib/artwork/urls';
import { warmImage } from '@/lib/cache/images';
import type { BaseItemDto } from '@/lib/jellyfin/types';

/** How long focus or the pointer rests on a card before its page is fetched: less than a row's slide to it, more than a held key's step past it. */
const REST_MS = 150;
/** Faces of its cast and crew fetched ahead, the first with photos. */
const FACES = 12;
/** A title fetched ahead isn't fetched again for this long, while its details are in. */
const AGAIN_MS = 5 * 60_000;
const fetchedAt = new Map<string, number>();

/**
 * Fetches a title's page ahead: its details, a show's next episode, seasons
 * and the episodes of `seasonId` or the season it opens on, and its backdrop,
 * logo, poster and first faces at the page's sizes, all kept, so the page
 * opens with them in. With `decode`, its pictures are decoded too, so they
 * draw as the page shows them; that takes memory, so only for the title most
 * likely next.
 * Once in a while per title; settles once its details are in.
 */
export function useFetchPageAhead() {
  const { client, user } = useSession();
  const fetchItem = useFetchItem();
  const cachedItem = useCachedItem();
  const fetchNextUp = useFetchNextUp();
  const fetchShowAhead = useFetchShowAhead();
  const warmArtwork = (full: BaseItemDto, decode: boolean) => {
    const backdrop = backdropUrls(client, full, { maxWidth: 1920 })[0];
    const logo = logoUrl(client, full, { maxWidth: 416 });
    const poster = posterUrl(client, full, { maxWidth: 320 });
    if (backdrop) warmImage(backdrop, decode ? 'large' : undefined);
    if (logo) warmImage(logo, decode ? 'small' : undefined);
    if (poster) warmImage(poster, decode ? 'small' : undefined);
  };
  return async (
    id: string,
    seasonId?: string,
    decode = true
  ): Promise<void> => {
    // Per server and profile, as its details are, and per season it opens on.
    const key = [client.base, user.Id, id, seasonId].join(' ');
    const at = fetchedAt.get(key);
    const known =
      at !== undefined && performance.now() - at < AGAIN_MS
        ? cachedItem(id)
        : undefined;
    if (known) {
      // Decoded again from the details in, as only a few pictures are held.
      if (decode) warmArtwork(known, true);
      return;
    }
    fetchedAt.set(key, performance.now());
    try {
      const full = await fetchItem(id);
      if (full.Type !== 'Movie' && full.Type !== 'Series') return;
      if (full.Type === 'Series') {
        void fetchNextUp(id).catch(() => undefined);
        void fetchShowAhead(id, seasonId).catch(() => undefined);
      }
      warmArtwork(full, decode);
      for (const person of (full.People ?? [])
        .filter((p) => p.PrimaryImageTag)
        .slice(0, FACES)) {
        const face = personImageUrl(client, person);
        if (face) warmImage(face);
      }
    } catch {
      fetchedAt.delete(key);
    }
  };
}

/** Fetches a title's page ahead while its card rests under focus or the pointer; an episode's, its show's. */
export function usePageAhead(item: BaseItemDto) {
  const fetchPage = useFetchPageAhead();
  const timer = React.useRef<number>(undefined);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  // An episode opens its show's page on its season, as in Continue watching.
  const id = item.Type === 'Episode' ? item.SeriesId : item.Id;
  const seasonId =
    item.Type === 'Episode' ? (item.SeasonId ?? undefined) : undefined;
  if (
    !id ||
    (item.Type !== 'Movie' && item.Type !== 'Series' && item.Type !== 'Episode')
  )
    return undefined;
  return {
    start: () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(
        () => void fetchPage(id, seasonId),
        REST_MS
      );
    },
    stop: () => window.clearTimeout(timer.current),
  };
}
