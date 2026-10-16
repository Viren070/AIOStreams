import { t } from '@lingui/core/macro';
import { formatLocale } from './i18n';
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
  if (minutes < 60)
    return t({ comment: 'Minutes, as in 45m', message: `${minutes}m` });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest
    ? t({
        comment: 'Hours and minutes, as in 1h 15m',
        message: `${hours}h ${rest}m`,
      })
    : t({ comment: 'Hours, as in 2h', message: `${hours}h` });
}

export function relativeTime(at: number | null | undefined): string {
  if (!at) return '';
  const diff = Date.now() - at;
  if (diff < 60_000) return t`just now`;
  const format = new Intl.RelativeTimeFormat(formatLocale(), {
    style: 'short',
  });
  if (diff < 3_600_000)
    return format.format(-Math.floor(diff / 60_000), 'minute');
  if (diff < 86_400_000)
    return format.format(-Math.floor(diff / 3_600_000), 'hour');
  if (diff < 7 * 86_400_000)
    return format.format(-Math.floor(diff / 86_400_000), 'day');
  return new Date(at).toLocaleDateString(formatLocale());
}

/** `S01E04`, or `E04` for absolute numbering. */
export function episodeCode(
  season: number | null | undefined,
  episode: number | null | undefined
): string {
  if (episode == null) return '';
  const e = String(episode).padStart(2, '0');
  if (season == null)
    return t({ comment: 'An episode number, as in E04', message: `E${e}` });
  const s = String(season).padStart(2, '0');
  return t({
    comment: 'A season and episode number, as in S01E04',
    message: `S${s}E${e}`,
  });
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

/** The title with the episode for an episode, for another player's window. */
export function fullTitle(item: BaseItemDto): string {
  return [itemTitle(item), item.Type === 'Episode' && itemSubtitle(item)]
    .filter(Boolean)
    .join(' · ');
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

/** Tells apart libraries that share a name, such as two "Popular" catalogs. */
export function libraryLabel(view: BaseItemDto): string | undefined {
  switch (view.CollectionType) {
    case 'movies':
      return t`Movies`;
    case 'tvshows':
      return t`Shows`;
    case 'boxsets':
      return t`Collections`;
    default:
      return undefined;
  }
}

const DAY_MS = 86_400_000;

/**
 * Why Jellyfin can't play an episode: unaired when it is dated in the future,
 * missing otherwise.
 */
export function unavailableKind(
  item: BaseItemDto
): 'unaired' | 'missing' | null {
  if (item.LocationType !== 'Virtual') return null;
  const at = item.PremiereDate ? Date.parse(item.PremiereDate) : NaN;
  return Number.isNaN(at) || at > Date.now() ? 'unaired' : 'missing';
}

export function unavailableLabel(item: BaseItemDto): string | null {
  const kind = unavailableKind(item);
  return kind === 'unaired' ? t`Unaired` : kind && t`Missing`;
}

export type EpisodeMark = 'filler' | 'recap';

/** Marks a server with the `fillers` feature puts on an episode. */
export function episodeMarks(item: BaseItemDto): EpisodeMark[] {
  const marks = (item as { aiostreams?: { filler?: boolean; recap?: boolean } })
    .aiostreams;
  return [
    ...(marks?.filler === true ? (['filler'] as const) : []),
    ...(marks?.recap === true ? (['recap'] as const) : []),
  ];
}

export const markLabel = (mark: EpisodeMark) =>
  mark === 'filler' ? t`Filler` : t`Recap`;

/** `20 Jan 2008` */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(formatLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Jellyfin stores a date without a time as midnight UTC, written with seven
 * zeroes; a time from a JavaScript server has three, so its midnight is real.
 */
function dateOnly(iso: string): boolean {
  return !iso.includes('T') || /T00:00:00(\.0{7})?Z$/.test(iso);
}

/** The local day something airs; a date without a time keeps its own day. */
export function airDay(iso: string): Date {
  const at = new Date(iso);
  return dateOnly(iso)
    ? new Date(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())
    : new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

export function airTime(iso: string): string | null {
  if (dateOnly(iso)) return null;
  return new Date(iso).toLocaleTimeString(formatLocale(), {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** `Sun, 28 Sep` */
export function dayLabel(iso: string): string {
  return airDay(iso).toLocaleDateString(formatLocale(), {
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
    (midnight(airDay(iso)) - midnight(new Date())) / DAY_MS
  );
  const format = new Intl.RelativeTimeFormat(formatLocale(), {
    numeric: 'auto',
  });
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
