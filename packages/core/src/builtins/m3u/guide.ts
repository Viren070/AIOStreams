import { Cache } from '../../utils/cache.js';
import {
  createLogger,
  getSimpleTextHash,
  makeUrlLogSafe,
} from '../../utils/index.js';
import { config as appConfig } from '../../config/index.js';
import {
  EMPTY,
  type Schedule,
  TieredStore,
  decodeSchedule,
  encodeSchedule,
  pack,
  scheduleBytes,
  unpack,
} from '../livetv/index.js';
import { TooLargeError, download, textOf } from './fetch.js';
import { MAX_NAME } from './playlist.js';
import { MAX_NAMES, type XmltvProgramme, readXmltv } from './xmltv.js';

const logger = createLogger('m3u');

const DAY = 86_400;
const STALE_SECONDS = DAY;
/** How long a guide that failed waits before it is tried again. */
const RETRY_SECONDS = 3600;
/** Programmes kept ahead; Stremio and Jellyfin show a week. */
const AHEAD_DAYS = 8;
/** Programmes kept back in a guide's read for everyone. */
const SHARED_BACK_DAYS = 7;
/** Programmes per channel: about 17 days of 5-minute slots. */
const MAX_CHANNEL_PROGRAMMES = 5000;
/** Reads waiting their turn; past this, the longest line's last gives way. */
const MAX_QUEUED = 500;
/** A read's channel ids and names at most, by the metas' `sizeOf`. */
const MAX_META_BYTES = 4 * 1000 * 1000;
/** Channels a guide read for everyone keeps; one with more is read per playlist. */
const SHARED_CHANNELS = 3000;
/** Most bytes per database row; the cache's rows are shared and capped. */
const ROW_BYTES = 1000 * 1000;

/** A name as Kodi matches it: lowercase, with `_` as a space. */
export const nameKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
    .trim();

/**
 * A `tvg-id` lowercased, then without a quality feed such as `@HD`; other
 * feeds may air another schedule.
 */
export const idKeys = (tvgId: string) => {
  const id = tvgId.toLowerCase();
  return [...new Set([id, id.replace(/@(sd|hd|fhd|uhd|4k)$/, '')])].filter(
    Boolean
  );
};

/** What a playlist wants from guides. */
export interface Wants {
  /** `i:` and a lowercase id, or `n:` and a {@link nameKey}. */
  keys: string[];
  /** A hash of the keys and days back, telling playlists' wants apart. */
  id: string;
  daysBack: number;
}

/** What a read of a guide found; its programmes are stored apart. */
export interface GuideMeta {
  /** Where its programmes are stored, apart from other reads'. */
  key: string;
  /** Lowercase ids of the channels with programmes, to their database row. */
  channels: Map<string, number>;
  /** Name keys matched to a channel id. */
  names: Map<string, string>;
  /** Too large to keep whole, so each playlist reads its own channels. */
  large?: true;
  failed?: true;
}

type StoredMeta = Omit<GuideMeta, 'channels' | 'names'> & {
  channels: [string, number][];
  names: [string, string][];
};

const idBytes = (id: string) => 64 + 2 * id.length;
const nameBytes = (key: string, id: string) =>
  64 + 2 * (key.length + id.length);

const metas = new TieredStore<GuideMeta, StoredMeta>('m3u-guide-meta', {
  memoryBytes: () => 16 * 1000 * 1000,
  sizeOf: (m) => {
    let bytes = 0;
    for (const id of m.channels.keys()) bytes += idBytes(id);
    for (const [k, id] of m.names) bytes += nameBytes(k, id);
    return bytes;
  },
  encode: (m) => ({ ...m, channels: [...m.channels], names: [...m.names] }),
  decode: (m) => ({
    ...m,
    channels: new Map(m.channels),
    names: new Map(m.names),
  }),
});

/** Schedules by read and channel; the database holds them in rows. */
const memory = Cache.getInstance<string, Schedule>(
  'm3u-guide',
  () => appConfig.builtins.m3u.guideMemory,
  'memory',
  { clone: false, sizeOf: scheduleBytes }
);

/** Some channels' schedules, each packed, and when they expire. */
interface Row {
  until: number;
  channels: [string, string][];
}

const rows = Cache.getInstance<string, Row>('m3u-guide-rows', undefined, 'sql');

/** Reads whose rows the database cache dropped. */
const lost = Cache.getInstance<string, true>(
  'm3u-guide-lost',
  10_000,
  'memory'
);
/**
 * Guides read again for that lately, so a thrashing cache can't cause a
 * download per request.
 */
const reread = Cache.getInstance<string, true>(
  'm3u-guide-reread',
  10_000,
  'memory'
);

/** A guide's read for everyone, or a playlist's own; hashed, as URLs may hold logins. */
const readKey = (url: string, wants?: Wants) =>
  getSimpleTextHash(wants ? `${url}\n${wants.id}` : url);

