import { Cache } from '../../utils/cache.js';
import {
  createLogger,
  getSimpleTextHash,
  makeUrlLogSafe,
} from '../../utils/index.js';
import { config as appConfig } from '../../config/index.js';
import { TieredStore, searchWords } from '../livetv/index.js';
import { download, linesOf, textOf } from './fetch.js';
import { type Catchup, parsePlaylist } from './playlist.js';
import { type Wants, idKeys, nameKey } from './guide.js';

const logger = createLogger('m3u');

/** One of a channel's addresses. */
export interface Source {
  url: string;
  catchup?: Catchup;
  headers?: Record<string, string>;
}

export interface Channel {
  /** Stable across downloads, as stream addresses often carry changing tokens. */
  key: string;
  name: string;
  /** Its entries' distinct addresses, in playlist order. */
  sources: Source[];
  logo?: string;
  number?: string;
  /** Indexes into the lineup's groups. */
  groups?: number[];
  tvgId?: string;
  tvgName?: string;
  shift?: number;
}

interface Stored {
  channels: Channel[];
  groups: string[];
  guideUrls: string[];
}

export interface Lineup extends Stored {
  /** Each group's channels, by index. */
  members: number[][];
  byKey: Map<string, number>;
  /** What its channels want from guides; days back are its longest catch-up. */
  wants: Wants;
  bytes: number;
}

const STALE_SECONDS = 24 * 3600;
/** A failed refresh waits this long before the next, keeping the old list. */
const RETRY_SECONDS = 10 * 60;
/** How long a playlist that failed answers with its error. */
const FAILED_SECONDS = 60;
/** A playlist's groups at most, as its manifest lists them all. */
const MAX_GROUPS = 500;
/** A channel's addresses at most; the rest of its entries are left out. */
const MAX_SOURCES = 8;

/** The most days back any of a channel's addresses plays. */
export const catchupDays = (c: Channel) =>
  Math.max(0, ...c.sources.map((s) => s.catchup?.days ?? 0));

function derive(stored: Stored): Lineup {
  const members: number[][] = stored.groups.map(() => []);
  const byKey = new Map<string, number>();
  const wanted = new Set<string>();
  let daysBack = 1;
  let bytes = 0;
  stored.channels.forEach((c, i) => {
    byKey.set(c.key, i);
    for (const group of c.groups ?? []) members[group].push(i);
    for (const id of idKeys(c.tvgId ?? '')) wanted.add(`i:${id}`);
    if (c.tvgName) wanted.add(`n:${nameKey(c.tvgName)}`);
    wanted.add(`n:${nameKey(c.name)}`);
    daysBack = Math.max(daysBack, catchupDays(c));
    bytes += 200 + 2 * JSON.stringify(c).length;
  });
  bytes += 2 * JSON.stringify([stored.groups, stored.guideUrls]).length;
  const keys = [...wanted];
  return {
    ...stored,
    members,
    byKey,
    wants: {
      keys,
      id: getSimpleTextHash(`${daysBack}\n${keys.join('\n')}`),
      daysBack,
    },
    bytes,
  };
}

const lineups = new TieredStore<Lineup, Stored>('m3u-lineup', {
  memoryBytes: () => appConfig.builtins.m3u.lineupMemory,
  sizeOf: (l) => l.bytes,
  encode: ({ channels, groups, guideUrls }) => ({
    channels,
    groups,
    guideUrls,
  }),
  decode: derive,
});

const failures = Cache.getInstance<string, string>(
  'm3u-lineup-failed',
  1000,
  'memory'
);

