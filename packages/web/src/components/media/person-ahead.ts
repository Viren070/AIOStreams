import React from 'react';
import { useSession } from '@/lib/jellyfin/session';
import { useFetchItem, useFetchPersonItems } from '@/lib/jellyfin/queries';
import { posterUrl } from '@/lib/artwork/urls';
import { warmImage } from '@/lib/cache/images';
import { workShown } from '@/lib/person-work';
import { KINDS } from './kind-tabs';

/** As a title card's: less than a row's slide to it, more than a held key's step past it. */
const REST_MS = 150;
/** Posters of their work fetched ahead, the first the page shows. */
const POSTERS = 12;
/** A person fetched ahead isn't fetched again for this long. */
const AGAIN_MS = 5 * 60_000;
const fetchedAt = new Map<string, number>();

/**
 * Fetches a person's page ahead while their card rests under focus or the
 * pointer: their details and photo, and the first page of the work it opens
 * on, `role` as their card's link asks for it, with its posters, all kept.
 */
export function usePersonAhead(personId: string | undefined, role?: string) {
  const { client } = useSession();
  const fetchItem = useFetchItem();
  const fetchItems = useFetchPersonItems();
  const timer = React.useRef<number>(undefined);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!personId) return undefined;
  const fetchAhead = async () => {
    const key = `${personId}:${role ?? ''}`;
    const at = fetchedAt.get(key);
    if (at && performance.now() - at < AGAIN_MS) return;
    fetchedAt.set(key, performance.now());
    try {
      const person = await fetchItem(personId);
      // At the size their page shows it, decoded, as the page waits on it.
      const photo = posterUrl(client, person, { maxWidth: 192 });
      if (photo) warmImage(photo, 'small');
      const { shown } = workShown(person, role);
      const items = await fetchItems(personId, KINDS[0].types, shown);
      // The first posters, at the size the page lists them; not decoded.
      for (const item of items.slice(0, POSTERS)) {
        const poster = posterUrl(client, item, { maxWidth: 112 });
        if (poster) warmImage(poster);
      }
    } catch {
      fetchedAt.delete(key);
    }
  };
  return {
    start: () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void fetchAhead(), REST_MS);
    },
    stop: () => window.clearTimeout(timer.current),
  };
}