const ttl = () => appConfig.builtins.m3u.guideTtl + STALE_SECONDS;

class BusyError extends Error {}
/** A guide over the limits of a read for everyone. */
class LargeError extends Error {}

/** Reads at once by this instance; the rest wait, taking turns by playlist. */
let active = 0;
let waiting = 0;
type Turn = { go: () => void; drop: () => void };
const queues = new Map<string, Turn[]>();

async function inTurn<T>(owner: string, task: () => Promise<T>): Promise<T> {
  if (active >= appConfig.builtins.m3u.guideConcurrency) {
    if (waiting >= MAX_QUEUED) {
      // The longest line gives up its last, so a new playlist still gets in,
      // unless its own line would be as long.
      let longest: Turn[] = [];
      for (const queue of queues.values())
        if (queue.length > longest.length) longest = queue;
      if ((queues.get(owner)?.length ?? 0) + 1 >= longest.length)
        throw new BusyError();
      longest.pop()!.drop();
      waiting--;
    }
    waiting++;
    await new Promise<void>((go, reject) => {
      const entry = { go, drop: () => reject(new BusyError()) };
      const queue = queues.get(owner);
      if (queue) queue.push(entry);
      else queues.set(owner, [entry]);
    });
  } else {
    active++;
  }
  try {
    return await task();
  } finally {
    active--;
    // As many as the limit allows go next, each the first playlist in line,
    // which then goes to the back.
    while (active < appConfig.builtins.m3u.guideConcurrency) {
      const first = queues.entries().next();
      if (first.done) break;
      const [owner, queue] = first.value;
      queues.delete(owner);
      const next = queue.shift()!;
      if (queue.length) queues.set(owner, queue);
      waiting--;
      active++;
      next.go();
    }
  }
}

/** Sorted by start, cut to `cap`: drops past ones, then the furthest ahead. */
function nearNow(list: XmltvProgramme[], now: number, cap: number) {
  list.sort((a, b) => a.start - b.start);
  if (list.length <= cap) return list;
  const later = list.findIndex((p) => p.start > now);
  const on = later < 0 ? list.length - 1 : Math.max(0, later - 1);
  const first = Math.min(list.length - cap, on);
  return list.slice(first, first + cap);
}

function scheduleOf(
  list: XmltvProgramme[],
  from: number,
  to: number,
  now: number
): Schedule {
  list = nearNow(list, now, MAX_CHANNEL_PROGRAMMES);
  // Stable sort: of programmes starting together, the guide's last stays, as in Kodi.
  const unique = list.filter((p, i) => p.start !== list[i + 1]?.start);
  // A programme without a stop ends where the next begins.
  for (let i = 0; i < unique.length; i++)
    if (!(unique[i].stop > unique[i].start))
      unique[i].stop = unique[i + 1]?.start ?? 0;
  const kept = unique.filter(
    (p) => p.stop > p.start && p.stop > from && p.start < to
  );
  const has = (pick: (p: XmltvProgramme) => unknown) => kept.some(pick);
  return {
    starts: Uint32Array.from(kept, (p) => p.start),
    // Cut at the window, as far-off ends overflow.
    ends: Uint32Array.from(kept, (p) => Math.min(p.stop, to)),
    titles: kept.map((p) => p.title),
    overviews: kept.map((p) => p.desc),
    thumbnails: has((p) => p.icon) ? kept.map((p) => p.icon) : undefined,
    genres: has((p) => p.categories.length)
      ? kept.map((p) => p.categories)
      : undefined,
    seasons: has((p) => p.season)
      ? Uint16Array.from(kept, (p) => p.season)
      : undefined,
    episodes: has((p) => p.episode)
      ? Uint16Array.from(kept, (p) => p.episode)
      : undefined,
    zones: has((p) => p.zone)
      ? Int16Array.from(kept, (p) => p.zone)
      : undefined,
  };
}

/**
 * Downloads a guide and stores its programmes: every channel's in a read for
 * everyone, which a guide over the limits fails, else a playlist's alone.
 */
