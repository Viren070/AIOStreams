import { createLogger, getSimpleTextHash } from '../../utils/index.js';
import { config as appConfig } from '../../config/index.js';
import type {
  XtreamAccount,
  XtreamCategory,
  XtreamClient,
  XtreamStream,
} from './api.js';
import { TieredStore, deltas, sums } from './store.js';

const logger = createLogger('xtream');

/**
 * An account's channels in columns, as providers list tens of thousands:
 * names and logos are UTF-8 in one buffer each, channel `i` running from
 * `at[i]` to `at[i + 1]`.
 */
export interface Lineup {
  groups: string[];
  /** Each group's channels, by index. */
  members: Int32Array[];
  streamIds: Float64Array;
  names: Buffer;
  nameAt: Uint32Array;
  /** A logo is a folder from `iconDirs` and the rest of its address; folder -1 for none. */
  iconDirs: string[];
  iconDir: Int32Array;
  icons: Buffer;
  iconAt: Uint32Array;
  /** Index into `epgIds`, -1 for none. */
  epgOf: Int32Array;
  epgIds: string[];
  /** The longest catch-up of the channels sharing a guide id, by its index. */
  epgArchiveDays: Uint8Array;
  /** The provider's channel numbers, 0 where it has none. */
  numbers: Uint32Array;
  /** Days of catch-up, 0 for none. */
  archiveDays: Uint8Array;
  /** Index into `groups`, -1 for none. */
  groupOf: Int32Array;
  /** Channel indexes in stream id order. */
  byStreamId: Int32Array;
  formats: string[];
  timeZone: string;
}

export const channelCount = (lineup: Lineup) => lineup.streamIds.length;

export const nameOf = (lineup: Lineup, i: number) =>
  lineup.names.toString('utf8', lineup.nameAt[i], lineup.nameAt[i + 1]);

/** Channels whose names hold every word of the term, after the one numbered it. */
export function searchLineup(
  lineup: Lineup,
  term: string,
  limit: number
): number[] {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  const found: number[] = [];
  if (!words.length) return found;
  const count = channelCount(lineup);
  const number = /^\d+$/.test(term.trim()) ? Number(term.trim()) : 0;
  let numbered = -1;
  for (let i = 0; number && i < count; i++)
    if ((lineup.numbers[i] || i + 1) === number) {
      numbered = i;
      found.push(i);
      break;
    }
  for (let i = 0; i < count && found.length < limit; i++) {
    if (i === numbered) continue;
    const name = nameOf(lineup, i).toLowerCase();
    if (words.every((w) => name.includes(w))) found.push(i);
  }
  return found;
}

export const iconOf = (lineup: Lineup, i: number) =>
  lineup.iconDir[i] < 0
    ? ''
    : lineup.iconDirs[lineup.iconDir[i]] +
      lineup.icons.toString('utf8', lineup.iconAt[i], lineup.iconAt[i + 1]);

const STALE_SECONDS = 24 * 3600;
/** A failed refresh waits this long before the next, keeping the old list. */
const RETRY_SECONDS = 10 * 60;

const stringBytes = (list: string[]) =>
  list.reduce((n, s) => n + 2 * s.length + 16, 0);

const VIEWS = [
  'streamIds',
  'nameAt',
  'iconDir',
  'iconAt',
  'epgOf',
  'epgArchiveDays',
  'numbers',
  'archiveDays',
  'groupOf',
  'byStreamId',
] as const;

interface Stored {
  names: string;
  icons: string;
  nameAt: number[];
  iconAt: number[];
  streamIds: number[];
  numbers: number[];
  members: number[][];
  iconDir: number[];
  epgOf: number[];
  epgArchiveDays: number[];
  archiveDays: number[];
  groupOf: number[];
  groups: string[];
  iconDirs: string[];
  epgIds: string[];
  formats: string[];
  timeZone: string;
}

