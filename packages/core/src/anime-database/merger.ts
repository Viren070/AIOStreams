/**
 * Source-agnostic merger: takes per-source {@link SourceEntry} streams and
 * unifies them into a flat array of canonical {@link AnimeRecord}s, deduped via
 * union-find on shared anime-identifying ids ({@link ANIME_IDENTIFYING_ID_TYPES}).
 *
 * Show-level ids (imdb / tmdb / tvdb / trakt) are not used as union keys: one
 * IMDb / TVDB show can host multiple cours of an anime, which become multiple
 * canonical records.
 */
import { DSU } from '../utils/dsu.js';
import type { IdType } from '../utils/id-parser.js';
import {
  AnimeType,
  ANIME_IDENTIFYING_ID_TYPES,
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
 * Merge per-source entries into canonical records.
 *
 * Algorithm:
 *   1. Pre-collect every emitted entry into a flat list with a temp index.
 *   2. Build a DSU over (idType, idValue) keys, but only for
 *      anime-identifying id types. Each entry contributes edges from its
 *      first identifying key to all the others.
 *   3. Find the canonical root for each entry; group entries by root; merge
 *      each group into one {@link AnimeRecord}.
 */
export function mergeSources(batches: SourceBatch[]): AnimeRecord[] {
  type Tagged = { entry: SourceEntry; sourceId: string; idx: number };
  const tagged: Tagged[] = [];
  for (const batch of batches) {
    for (const entry of batch.entries) {
      tagged.push({ entry, sourceId: batch.sourceId, idx: tagged.length });
    }
  }

  // DSU over entry indices, joined whenever two entries share *any*
  // anime-identifying id.
  const dsu = new DSU<number>();
  // Map identifying id → first entry index that claimed it.
  const idClaim = new Map<string, number>();
  for (const { entry, idx } of tagged) {
    dsu.makeSet(idx);
    for (const idType of ANIME_IDENTIFYING_ID_TYPES) {
      const v = entry.ids[idType];
      if (v === undefined || v === null || v === '') continue;
      const key = `${idType}:${v}`;
      const claimed = idClaim.get(key);
      if (claimed === undefined) {
        idClaim.set(key, idx);
      } else {
        dsu.union(idx, claimed);
      }
    }
  }

  // Group entries by their DSU root.
  const groups = new Map<number, Tagged[]>();
  for (const t of tagged) {
    const root = dsu.find(t.idx);
    const existing = groups.get(root);
    if (existing) existing.push(t);
    else groups.set(root, [t]);
  }

  const records: AnimeRecord[] = [];
  let rid = 0;
  for (const group of groups.values()) {
    records.push(buildRecord(rid++, group));
  }
  return records;
}

function buildRecord(
  rid: number,
  group: Array<{ entry: SourceEntry; sourceId: string }>
): AnimeRecord {
  const ids: Partial<Record<IdType, IdValue>> = {};
  const synonymsSet = new Set<string>();
  let type: AnimeType = AnimeType.UNKNOWN;
  let title: string | undefined;
  let animeSeason: AnimeRecord['animeSeason'];
  const imdb: NonNullable<AnimeRecord['imdb']> = {};
  const tvdb: NonNullable<AnimeRecord['tvdb']> = {};
  const tmdb: NonNullable<AnimeRecord['tmdb']> = {};
  const trakt: NonNullable<AnimeRecord['trakt']> = {};
  const fanart: NonNullable<AnimeRecord['fanart']> = {};

  let imdbDirty = false;
  let tvdbDirty = false;
  let tmdbDirty = false;
  let traktDirty = false;
  let fanartDirty = false;

  for (const { entry } of group) {
    // Promote the most-specific known type; later sources override earlier.
    if (entry.type && entry.type !== AnimeType.UNKNOWN) type = entry.type;

    for (const [k, v] of Object.entries(entry.ids) as Array<
      [IdType, IdValue | undefined]
    >) {
      if (v === undefined || v === null || v === ('' as unknown)) continue;
      // Last-writer-wins per field; sources later in the registry win.
      ids[k] = v;
    }

    if (entry.title && !title) title = entry.title;
    if (entry.synonyms) for (const s of entry.synonyms) synonymsSet.add(s);
    if (entry.animeSeason && !animeSeason) animeSeason = entry.animeSeason;

    if (entry.imdb) {
      mergeShallow(imdb, entry.imdb);
      imdbDirty = true;
    }
    if (entry.tvdb) {
      mergeShallow(tvdb, entry.tvdb);
      tvdbDirty = true;
    }
    if (entry.tmdb) {
      mergeShallow(tmdb, entry.tmdb);
      tmdbDirty = true;
    }
    if (entry.trakt) {
      mergeShallow(trakt, entry.trakt);
      traktDirty = true;
    }
    if (entry.fanart) {
      mergeShallow(fanart, entry.fanart);
      fanartDirty = true;
    }
  }

  const record: AnimeRecord = {
    rid,
    type,
    ids,
    title,
    synonyms: synonymsSet.size > 0 ? Array.from(synonymsSet) : undefined,
    animeSeason,
  };
  if (imdbDirty) record.imdb = imdb;
  if (tvdbDirty) record.tvdb = tvdb;
  if (tmdbDirty) record.tmdb = tmdb;
  if (traktDirty) record.trakt = trakt;
  if (fanartDirty) record.fanart = fanart;
  return record;
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