async function read(
  url: string,
  key: string,
  wants?: Wants
): Promise<GuideMeta> {
  const wantedIds = new Set<string>();
  const wantedNames = new Set<string>();
  for (const k of wants?.keys ?? [])
    (k[0] === 'i' ? wantedIds : wantedNames).add(k.slice(2));
  const names = new Map<string, string>();
  /** Names taken per id, merged across its elements as Kodi does. */
  const named = new Map<string, number>();
  const kept = new Set<string>();
  const found = new Map<string, XmltvProgramme[]>();
  let count = 0;
  const now = Date.now() / 1000;
  const from = now - (wants ? wants.daysBack : SHARED_BACK_DAYS) * DAY;
  const to = now + AHEAD_DAYS * DAY;
  /** Channels and programmes seen, wanted or not. */
  let elements = 0;
  let metaBytes = 0;
  let capped = false;

  /** Whether the meta has room; a read for everyone fails without. */
  const fits = (bytes: number) => {
    if (metaBytes + bytes > MAX_META_BYTES) {
      if (!wants) throw new LargeError();
      return false;
    }
    metaBytes += bytes;
    return true;
  };
  const keep = (id: string) => {
    if (kept.has(id)) return;
    if (kept.size >= SHARED_CHANNELS && !wants) throw new LargeError();
    if (fits(idBytes(id))) kept.add(id);
  };
  await readXmltv(textOf(download(url, 'guide'), true), {
    channel({ id, names: displayNames }) {
      elements++;
      const lower = id.toLowerCase();
      if (!wants || wantedIds.has(lower)) keep(lower);
      for (const name of displayNames) {
        const taken = named.get(lower) ?? 0;
        if (taken >= MAX_NAMES) break;
        const k = nameKey(name);
        // Past `MAX_NAME`, it can't match a playlist's.
        if (
          k.length > MAX_NAME ||
          names.has(k) ||
          (wants && !wantedNames.has(k))
        )
          continue;
        if (!fits(nameBytes(k, lower))) break;
        names.set(k, lower);
        named.set(lower, taken + 1);
        keep(lower);
      }
    },
    wants(channel) {
      elements++;
      const lower = channel.toLowerCase();
      // Guides may leave out their channel elements.
      if (!wants || wantedIds.has(lower)) keep(lower);
      return kept.has(lower);
    },
    programme(p) {
      // A day's margin keeps those whose stop comes from the next programme.
      if (p.start <= 0 || p.start >= to + DAY) return;
      if (p.stop > p.start ? p.stop <= from : p.start < from - DAY) return;
      const channel = p.channel.toLowerCase();
      let list = found.get(channel);
      if (!list) found.set(channel, (list = []));
      if (list.length >= 2 * MAX_CHANNEL_PROGRAMMES) {
        // Dense channels keep those nearest now, not the guide's first.
        const near = nearNow(list, now, MAX_CHANNEL_PROGRAMMES);
        count -= list.length - near.length;
        found.set(channel, (list = near));
      }
      if (count >= appConfig.builtins.m3u.guideMaxProgrammes) {
        if (!wants) throw new LargeError();
        if (!capped) {
          capped = true;
          logger.info(
            { url: makeUrlLogSafe(url) },
            'm3u guide programmes past BUILTIN_M3U_GUIDE_MAX_PROGRAMMES left out'
          );
        }
        return;
      }
      count++;
      list.push(p);
    },
  });

  // Such as an error page, which isn't an empty guide.
  if (!elements)
    throw new Error('The guide has no XMLTV channels or programmes');

  const readId = `${key}:${Date.now().toString(36)}`;
  // Under the cache's value limit, past which it drops rows.
  const max = appConfig.resources.cache.maxValueBytes;
  const budget = max ? Math.min(ROW_BYTES, max * 0.75) : ROW_BYTES;
  const channels = new Map<string, number>();
  const filled: [string, string][][] = [];
  let row: [string, string][] = [];
  let bytes = 0;
  for (const [channel, list] of found) {
    found.delete(channel); // Freed as it goes.
    const schedule = scheduleOf(list, from, to, now);
    if (!schedule.starts.length) continue;
    const packed = await pack(encodeSchedule(schedule));
    const size = packed.length + Buffer.byteLength(JSON.stringify(channel)) + 6; // Its JSON bytes.
    // Too large for a row of its own, so left out.
    if (size > budget) continue;
    if (bytes + size > budget) {
      filled.push(row);
      row = [];
      bytes = 0;
    }
    row.push([channel, packed]);
    bytes += size;
    channels.set(channel, filled.length);
  }
  if (bytes) filled.push(row);
  // Into the database alone, so a read doesn't evict schedules in use.
  const seconds = ttl();
  const until = Date.now() + seconds * 1000;
  for (const [at, entries] of filled.entries())
    await rows.set(`${readId}\n${at}`, { until, channels: entries }, seconds);
  await rows.flush();
  for (const [k, id] of names) if (!channels.has(id)) names.delete(k);
  logger.debug(
    { url: makeUrlLogSafe(url), channels: channels.size, shared: !wants },
    'm3u guide read'
  );
  return { key: readId, channels, names };
}

const pending = new Map<string, Promise<GuideMeta>>();

/**
 * Reads a guide once across replicas, in the playlist's turn. A failed first
 * read is marked for a while; a failed refresh keeps the old one.
 */
