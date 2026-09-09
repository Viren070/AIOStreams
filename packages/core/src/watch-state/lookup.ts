import {
  WatchStateRepository,
  type WatchStateRow,
} from '../db/repositories/watch-state.js';
import { matchKeysFor } from './canonical.js';
import type { ContentRef, WatchScope } from './types.js';

/** When several spellings of one item hold a row, the latest speaks for it. */
function latest(rows: WatchStateRow[]): WatchStateRow | undefined {
  let best: WatchStateRow | undefined;
  for (const row of rows) {
    if (!best || row.sortAt > best.sortAt) best = row;
  }
  return best;
}

function bySpelling(rows: WatchStateRow[]): Map<string, WatchStateRow[]> {
  const out = new Map<string, WatchStateRow[]>();
  const add = (key: string, row: WatchStateRow) => {
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

/** Each reference's row under any spelling, keyed by the reference's own key. */
export async function watchRowsFor(
  scope: WatchScope,
  refs: ContentRef[]
): Promise<Map<string, WatchStateRow>> {
  const matches = await matchKeysFor(refs);
  const keys = new Set<string>();
  for (const [own, match] of matches) {
    keys.add(own);
    if (match) keys.add(match);
  }
  const spellings = bySpelling(
    await WatchStateRepository.getSpellings(scope, [...keys])
  );
  const out = new Map<string, WatchStateRow>();
  for (const [own, match] of matches) {
    const row = latest([
      ...(spellings.get(own) ?? []),
      ...(match && match !== own ? (spellings.get(match) ?? []) : []),
    ]);
    if (row) out.set(own, row);
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