const lineups = new TieredStore<Lineup, Stored>('xtream-lineup', {
  memoryBytes: () => appConfig.builtins.xtream.lineupMemory,
  sizeOf: (l) =>
    VIEWS.reduce((n, k) => n + l[k].byteLength, 0) +
    l.names.length +
    l.icons.length +
    l.members.reduce((n, m) => n + m.byteLength, 0) +
    stringBytes(l.groups) +
    stringBytes(l.iconDirs) +
    stringBytes(l.epgIds),
  encode: (l) => ({
    names: l.names.toString('utf8'),
    icons: l.icons.toString('utf8'),
    nameAt: deltas(l.nameAt),
    iconAt: deltas(l.iconAt),
    streamIds: deltas(l.streamIds),
    numbers: deltas(l.numbers),
    members: l.members.map(deltas),
    iconDir: Array.from(l.iconDir),
    epgOf: Array.from(l.epgOf),
    epgArchiveDays: Array.from(l.epgArchiveDays),
    archiveDays: Array.from(l.archiveDays),
    groupOf: Array.from(l.groupOf),
    groups: l.groups,
    iconDirs: l.iconDirs,
    epgIds: l.epgIds,
    formats: l.formats,
    timeZone: l.timeZone,
  }),
  decode: (s) => {
    const streamIds = sums(s.streamIds, Float64Array);
    return {
      names: Buffer.from(s.names),
      icons: Buffer.from(s.icons),
      nameAt: sums(s.nameAt, Uint32Array),
      iconAt: sums(s.iconAt, Uint32Array),
      streamIds,
      numbers: sums(s.numbers, Uint32Array),
      members: s.members.map((m) => sums(m, Int32Array)),
      iconDir: Int32Array.from(s.iconDir),
      epgOf: Int32Array.from(s.epgOf),
      epgArchiveDays: Uint8Array.from(s.epgArchiveDays),
      archiveDays: Uint8Array.from(s.archiveDays),
      groupOf: Int32Array.from(s.groupOf),
      byStreamId: sortedByIds(streamIds),
      groups: s.groups,
      iconDirs: s.iconDirs,
      epgIds: s.epgIds,
      formats: s.formats,
      timeZone: s.timeZone,
    };
  },
});

/** The group names alone, which a manifest lists without the channels. */
const groupLists = new TieredStore<string[], string[]>('xtream-groups', {
  memoryBytes: () => 16 * 1000 * 1000,
  sizeOf: stringBytes,
  encode: (groups) => groups,
  decode: (groups) => groups,
});

const catchups = new TieredStore<number, number>('xtream-catchup', {
  memoryBytes: () => 1000 * 1000,
  sizeOf: () => 8,
  encode: (days) => days,
  decode: (days) => days,
});