function load(
  url: string,
  owner: string,
  wants: Wants | undefined,
  old?: GuideMeta
): Promise<GuideMeta> {
  const key = readKey(url, wants);
  const loading = pending.get(key);
  if (loading) return loading;
  const marked = (flag: 'large' | 'failed'): GuideMeta => ({
    key,
    channels: new Map(),
    names: new Map(),
    [flag]: true,
  });
  const next = inTurn(owner, () =>
    metas.load(
      key,
      async () => {
        try {
          return { value: await read(url, key, wants), ttl: ttl() };
        } catch (err) {
          if (!(err instanceof LargeError)) throw err;
          return { value: marked('large'), ttl: ttl() };
        }
      },
      // Covers the download, then storing its schedules.
      appConfig.builtins.m3u.guideTimeout + 60_000
    )
  )
    .catch(async (err) => {
      // Left unmarked, for the next request to queue again.
      if (err instanceof BusyError) throw err;
      logger.warn(
        {
          url: makeUrlLogSafe(url),
          err: err instanceof Error ? err.message : err,
        },
        'm3u guide read failed'
      );
      if (old) {
        await metas.setLocal(key, old, RETRY_SECONDS + STALE_SECONDS);
        return old;
      }
      // One over the size limit stays failed until its next refresh. Kept in
      // this replica: in the database it'd replace another's good stale copy.
      const failed = marked('failed');
      await metas.setLocal(
        key,
        failed,
        err instanceof TooLargeError
          ? appConfig.builtins.m3u.guideTtl
          : RETRY_SECONDS
      );
      return failed;
    })
    .finally(() => pending.delete(key));
  pending.set(key, next);
  return next;
}

/**
 * The stored read, made now if missing; redone in the background once old or
 * its rows are gone.
 */
async function current(
  url: string,
  owner: string,
  wants?: Wants
): Promise<GuideMeta> {
  const key = readKey(url, wants);
  const found = await metas.peek(key);
  if (!found) return load(url, owner, wants);
  const [meta, left] = found;
  const rowsGone = (await lost.get(meta.key)) && !(await reread.get(key));
  if (rowsGone) await reread.set(key, true, RETRY_SECONDS);
  if ((left < STALE_SECONDS || rowsGone) && !meta.failed)
    void load(url, owner, wants, meta).catch(async (err) => {
      if (rowsGone && err instanceof BusyError) await reread.delete(key);
    });
  return meta;
}

/**
 * What a guide holds for a playlist: its read for everyone, unless the guide
 * is too large for one or the playlist's catch-up goes back further.
 */
export async function guideOf(url: string, wants: Wants): Promise<GuideMeta> {
  if (wants.daysBack <= SHARED_BACK_DAYS) {
    const shared = await current(url, wants.id);
    if (!shared.large) return shared;
  }
  return current(url, wants.id, wants);
}

/**
 * The guide and its channel id for a playlist channel, if one has programmes.
 * As Kodi: the id in every guide, then each name in every guide, so a later
 * guide's id wins over an earlier one's name.
 */
export function channelIn(
  reads: (GuideMeta | undefined)[],
  tvgId: string,
  names: string[]
): [GuideMeta, string] | undefined {
  for (const id of idKeys(tvgId))
    for (const meta of reads) if (meta?.channels.has(id)) return [meta, id];
  for (const name of names) {
    const key = nameKey(name);
    for (const meta of reads) {
      const matched = meta?.names.get(key);
      if (meta && matched) return [meta, matched];
    }
  }
  return undefined;
}

/** Each channel's programmes in a read, from memory, else from its row. */
export async function schedulesIn(
  meta: GuideMeta,
  channels: string[]
): Promise<Schedule[]> {
  const found = await Promise.all(
    channels.map((c) => memory.get(`${meta.key}\n${c}`))
  );
  const byRow = new Map<number, number[]>();
  found.forEach((schedule, i) => {
    const row = meta.channels.get(channels[i]);
    if (schedule || row === undefined) return;
    let at = byRow.get(row);
    if (!at) byRow.set(row, (at = []));
    at.push(i);
  });
  await Promise.all(
    [...byRow].map(async ([row, at]) => {
      const stored = await rows
        .get(`${meta.key}\n${row}`)
        .catch(() => undefined);
      const left = stored ? Math.floor((stored.until - Date.now()) / 1000) : 0;
      if (!stored || !(left > 0)) {
        await lost.set(meta.key, true, RETRY_SECONDS);
        return;
      }
      const inRow = new Map(stored.channels);
      for (const i of at) {
        const data = inRow.get(channels[i]);
        if (!data) continue;
        try {
          found[i] = decodeSchedule(await unpack(data));
        } catch {
          // Written by another version.
          await lost.set(meta.key, true, RETRY_SECONDS);
          continue;
        }
        await memory.set(`${meta.key}\n${channels[i]}`, found[i]!, left);
      }
    })
  );
  return found.map((schedule) => schedule ?? EMPTY);
}
