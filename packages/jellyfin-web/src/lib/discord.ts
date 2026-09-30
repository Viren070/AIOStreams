import React from 'react';
import { useItem } from './queries';
import { itemTitle } from './format';
import { useDiscordEvent, type DiscordEvent } from './settings';

/** How long a page stays open before Discord is told, so passing through one does not show. */
const DWELL_MS = 2000;

type BrowsingEvent = Exclude<DiscordEvent, 'playing'>;

const PAGES: [RegExp, BrowsingEvent, string][] = [
  [/^\/$/, 'home', 'On the home page'],
  [/^\/discover(\/|$)/, 'discover', 'In Discover'],
  [/^\/search$/, 'search', 'Searching'],
  [/^\/calendar$/, 'calendar', 'On the calendar'],
  [/^\/favourites$/, 'favourites', 'In Favourites'],
  [/^\/history$/, 'activity', 'In Activity'],
];

const browsing = (title: string, subtitle?: string, imdb?: string | null) => ({
  title,
  subtitle: subtitle ?? null,
  imdb: imdb ?? null,
  position: 0,
  duration: null,
  paused: false,
  browsing: true,
});

/** The last browsing presence sent, so an unchanged page is not sent again. */
let shown: string | null = null;

function showBrowsing(presence: ReturnType<typeof browsing> | null) {
  const key = presence && JSON.stringify(presence);
  if (key === shown) return;
  shown = key;
  window.aiostreamsDesktop?.send({ type: 'presence', presence });
}

export function useDiscordBrowsing(pathname: string) {
  const itemId = /^\/item\/([^/]+)/.exec(pathname)?.[1] ?? '';
  const item = useItem(itemId).data;
  const page = PAGES.find(([pattern]) => pattern.test(pathname));
  const event = itemId ? 'titles' : page?.[1];
  const [enabled] = useDiscordEvent(event ?? 'titles');
  // Undefined while a title loads, which leaves the last status up meanwhile.
  let presence: ReturnType<typeof browsing> | null | undefined = null;
  if (event && enabled) {
    if (!itemId) presence = browsing(page![2]);
    else if (item)
      presence = browsing(itemTitle(item), 'Browsing', item.ProviderIds?.Imdb);
    else presence = undefined;
  }
  const key = presence === undefined ? undefined : JSON.stringify(presence);

  React.useEffect(() => {
    if (key === undefined || !window.aiostreamsDesktop) return;
    const next = JSON.parse(key) as ReturnType<typeof browsing> | null;
    const timer = setTimeout(() => showBrowsing(next), next ? DWELL_MS : 0);
    return () => clearTimeout(timer);
  }, [key]);

  React.useEffect(() => () => showBrowsing(null), []);
}