/** Category rows the providers list among their channels, like `##### UK #####`. */
const SEPARATOR = /^\s*([#=*~_-])\1{2,}/;

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/** Indexes in id order; packed beside their ids, a native sort does it. */
function sortedByIds(ids: ArrayLike<number>): Int32Array {
  const scale = 2 ** Math.ceil(Math.log2(ids.length + 1));
  let fits = true;
  let top = 0;
  for (const id of Array.from(ids)) {
    if (!Number.isInteger(id) || id < 0) fits = false;
    if (id > top) top = id;
  }
  if (!fits || top * scale >= Number.MAX_SAFE_INTEGER) {
    return Int32Array.from({ length: ids.length }, (_, i) => i).sort(
      (a, b) => ids[a] - ids[b]
    );
  }
  const packed = Float64Array.from(ids, (id, i) => id * scale + i).sort();
  return Int32Array.from(packed, (p) => p % scale);
}

export function groupNames(categories: XtreamCategory[]): string[] {
  const names = new Set<string>();
  for (const category of Array.isArray(categories) ? categories : []) {
    const name = text(category.category_name);
    if (name) names.add(name);
  }
  return [...names];
}

function build(
  account: XtreamAccount,
  categories: XtreamCategory[],
  streams: XtreamStream[]
): Lineup {
  const groupByCategory = new Map<string, number>();
  const groupByName = new Map<string, number>();
  const groups: string[] = [];
  for (const category of Array.isArray(categories) ? categories : []) {
    const name = text(category.category_name);
    if (!name) continue;
    let group = groupByName.get(name);
    if (group === undefined) {
      group = groups.length;
      groups.push(name);
      groupByName.set(name, group);
    }
    groupByCategory.set(String(category.category_id), group);
  }

  const streamIds: number[] = [];
  const names: string[] = [];
  const iconDirs: string[] = [];
  const iconDirIndex = new Map<string, number>();
  const iconDir: number[] = [];
  const iconRests: string[] = [];
  const epgIds: string[] = [];
  const epgIndex = new Map<string, number>();
  const epgOf: number[] = [];
  const epgArchiveDays: number[] = [];
  const numbers: number[] = [];
  const archiveDays: number[] = [];
  const groupOf: number[] = [];
  const members: number[][] = groups.map(() => []);
  for (const stream of Array.isArray(streams) ? streams : []) {
    const name = text(stream.name);
    const id = Number(stream.stream_id);
    if (!name || !Number.isFinite(id) || SEPARATOR.test(name)) continue;
    const index = names.length;
    const num = Number(stream.num);
    const icon = text(stream.stream_icon);
    const epgId = text(stream.epg_channel_id);
    const days =
      Number(stream.tv_archive) === 1
        ? Math.min(255, Math.max(0, Number(stream.tv_archive_duration) || 0))
        : 0;
    streamIds.push(id);
    names.push(name);
    numbers.push(Number.isInteger(num) && num > 0 && num < 2 ** 32 ? num : 0);
    archiveDays.push(days);
    if (/^https?:\/\//i.test(icon)) {
      const cut = icon.lastIndexOf('/') + 1;
      const dir = icon.slice(0, cut);
      let at = iconDirIndex.get(dir);
      if (at === undefined) {
        at = iconDirs.length;
        iconDirs.push(dir);
        iconDirIndex.set(dir, at);
      }
      iconDir.push(at);
      iconRests.push(icon.slice(cut));
    } else {
      iconDir.push(-1);
      iconRests.push('');
    }
    if (epgId) {
      let at = epgIndex.get(epgId);
      if (at === undefined) {
        at = epgIds.length;
        epgIds.push(epgId);
        epgIndex.set(epgId, at);
        epgArchiveDays.push(0);
      }
      epgOf.push(at);
      if (days > epgArchiveDays[at]) epgArchiveDays[at] = days;
    } else {
      epgOf.push(-1);
    }
    const categoryIds =
      Array.isArray(stream.category_ids) && stream.category_ids.length
        ? stream.category_ids
        : [stream.category_id];
    let first = -1;
    for (const category of categoryIds) {
      const group = groupByCategory.get(String(category));
      if (group === undefined) continue;
      if (first < 0) first = group;
      if (members[group].at(-1) !== index) members[group].push(index);
    }
    groupOf.push(first);
  }

  // Groups without channels are left out, and the rest renumbered.
  const kept: number[] = [];
  const renumbered = new Int32Array(groups.length).fill(-1);
  for (let group = 0; group < groups.length; group++)
    if (members[group].length) {
      renumbered[group] = kept.length;
      kept.push(group);
    }
  const packed = (list: string[]) => {
    const at = new Uint32Array(list.length + 1);
    for (let i = 0; i < list.length; i++)
      at[i + 1] = at[i] + Buffer.byteLength(list[i]);
    return { bytes: Buffer.from(list.join('')), at };
  };
  const nameBytes = packed(names);
  const iconBytes = packed(iconRests);
  const formats = account.user_info?.allowed_output_formats;
  return {
    groups: kept.map((group) => groups[group]),
    members: kept.map((group) => Int32Array.from(members[group])),
    streamIds: Float64Array.from(streamIds),
    names: nameBytes.bytes,
    nameAt: nameBytes.at,
    iconDirs,
    iconDir: Int32Array.from(iconDir),
    icons: iconBytes.bytes,
    iconAt: iconBytes.at,
    epgOf: Int32Array.from(epgOf),
    epgIds,
    epgArchiveDays: Uint8Array.from(epgArchiveDays),
    numbers: Uint32Array.from(numbers),
    archiveDays: Uint8Array.from(archiveDays),
    groupOf: Int32Array.from(groupOf, (group) =>
      group < 0 ? -1 : renumbered[group]
    ),
    byStreamId: sortedByIds(streamIds),
    formats: Array.isArray(formats)
      ? formats.filter((f): f is string => f === 'm3u8' || f === 'ts')
      : [],
    timeZone: text(account.server_info?.timezone) || 'UTC',
  };
}

const keyOf = (client: XtreamClient) => getSimpleTextHash(client.cacheKey);

function load(client: XtreamClient, key: string): Promise<Lineup> {
  return lineups.load(
    key,
    async () => {
      const [account, categories, streams] = await Promise.all([
        client.account(),
        client.categories(),
        client.streams(),
      ]);
      const lineup = build(account, categories, streams);
      await groupLists.set(
        key,
        lineup.groups,
        appConfig.builtins.xtream.lineupTtl + STALE_SECONDS
      );
      await catchups.set(
        key,
        lineup.archiveDays.reduce((most, days) => Math.max(most, days), 0),
        appConfig.builtins.xtream.lineupTtl + STALE_SECONDS
      );
      return {
        value: lineup,
        ttl: appConfig.builtins.xtream.lineupTtl + STALE_SECONDS,
      };
    },
    appConfig.builtins.xtream.timeout + 10_000
  );
}

/** The account's channels, refreshed in the background once they're old. */
export function lineupOf(client: XtreamClient): Promise<Lineup> {
  const key = keyOf(client);
  return lineups.getOrRevalidate(
    key,
    () => load(client, key),
    () =>
      load(client, key).then(
        () => undefined,
        async (err) => {
          logger.warn(
            { err: err instanceof Error ? err.message : err },
            'xtream channel list refresh failed'
          );
          const old = await lineups.peek(key);
          if (old)
            await lineups.setLocal(key, old[0], RETRY_SECONDS + STALE_SECONDS);
        }
      ),
    STALE_SECONDS
  );
}

/**
 * The account's group names for its manifest: from its channels when they're
 * loaded, else its categories, asked for ahead of other requests.
 */
export async function groupsOf(client: XtreamClient): Promise<string[]> {
  const key = keyOf(client);
  const lineup = await lineups.peek(key);
  if (lineup) return lineup[0].groups;
  const fetch = async () => {
    const [, categories] = await Promise.all([
      client.account(true),
      client.categories(true),
    ]);
    return {
      value: groupNames(categories),
      ttl: appConfig.builtins.xtream.lineupTtl + STALE_SECONDS,
    };
  };
  return groupLists.getOrRevalidate(
    key,
    () => groupLists.load(key, fetch, appConfig.builtins.xtream.timeout),
    () =>
      groupLists
        .load(key, fetch, appConfig.builtins.xtream.timeout)
        .then(() => undefined),
    STALE_SECONDS
  );
}

/** The longest catch-up of the account's channels, 0 until they've loaded. */
export async function longestCatchupOf(client: XtreamClient): Promise<number> {
  return (await catchups.peek(keyOf(client)))?.[0] ?? 0;
}

export function indexOfStream(lineup: Lineup, streamId: number): number {
  const order = lineup.byStreamId;
  let low = 0;
  let high = order.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const id = lineup.streamIds[order[mid]];
    if (id === streamId) return order[mid];
    if (id < streamId) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}
