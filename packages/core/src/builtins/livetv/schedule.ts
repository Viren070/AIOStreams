import type { Meta } from '../../db/index.js';
import { deltas, sums } from './store.js';

/**
 * One guide id's programmes by start, times in seconds. The optional columns
 * are left out when no programme has them; '', 0 or [] marks one without.
 */
export interface Schedule {
  starts: Uint32Array;
  ends: Uint32Array;
  titles: string[];
  overviews: string[];
  thumbnails?: string[];
  genres?: string[][];
  seasons?: Uint16Array;
  episodes?: Uint16Array;
  /** The guide's UTC offset per programme, in minutes. */
  zones?: Int16Array;
}

export interface StoredSchedule {
  starts: number[];
  lengths: number[];
  titles: string[];
  overviews: string[];
  thumbnails?: string[];
  genres?: string[][];
  seasons?: number[];
  episodes?: number[];
  zones?: number[];
}

export const EMPTY: Schedule = {
  starts: new Uint32Array(0),
  ends: new Uint32Array(0),
  titles: [],
  overviews: [],
};

const stringBytes = (list: string[] = []) =>
  list.reduce((n, t) => n + 2 * t.length + 16, 0);

export const scheduleBytes = (s: Schedule) =>
  s.starts.byteLength +
  s.ends.byteLength +
  (s.seasons?.byteLength ?? 0) +
  (s.episodes?.byteLength ?? 0) +
  (s.zones?.byteLength ?? 0) +
  stringBytes(s.titles) +
  stringBytes(s.overviews) +
  stringBytes(s.thumbnails) +
  (s.genres?.reduce((n, g) => n + 16 + stringBytes(g), 0) ?? 0);

export const encodeSchedule = (s: Schedule): StoredSchedule => ({
  starts: deltas(s.starts),
  lengths: Array.from(s.ends, (end, i) => end - s.starts[i]),
  titles: s.titles,
  overviews: s.overviews,
  thumbnails: s.thumbnails,
  genres: s.genres,
  seasons: s.seasons && Array.from(s.seasons),
  episodes: s.episodes && Array.from(s.episodes),
  zones: s.zones && Array.from(s.zones),
});

export function decodeSchedule(s: StoredSchedule): Schedule {
  const starts = sums(s.starts, Uint32Array);
  return {
    starts,
    ends: Uint32Array.from(s.lengths, (length, i) => starts[i] + length),
    titles: s.titles,
    overviews: s.overviews,
    thumbnails: s.thumbnails,
    genres: s.genres,
    seasons: s.seasons && Uint16Array.from(s.seasons),
    episodes: s.episodes && Uint16Array.from(s.episodes),
    zones: s.zones && Int16Array.from(s.zones),
  };
}

export function onAt(schedule: Schedule, at: number): boolean {
  const i = firstOnAt(schedule, at);
  return i < schedule.starts.length && schedule.starts[i] <= at;
}

/** The index of the first programme starting at or after `at`. */
export function startsFrom(schedule: Schedule, at: number): number {
  let low = 0;
  let high = schedule.starts.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (schedule.starts[mid] < at) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** The index of the first programme still on at `at`. */
export function firstOnAt(schedule: Schedule, at: number): number {
  let low = startsFrom(schedule, at);
  while (low > 0 && schedule.ends[low - 1] > at) low--;
  return low;
}

type Video = NonNullable<Meta['videos']>[number];

/** Programmes mostly start and end on the same few times of day. */
const isoTimes = new Map<number, string>();

function isoTime(seconds: number): string {
  let iso = isoTimes.get(seconds);
  if (iso === undefined) {
    if (isoTimes.size >= 20_000) isoTimes.clear();
    iso = new Date(seconds * 1000).toISOString();
    isoTimes.set(seconds, iso);
  }
  return iso;
}

/**
 * A channel's programmes on in a window, each `<channel id>:<start>:<end>`;
 * `shift` seconds move the guide's times, as an M3U `tvg-shift` does.
 */
export function programmesOf(
  schedule: Schedule | undefined,
  channel: string,
  from: number,
  to: number,
  shift = 0
): Video[] {
  if (!schedule) return [];
  const videos: Video[] = [];
  for (
    let at = firstOnAt(schedule, from - shift);
    at < schedule.starts.length && schedule.starts[at] < to - shift;
    at++
  ) {
    const start = schedule.starts[at] + shift;
    const end = schedule.ends[at] + shift;
    videos.push({
      id: `${channel}:${start}:${end}`,
      title: schedule.titles[at],
      startTime: isoTime(start),
      endTime: isoTime(end),
      overview: schedule.overviews[at] || undefined,
      thumbnail: schedule.thumbnails?.[at] || undefined,
      genres: schedule.genres?.[at]?.length ? schedule.genres[at] : undefined,
      season: schedule.seasons?.[at] || undefined,
      episode: schedule.episodes?.[at] || undefined,
    });
  }
  return videos;
}

/** A search's words, a few at most, as each is looked for in every name. */
export const searchWords = (term: string) =>
  [...new Set(term.toLowerCase().split(/\s+/).filter(Boolean))].slice(0, 8);

export function parseExtras(extras?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of extras?.split('&') ?? []) {
    const [key, ...rest] = part.split('=');
    try {
      out[key] = decodeURIComponent(rest.join('='));
    } catch {
      out[key] = rest.join('=');
    }
  }
  return out;
}