async function fetchLineup(url: string): Promise<Lineup> {
  const { entries, guideUrls, capped } = await parsePlaylist(
    linesOf(textOf(download(url, 'playlist')))
  );
  if (!entries.length) throw new Error('The playlist has no channels');
  if (capped)
    logger.info(
      { url: makeUrlLogSafe(url), read: entries.length },
      'm3u playlist channels past the limit left out'
    );
  const limit = appConfig.builtins.m3u.guideUrls;
  if (guideUrls.length > limit)
    logger.info(
      { url: makeUrlLogSafe(url), listed: guideUrls.length, read: limit },
      'm3u playlist guides past BUILTIN_M3U_GUIDE_URLS left out'
    );
  const groups: string[] = [];
  const groupIndex = new Map<string, number>();
  const channels: Channel[] = [];
  /** Channels by key; entries with the same id and name share one. */
  const byKey = new Map<string, Channel>();
  for (const e of entries) {
    const key = getSimpleTextHash(`${e.tvgId}\n${e.name}`).slice(0, 12);
    let channel = byKey.get(key);
    if (!channel) {
      channel = {
        key,
        name: e.name,
        sources: [],
        logo: e.logo || undefined,
        number: e.number || undefined,
        tvgId: e.tvgId || undefined,
        tvgName: e.tvgName || undefined,
        shift: e.shift || undefined,
      };
      byKey.set(key, channel);
      channels.push(channel);
    }
    if (
      channel.sources.length < MAX_SOURCES &&
      !channel.sources.some((s) => s.url === e.url)
    )
      channel.sources.push({
        url: e.url,
        catchup: e.catchup,
        headers: e.headers,
      });
    for (const name of e.groups) {
      let at = groupIndex.get(name);
      if (at === undefined) {
        if (groups.length >= MAX_GROUPS) continue;
        at = groups.length;
        groups.push(name);
        groupIndex.set(name, at);
      }
      if (!channel.groups?.includes(at)) (channel.groups ??= []).push(at);
    }
  }
  return derive({ channels, groups, guideUrls });
}

function load(url: string, key: string): Promise<Lineup> {
  return lineups.load(
    key,
    async () => ({
      value: await fetchLineup(url),
      ttl: appConfig.builtins.m3u.lineupTtl + STALE_SECONDS,
    }),
    appConfig.builtins.m3u.timeout + 10_000
  );
}

/** The playlist failed us, rather than the request it was given. */
export class M3uError extends Error {}

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : err);

/** A playlist's channels, refreshed in the background once they're old. */
export async function lineupOf(url: string): Promise<Lineup> {
  const key = getSimpleTextHash(url);
  const failed = await failures.get(key);
  if (failed) throw new M3uError(failed);
  try {
    return await lineups.getOrRevalidate(
      key,
      () => load(url, key),
      () =>
        load(url, key).then(
          () => undefined,
          async (err) => {
            logger.warn(
              { url: makeUrlLogSafe(url), err: reasonOf(err) },
              'm3u playlist refresh failed'
            );
            const old = await lineups.peek(key);
            if (old)
              await lineups.setLocal(
                key,
                old[0],
                RETRY_SECONDS + STALE_SECONDS
              );
          }
        ),
      STALE_SECONDS
    );
  } catch (err) {
    logger.warn(
      { url: makeUrlLogSafe(url), err: reasonOf(err) },
      'm3u playlist failed'
    );
    const message = `M3U playlist failed: ${reasonOf(err)}`;
    // Held briefly, so a broken playlist isn't downloaded on every request.
    await failures.set(key, message, FAILED_SECONDS);
    throw new M3uError(message);
  }
}

/** The playlist's channel number, else its place in the list. */
export const numberOf = (lineup: Lineup, i: number) =>
  lineup.channels[i].number ?? String(i + 1);

/** Channels named with every word of the term, led by the one numbered it. */
export function searchLineup(
  lineup: Lineup,
  term: string,
  limit: number
): number[] {
  const words = searchWords(term);
  if (!words.length) return [];
  const found: number[] = [];
  const number = term.trim();
  const numbered = lineup.channels.findIndex(
    (_, i) => numberOf(lineup, i) === number
  );
  if (numbered >= 0) found.push(numbered);
  for (let i = 0; i < lineup.channels.length && found.length < limit; i++) {
    if (i === numbered) continue;
    const name = lineup.channels[i].name.toLowerCase();
    if (words.every((w) => name.includes(w))) found.push(i);
  }
  return found;
}
