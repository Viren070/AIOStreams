import {
  UsenetIndexerSearchesRepository,
  type UsenetIndexerSearchDelta,
} from '../../db/index.js';

const HOUR_MS = 3_600_000;

/** Searches waiting for the next drain, keyed by hour and indexer. */
const pending = new Map<string, UsenetIndexerSearchDelta>();

/** The last queued drain; the next one starts after it. */
let lastDrain: Promise<unknown> = Promise.resolve();

function add(d: UsenetIndexerSearchDelta): void {
  const key = `${d.hourMs}:${d.indexer}`;
  const cur = pending.get(key);
  if (!cur) {
    pending.set(key, d);
    return;
  }
  cur.searches += d.searches;
  cur.results += d.results;
  cur.unique += d.unique;
}

/**
 * Buffers one search per indexer that returned results. `counts` covers only
 * results with a filename, so an indexer may be searched with none counted.
 */
export function recordIndexerSearches(
  indexers: Iterable<string>,
  counts: Map<string, { kept: number; unique: number }>
): void {
  const now = Date.now();
  const hourMs = now - (now % HOUR_MS);
  for (const indexer of new Set(indexers)) {
    const c = counts.get(indexer);
    add({
      hourMs,
      indexer,
      searches: 1,
      results: c?.kept ?? 0,
      unique: c?.unique ?? 0,
    });
  }
}

/**
 * Writes the buffered searches into the hourly rollups. Drains run one after
 * another; a failed batch goes back into the buffer.
 */
export function drainIndexerSearches(): Promise<number> {
  const run = lastDrain.then(async () => {
    if (pending.size === 0) return 0;
    const deltas = [...pending.values()];
    pending.clear();
    try {
      await UsenetIndexerSearchesRepository.addDeltas(deltas);
    } catch (err) {
      for (const d of deltas) add(d);
      throw err;
    }
    return deltas.length;
  });
  lastDrain = run.catch(() => undefined);
  return run;
}
