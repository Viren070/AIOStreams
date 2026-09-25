import type { BaseItemDto, Branding } from './types';

/*
 * The app routes on the URL hash, like jellyfin-web, so it works under any
 * mount of the API.
 */

export const to = {
  home: '/',
  history: '/history',
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
  play: (itemId: string, sourceId: string, startMs = 0) =>
    `/play/${itemId}?source=${sourceId}${startMs ? `&start=${Math.round(startMs)}` : ''}`,
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

export const href = (path: string) => `#${path}`;

/** AIOStreams' configuration page, when the server is AIOStreams. */
export function configureUrl(base: string, branding: Branding): string | null {
  return !__STANDALONE__ || branding.aiostreams
    ? new URL('/stremio/configure', base).href
    : null;
}

type Push = (path: string, replace?: boolean) => void;

let push: Push = (path) => {
  window.location.hash = path;
};

export function setNavigator(fn: Push): void {
  push = fn;
}

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  push(path, opts.replace);
}

/** Back where the user came from, or to `fallback` on a page opened directly. */
export function goBack(fallback: string): void {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback, { replace: true });
}
