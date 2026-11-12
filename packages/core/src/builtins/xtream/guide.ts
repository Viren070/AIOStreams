import { Cache } from '../../utils/cache.js';
import { createLogger } from '../../utils/index.js';
import { config as appConfig } from '../../config/index.js';
import type { XtreamClient, XtreamListing } from './api.js';
import { TieredStore, deltas, sums } from './store.js';

const logger = createLogger('xtream');

/** One guide id's programmes by start, times in seconds. */
export interface Schedule {
  starts: Uint32Array;
  ends: Uint32Array;
  titles: string[];
  overviews: string[];
}

export const EMPTY: Schedule = {
  starts: new Uint32Array(0),
  ends: new Uint32Array(0),
  titles: [],
  overviews: [],
};

const DAY = 86_400;
const STALE_SECONDS = DAY;
const RETRY_SECONDS = 10 * 60;
const SOON_SECONDS = 15 * 60;
/** Programmes kept ahead; tables run a few days, and some far longer. */
const AHEAD_DAYS = 8;

const sizeOf = (s: Schedule) =>
  s.starts.byteLength +
  s.ends.byteLength +
  s.titles.reduce((n, t) => n + 2 * t.length + 16, 0) +
  s.overviews.reduce((n, t) => n + 2 * t.length + 16, 0);

// A guide is the same for every account on a server, so it is kept per
// server and guide id, which the variants of a channel share.
const tables = new TieredStore<
  Schedule,
  { starts: number[]; lengths: number[]; titles: string[]; overviews: string[] }
>('xtream-guide', {
  memoryBytes: () => appConfig.builtins.xtream.guideMemory,
  sizeOf,
  encode: (s) => ({
    starts: deltas(s.starts),
    lengths: Array.from(s.ends, (end, i) => end - s.starts[i]),
    titles: s.titles,
    overviews: s.overviews,
  }),
  decode: (s) => {
    const starts = sums(s.starts, Uint32Array);
    return {
      starts,
      ends: Uint32Array.from(s.lengths, (length, i) => starts[i] + length),
      titles: s.titles,
      overviews: s.overviews,
    };
  },
});
const soon = Cache.getInstance<string, Schedule>(
  'xtream-guide-soon',
  () => appConfig.builtins.xtream.guideMemory / 8,
  'memory',
  { clone: false, sizeOf }
);

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Providers send titles in base64, a few as they are. */
function decode(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  if (value.length % 4 === 0 && BASE64.test(value)) {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    if (!decoded.includes('\uFFFD')) return decoded.trim();
  }
  return value.trim();
}

function build(listings: XtreamListing[], daysBack: number): Schedule {
  const now = Date.now() / 1000;
  const from = now - Math.max(1, daysBack) * DAY;
  const to = now + AHEAD_DAYS * DAY;
  const rows: { start: number; end: number; listing: XtreamListing }[] = [];
  for (const listing of listings) {
    const start = Number(listing.start_timestamp);
    const end = Number(listing.stop_timestamp);
    if (!(end > start) || end <= from || start >= to) continue;
    rows.push({ start, end, listing });
  }
  rows.sort((a, b) => a.start - b.start);
  return {
    starts: Uint32Array.from(rows, (r) => r.start),
    ends: Uint32Array.from(rows, (r) => r.end),
    titles: rows.map((r) => decode(r.listing.title)),
    overviews: rows.map((r) => decode(r.listing.description)),
  };
}

const keyOf = (client: XtreamClient, epgId: string) =>
  `${client.base}\n${epgId}`;

function failed(err: unknown) {
  logger.warn(
    { err: err instanceof Error ? err.message : err },
    'xtream guide request failed'
  );
}

async function loadTable(
  client: XtreamClient,
  key: string,
  streamId: number,
  daysBack: number,
  urgent: boolean
): Promise<Schedule> {
  try {
    return await tables.load(
      key,
      async () => ({
        value: build(await client.listings(streamId, urgent), daysBack),
        ttl: appConfig.builtins.xtream.guideTtl + STALE_SECONDS,
      }),
      appConfig.builtins.xtream.timeout + 5_000
    );
  } catch (err) {
    failed(err);
    // The old table, or a marker, holds off the next try here.
    const old = (await tables.peek(key))?.[0];
    await tables.setLocal(key, old ?? EMPTY, RETRY_SECONDS + STALE_SECONDS);
    return old ?? EMPTY;
  }
}

/** A guide id's whole table, asked for through one of its channels. */
export function tableOf(
  client: XtreamClient,
  epgId: string,
  streamId: number,
  daysBack: number,
  urgent = true
): Promise<Schedule> {
  const key = keyOf(client, epgId);
  return tables.getOrRevalidate(
    key,
    () => loadTable(client, key, streamId, daysBack, urgent),
    () => loadTable(client, key, streamId, daysBack, false).then(() => {}),
    STALE_SECONDS
  );
}

/** The table if it's loaded here or shared, refreshed behind it once old. */
export async function cachedTable(
  client: XtreamClient,
  epgId: string,
  streamId: number,
  daysBack: number
): Promise<Schedule | undefined> {
  const found = await tables.peek(keyOf(client, epgId));
  if (!found || found[0] === EMPTY) return undefined;
  return tableOf(client, epgId, streamId, daysBack, false);
}

/** What's on now and next. */
export async function soonOf(
  client: XtreamClient,
  epgId: string,
  streamId: number
): Promise<Schedule> {
  const key = keyOf(client, epgId);
  const cached = await soon.get(key);
  if (cached) return cached;
  let schedule = EMPTY;
  try {
    schedule = build(await client.shortListings(streamId), 0);
  } catch (err) {
    failed(err);
  }
  await soon.set(
    key,
    schedule,
    schedule === EMPTY ? RETRY_SECONDS : SOON_SECONDS
  );
  return schedule;
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
