import type { ServerInfo } from './server-info';
import type { BaseItemDto } from './types';

/*
 * The app routes on the URL hash, like jellyfin-web, so it works under any
 * mount of the API.
 */

export const to = {
  home: '/',
  history: '/history',
  downloads: '/downloads',
  calendar: (month?: string) =>
    month ? `/calendar?month=${month}` : '/calendar',
  favourites: (kind?: string) =>
    kind ? `/favourites?kind=${kind}` : '/favourites',
  settings: (tab?: string) => (tab ? `/settings?tab=${tab}` : '/settings'),
  search: (term?: string) =>
    term ? `/search?q=${encodeURIComponent(term)}` : '/search',
  discover: (
    viewId?: string,
    opts: { genre?: string; kind?: string } = {}
  ): string => {
    if (!viewId) return '/discover';
    const params = new URLSearchParams();
    if (opts.genre) params.set('genre', opts.genre);
    if (opts.kind) params.set('kind', opts.kind);
    const query = params.toString();
    return `/discover/${viewId}${query ? `?${query}` : ''}`;
  },
  item: (itemId: string) => `/item/${itemId}`,
  person: (personId: string) => `/person/${personId}`,
  /** With `playlist`, it plays on through that playlist. */
  play: (itemId: string, sourceId: string, startMs = 0, playlist?: string) =>
    `/play/${itemId}?source=${sourceId}${startMs ? `&start=${Math.round(startMs)}` : ''}${playlist ? `&playlist=${playlist}` : ''}`,
  trailer: (itemId: string, index = 0) =>
    `/play/trailer/${itemId}${index ? `?trailer=${index}` : ''}`,
};

/** An episode has no page of its own; it opens its show at its season. */
export function itemPath(
  item: Pick<BaseItemDto, 'Id' | 'Type' | 'SeriesId' | 'SeasonId'>
): string {
  if (item.Type === 'Episode' && item.SeriesId) {
    const params = new URLSearchParams();
    if (item.SeasonId) params.set('season', item.SeasonId);
    if (item.Id) params.set('episode', item.Id);
    return `${to.item(item.SeriesId)}?${params}`;
  }
  return to.item(item.Id!);
}

/** The item's page, opening on its version list. */
export function versionsPath(
  item: Pick<BaseItemDto, 'Id' | 'Type' | 'SeriesId' | 'SeasonId'>,
  playlist?: string
): string {
  const path = itemPath(item);
  return `${path}${path.includes('?') ? '&' : '?'}pick=${item.Id}${playlist ? `&playlist=${playlist}` : ''}`;
}

export const href = (path: string) => `#${path}`;

/** The server's configuration page, when it has one. */
/** The server's own when it names one; the hosting server's page otherwise. */
export function configureUrl(base: string, info: ServerInfo): string | null {
  const url =
    info.configureUrl ?? (__STANDALONE__ ? null : '/stremio/configure');
  return url ? new URL(url, base).href : null;
}

interface NavigateOptions {
  replace?: boolean;
  keepScroll?: boolean;
}

type Push = (path: string, opts: NavigateOptions) => void;
type Restart = (path: string) => Promise<void>;

let push: Push = (path) => {
  window.location.hash = path;
};

let restart: Restart = async (path) => {
  window.location.hash = path;
};

export function setNavigator(fn: Push, fresh: Restart): void {
  push = fn;
  restart = fresh;
}

export function navigate(path: string, opts: NavigateOptions = {}) {
  push(path, opts);
}

/** `path` as the history's first entry, so back can't reach the pages before it. */
export function startOver(path: string): Promise<void> {
  return restart(path);
}

/** Back where the user came from, or to `fallback` on a page opened directly. */
export function goBack(fallback: string): void {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback, { replace: true });
}
