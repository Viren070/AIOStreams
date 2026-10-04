import {
  WatchStateRepository,
  type WatchStateRow,
} from '../db/repositories/watch-state.js';
import { WatchAirTimeRepository } from '../db/repositories/watch-air-times.js';
import { matchKeysFor } from './canonical.js';
import { seriesKeyOfMatch, type ContentRef, type WatchScope } from './types.js';

/** When several spellings of one item hold a row, the latest speaks for it. */
function latest(rows: WatchStateRow[]): WatchStateRow | undefined {
  let best: WatchStateRow | undefined;
  for (const row of rows) {
    if (!best || row.sortAt > best.sortAt) best = row;
  }
  return best;
}

/** The latest row, holding the favourite when any spelling does: it is the title's. */
function standing(rows: WatchStateRow[]): WatchStateRow | undefined {
  const row = latest(rows);
  if (!row || row.favorite) return row;
  const favourite = rows.find((r) => r.favorite);
  return favourite
    ? { ...row, favorite: true, favoriteAt: favourite.favoriteAt }
    : row;
}

export function bySpelling<
  T extends { itemKey: string; matchKey?: string | null },
>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  const add = (key: string, row: T) => {
    const list = out.get(key);
    if (list) list.push(row);
    else out.set(key, [row]);
  };
  for (const row of rows) {
    add(row.itemKey, row);
    if (row.matchKey && row.matchKey !== row.itemKey) add(row.matchKey, row);
  }
  return out;
}

type Matches = Map<string, string | null>;

function keysOf(matches: Matches): string[] {
  const keys = new Set<string>();
  for (const [own, match] of matches) {
    keys.add(own);
    if (match) keys.add(match);
  }
  return [...keys];
}

function spellingsOf<T>(
  matches: Matches,
  spellings: Map<string, T[]>
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const [own, match] of matches) {
    const found = [
      ...(spellings.get(own) ?? []),
      ...(match && match !== own ? (spellings.get(match) ?? []) : []),
    ];
    if (found.length) out.set(own, found);
  }
  return out;
}

async function rowsFor(
  scope: WatchScope,
  matches: Matches
): Promise<Map<string, WatchStateRow>> {
  const found = spellingsOf(
    matches,
    bySpelling(await WatchStateRepository.getSpellings(scope, keysOf(matches)))
  );
  const out = new Map<string, WatchStateRow>();
  for (const [own, rows] of found) {
    const row = standing(rows);
    if (row) out.set(own, row);
  }
  return out;
}

async function airTimesOf(
  scope: WatchScope,
  matches: Matches
): Promise<Map<string, number>> {
  const found = spellingsOf(
    matches,
    bySpelling(await WatchAirTimeRepository.among(scope, keysOf(matches)))
  );
  const out = new Map<string, number>();
  for (const [own, times] of found) {
    out.set(own, Math.max(...times.map((t) => t.airsAt)));
  }
  return out;
}

/** Each reference's row under any spelling, keyed by the reference's own key. */
export async function watchRowsFor(
  scope: WatchScope,
  refs: ContentRef[]
): Promise<Map<string, WatchStateRow>> {
  return rowsFor(scope, await matchKeysFor(refs));
}

/** {@link watchRowsFor}, with the air time a tracker gives each reference. */
export async function watchRowsAndAirTimesFor(
  scope: WatchScope,
  refs: ContentRef[]
): Promise<{
  rows: Map<string, WatchStateRow>;
  airTimes: Map<string, number>;
}> {
  const matches = await matchKeysFor(refs);
  const [rows, airTimes] = await Promise.all([
    rowsFor(scope, matches),
    airTimesOf(scope, matches),
  ]);
  return { rows, airTimes };
}

/** The series keys of shows a tracker times an episode of between `from` and `to`. */
export async function showsAiringBetween(
  scope: WatchScope,
  from: number,
  to: number
): Promise<Set<string>> {
  const out = new Set<string>();
  for (const time of await WatchAirTimeRepository.between(scope, from, to)) {
    out.add(time.seriesKey);
    const show = time.matchKey
      ? seriesKeyOfMatch(time.matchKey, time.mediaType)
      : null;
    if (show) out.add(show);
  }
  return out;
}

/** Drops rows that another spelling of the same item has since overtaken. */
export async function latestSpellings(
  scope: WatchScope,
  rows: WatchStateRow[]
): Promise<WatchStateRow[]> {
  const groupOf = (row: WatchStateRow) => row.matchKey ?? row.itemKey;
  if (!rows.length) return rows;
  const spellings = bySpelling(
    await WatchStateRepository.getSpellings(scope, rows.map(groupOf))
  );
  return rows.filter((row) => {
    const winner = latest(spellings.get(groupOf(row)) ?? []);
    return !winner || winner.itemKey === row.itemKey;
  });
}
