import {
  UsenetIndexerSearchesRepository,
  type UsenetIndexerSearchDelta,
} from '../../db/index.js';

const HOUR_MS = 3_600_000;

/** Searches waiting for the next drain, keyed by hour and indexer. */
const pending = new Map<string, UsenetIndexerSearchDelta>();

/** Buffers one search for each indexer that returned results. */
export function recordIndexerSearches(
  byIndexer: Map<string, { kept: number; unique: number }>
): void {
  const now = Date.now();
  const hourMs = now - (now % HOUR_MS);
  for (const [indexer, c] of byIndexer) {
    const key = `${hourMs}:${indexer}`;
    const d = pending.get(key) ?? {
      hourMs,
      indexer,
      searches: 0,
      results: 0,
      unique: 0,
    };
    d.searches++;
    d.results += c.kept;
    d.unique += c.unique;
    pending.set(key, d);
  }
}

/** Writes the buffered searches into the hourly rollups. */
export async function drainIndexerSearches(): Promise<number> {
  if (pending.size === 0) return 0;
  const deltas = [...pending.values()];
  pending.clear();
  await UsenetIndexerSearchesRepository.addDeltas(deltas);
  return deltas.length;
}
