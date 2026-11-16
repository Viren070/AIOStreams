import type { Meta } from '../../db/index.js';
import { deltas, sums } from './store.js';

/** One guide id's programmes by start, times in seconds. */
export interface Schedule {
  starts: Uint32Array;
  ends: Uint32Array;
  titles: string[];
  overviews: string[];
}

export interface StoredSchedule {
  starts: number[];
  lengths: number[];
  titles: string[];
  overviews: string[];
}

export const EMPTY: Schedule = {
  starts: new Uint32Array(0),
  ends: new Uint32Array(0),
  titles: [],
  overviews: [],
};

const stringBytes = (list: string[]) =>
  list.reduce((n, t) => n + 2 * t.length + 16, 0);

export const scheduleBytes = (s: Schedule) =>
  s.starts.byteLength +
  s.ends.byteLength +
  stringBytes(s.titles) +
  stringBytes(s.overviews);

export const encodeSchedule = (s: Schedule): StoredSchedule => ({
  starts: deltas(s.starts),
  lengths: Array.from(s.ends, (end, i) => end - s.starts[i]),
  titles: s.titles,
  overviews: s.overviews,
});

export function decodeSchedule(s: StoredSchedule): Schedule {
  const starts = sums(s.starts, Uint32Array);
  return {
    starts,
    ends: Uint32Array.from(s.lengths, (length, i) => starts[i] + length),
    titles: s.titles,
    overviews: s.overviews,
  };
}

export function onAt(schedule: Schedule, at: number): boolean {
  const i = firstOnAt(schedule, at);
  return i < schedule.starts.length && schedule.starts[i] <= at;
}

/** The index of the first programme still on at `at`. */
export function firstOnAt(schedule: Schedule, at: number): number {
  let low = 0;
  let high = schedule.starts.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (schedule.starts[mid] < at) low = mid + 1;
    else high = mid;
  }
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

/** A channel's programmes on in a window, each `<channel id>:<start>:<end>`. */
export function programmesOf(
  schedule: Schedule | undefined,
  channel: string,
  from: number,
  to: number
): Video[] {
  if (!schedule) return [];
  const videos: Video[] = [];
  for (
    let at = firstOnAt(schedule, from);
    at < schedule.starts.length && schedule.starts[at] < to;
    at++
  ) {
    const start = schedule.starts[at];
    const end = schedule.ends[at];
    videos.push({
      id: `${channel}:${start}:${end}`,
      title: schedule.titles[at],
      startTime: isoTime(start),
      endTime: isoTime(end),
      overview: schedule.overviews[at] || undefined,
    });
  }
  return videos;
}

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
