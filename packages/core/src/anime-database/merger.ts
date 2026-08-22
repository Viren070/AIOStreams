/**
 * Source-agnostic merger: takes per-source {@link SourceEntry} streams and
 * unifies them into a flat array of canonical {@link AnimeRecord}s, deduped via
 * union-find on shared anime-identifying ids ({@link ANIME_IDENTIFYING_ID_TYPES}).
 *
 * Show-level ids (imdb / tmdb / tvdb / trakt) are not used as union keys: one
 * IMDb / TVDB show can host multiple cours of an anime, which become multiple
 * canonical records.

 */
import type { IdType } from '../utils/id-parser.js';
import {
  AnimeType,
  ANIME_IDENTIFYING_ID_TYPES,
  canonicalIdValue,
  type AnimeRecord,
  type IdValue,
  type SourceEntry,
} from './types.js';

/** Input to {@link mergeSources}: every source's parsed records + its id. */
export interface SourceBatch {
  sourceId: string;
  entries: SourceEntry[];
}

/**
 * Union-find over a dense `0..size-1` index range.
 */
class DenseDSU {
  private readonly parent: Int32Array;
  private readonly rank: Uint8Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    for (let i = 0; i < size; i++) this.parent[i] = i;
    this.rank = new Uint8Array(size);
  }

  find(i: number): number {
    const parent = this.parent;
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const { parent, rank } = this;
    if (rank[ra] < rank[rb]) parent[ra] = rb;
    else if (rank[ra] > rank[rb]) parent[rb] = ra;
    else {
      parent[rb] = ra;
      rank[ra]++;
    }
  }
}

/**
 * Merge per-source entries into canonical records.
 *
 * Algorithm:
 *   1. Flatten every emitted entry into one dense list.
 *   2. Union entries that share any anime-identifying id.
 *   3. Number the union roots in first-seen order, then fold each entry into
 *      its record in list order, so per-field precedence stays "later source
 *      wins" exactly as the registry order implies.
 */
export function mergeSources(batches: SourceBatch[]): AnimeRecord[] {
  let total = 0;
  for (const batch of batches) total += batch.entries.length;
  const entries: Array<SourceEntry | undefined> = new Array(total);
  let n = 0;
  for (const batch of batches) {
    for (const entry of batch.entries) entries[n++] = entry;
    batch.entries.length = 0;
  }

  const dsu = new DenseDSU(total);
  // One claim map per id type, keyed by the canonical id value.
  const claims = new Map<IdType, Map<IdValue, number>>();
  for (const idType of ANIME_IDENTIFYING_ID_TYPES)
    claims.set(idType, new Map());
  for (let idx = 0; idx < total; idx++) {
    const ids = entries[idx]!.ids;
    for (const idType of ANIME_IDENTIFYING_ID_TYPES) {
      const v = ids[idType];
      if (v === undefined || v === null || v === '') continue;
      const claim = claims.get(idType)!;
      const key = canonicalIdValue(v);
      const claimed = claim.get(key);
      if (claimed === undefined) claim.set(key, idx);
      else dsu.union(idx, claimed);
    }
  }
  claims.clear();

  // Number the roots in the order their first entry appears, so record ids
  // (and therefore `rid`) follow the same order as the input list.
  const recordOf = new Int32Array(total);
  const rootToRecord = new Int32Array(total).fill(-1);
  let recordCount = 0;
  for (let idx = 0; idx < total; idx++) {
    const root = dsu.find(idx);
    let rid = rootToRecord[root];
    if (rid === -1) {
      rid = recordCount++;
      rootToRecord[root] = rid;
    }
    recordOf[idx] = rid;
  }

  const records: AnimeRecord[] = new Array(recordCount);
  for (let idx = 0; idx < total; idx++) {
    const entry = entries[idx]!;
    entries[idx] = undefined;
    const rid = recordOf[idx];
    let record = records[rid];
    if (record === undefined) {
      record = { rid, type: AnimeType.UNKNOWN, ids: {} };
      records[rid] = record;
    }
    foldEntry(record, entry);
  }

  for (const record of records) {
    if (record.synonyms) record.synonyms = record.synonyms.slice();
  }
  return records;
}

/** Fold one source entry into the record it belongs to. */
function foldEntry(record: AnimeRecord, entry: SourceEntry): void {
  // Promote the most-specific known type; later sources override earlier.
  if (entry.type && entry.type !== AnimeType.UNKNOWN) record.type = entry.type;

  for (const [k, v] of Object.entries(entry.ids) as Array<
    [IdType, IdValue | undefined]
  >) {
    if (v === undefined || v === null || v === ('' as unknown)) continue;
    // Last-writer-wins per field; sources later in the registry win.
    record.ids[k] = v;
  }

  if (entry.title && !record.title) record.title = entry.title;
  if (entry.synonyms && entry.synonyms.length > 0) {
    const existing = (record.synonyms ??= []);
    for (const s of entry.synonyms) {
      if (!existing.includes(s)) existing.push(s);
    }
  }
  if (entry.animeSeason && !record.animeSeason) {
    record.animeSeason = entry.animeSeason;
  }

  if (entry.imdb) mergeShallow((record.imdb ??= {}), entry.imdb);
  if (entry.tvdb) mergeShallow((record.tvdb ??= {}), entry.tvdb);
  if (entry.tmdb) mergeShallow((record.tmdb ??= {}), entry.tmdb);
  if (entry.trakt) mergeShallow((record.trakt ??= {}), entry.trakt);
  if (entry.fanart) mergeShallow((record.fanart ??= {}), entry.fanart);
}

/**
 * Shallow-merge `src` into `target`: defined values overwrite, `undefined`/
 * `null` leave the existing value in place.
 */
function mergeShallow<T extends object>(target: T, src: Partial<T>): void {
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined || v === null) continue;
    (target as Record<string, unknown>)[k] = v;
  }
}
