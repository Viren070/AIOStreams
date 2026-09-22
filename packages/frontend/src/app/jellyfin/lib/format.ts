import type { BaseItemDto } from './types';

export const TICKS_PER_MS = 10_000;

export function ticksToMs(ticks: number | null | undefined): number {
  return ticks ? Math.round(ticks / TICKS_PER_MS) : 0;
}

export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return h
    ? `${h}:${mm}:${String(s).padStart(2, '0')}`
    : `${mm}:${String(s).padStart(2, '0')}`;
}

export function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes <= 0) return '';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function relativeTime(at: number | null | undefined): string {
  if (!at) return '';
  const diff = Date.now() - at;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} d ago`;
  return new Date(at).toLocaleDateString();
}

/** `S01E04`, or `E04` for absolute numbering. */
export function episodeCode(
  season: number | null | undefined,
  episode: number | null | undefined
): string {
  if (episode == null) return '';
  const e = `E${String(episode).padStart(2, '0')}`;
  return season == null ? e : `S${String(season).padStart(2, '0')}${e}`;
}

/** The line under a title: the episode for an episode, the year otherwise. */
export function itemSubtitle(item: BaseItemDto): string {
  if (item.Type === 'Episode') {
    const code = episodeCode(item.ParentIndexNumber, item.IndexNumber);
    return [code, item.Name].filter(Boolean).join(' · ');
  }
  return item.ProductionYear ? String(item.ProductionYear) : '';
}

export function itemTitle(item: BaseItemDto): string {
  return (item.Type === 'Episode' && item.SeriesName) || item.Name || '';
}

export function progressOf(item: BaseItemDto): number | null {
  const pct = item.UserData?.PlayedPercentage;
  if (pct != null && pct > 0) return Math.min(100, pct);
  const pos = item.UserData?.PlaybackPositionTicks;
  if (pos && item.RunTimeTicks)
    return Math.min(100, (pos / item.RunTimeTicks) * 100);
  return null;
}

export function remainingMs(item: BaseItemDto): number {
  const total = ticksToMs(item.RunTimeTicks);
  const pos = ticksToMs(item.UserData?.PlaybackPositionTicks);
  return total > pos ? total - pos : 0;
}

const LIBRARY_KIND: Record<string, string> = {
  movies: 'Movies',
  tvshows: 'Shows',
  boxsets: 'Collections',
};

/** Tells apart libraries that share a name, such as two "Popular" catalogs. */
export function libraryLabel(view: BaseItemDto): string | undefined {
  return view.CollectionType
    ? LIBRARY_KIND[String(view.CollectionType)]
    : undefined;
}

const DAY_MS = 86_400_000;

/**
 * Jellyfin's word for an episode it cannot play: unaired when it is dated in
 * the future, missing otherwise.
 */
export function unavailableLabel(item: BaseItemDto): string | null {
  if (item.LocationType !== 'Virtual') return null;
  const at = item.PremiereDate ? Date.parse(item.PremiereDate) : NaN;
  return Number.isNaN(at) || at > Date.now() ? 'Unaired' : 'Missing';
}

/** `20 Jan 2008` */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** `Sun, 28 Sep` */
export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** `today`, `tomorrow`, `in 6 days` or `in 3 weeks`, counted in calendar days. */
export function untilLabel(iso: string): string {
  const midnight = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round(
    (midnight(new Date(iso)) - midnight(new Date())) / DAY_MS
  );
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  return days < 14
    ? format.format(days, 'day')
    : format.format(Math.round(days / 7), 'week');
}

/** Whole years from one date to another, or to today. */
export function yearsBetween(fromIso: string, toIso?: string | null): number {
  const from = new Date(fromIso);
  const to = toIso ? new Date(toIso) : new Date();
  let years = to.getFullYear() - from.getFullYear();
  if (
    to.getMonth() < from.getMonth() ||
    (to.getMonth() === from.getMonth() && to.getDate() < from.getDate())
  )
    years -= 1;
  return years;
}
