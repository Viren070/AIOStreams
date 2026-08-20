/**
 * Persistence for the merged canonical anime store.
 *
 * This layer only moves rows. Which record wins a lookup, and how a record
 * becomes an `AnimeEntry`, stay in `anime-database/` as pure functions over
 * {@link AnimeRecord}.
 */
import { getDb } from '../db.js';
import { sql, join } from '../sql.js';
import type { DbDriver } from '../driver/types.js';
import type { IdType } from '../../utils/id-parser.js';
import {
  canonicalIdValue,
  type AnimeRecord,
  type AnimeSeason,
  type AnimeType,
  type IdValue,
} from '../../anime-database/types.js';

/** Postgres caps a statement at 65,535 parameters, so wider rows chunk smaller. */
const RECORD_CHUNK_ROWS = 400; // 11 columns
const ID_CHUNK_ROWS = 2000; // 3 columns
const SYNONYM_CHUNK_ROWS = 2000; // 3 columns

type RecordRow = {
  rid: number | string;
  type: string;
  ids: string;
  title: string | null;
  season: string | null;
  year: number | string | null;
  imdb: string | null;
  tvdb: string | null;
  tmdb: string | null;
  trakt: string | null;
  fanart: string | null;
};

export interface AnimeBuildInfo {
  fingerprint: string;
  records: number;
  builtAt: number;
  /** Source ids the stored build was made from. */
  sources: string[];
}

/** A merged store, ready to replace whatever is stored. */
export interface AnimeBuild {
  records: readonly AnimeRecord[];
  /** Identity of the source revisions this was built from. */
  fingerprint: string;
  /** Source ids that went into it. */
  sources: readonly string[];
  /** Every source id it could have used. */
  allSources: readonly string[];
  /** Publish regardless of what is stored. */
  force?: boolean;
}

export type PublishOutcome =
  /** Written; this is now the stored store. */
  | 'published'
  /** Identical to what is stored. */
  | 'unchanged'
  /** The stored store was built from sources this one is missing. */
  | 'superseded';

function num(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** JSON for a hint block, or null when the record has none. */
const blob = (v: unknown): string | null =>
  v === undefined || v === null ? null : JSON.stringify(v);

const parseBlob = <T>(v: string | null): T | undefined =>
  v === null ? undefined : (JSON.parse(v) as T);

/** Optional fields stay absent, not undefined, to keep the merger's shape. */
function rowToRecord(
  row: RecordRow,
  synonyms: string[] | undefined
): AnimeRecord {
  const record: AnimeRecord = {
    rid: num(row.rid),
    type: row.type as AnimeType,
    ids: JSON.parse(row.ids) as AnimeRecord['ids'],
  };
  if (row.title !== null) record.title = row.title;
  if (synonyms !== undefined) record.synonyms = synonyms;
  if (row.season !== null) {
    record.animeSeason = {
      season: row.season as AnimeSeason,
      year: row.year === null ? null : num(row.year),
    };
  }
  const imdb = parseBlob<AnimeRecord['imdb']>(row.imdb);
  const tvdb = parseBlob<AnimeRecord['tvdb']>(row.tvdb);
  const tmdb = parseBlob<AnimeRecord['tmdb']>(row.tmdb);
  const trakt = parseBlob<AnimeRecord['trakt']>(row.trakt);
  const fanart = parseBlob<AnimeRecord['fanart']>(row.fanart);
  if (imdb !== undefined) record.imdb = imdb;
  if (tvdb !== undefined) record.tvdb = tvdb;
  if (tmdb !== undefined) record.tmdb = tmdb;
  if (trakt !== undefined) record.trakt = trakt;
  if (fanart !== undefined) record.fanart = fanart;
  return record;
}

function explode(records: readonly AnimeRecord[]) {
  const ids: Array<{ t: string; v: string; rid: number }> = [];
  const synonyms: Array<{ rid: number; ord: number; s: string }> = [];
  for (const r of records) {
    for (const [idType, idValue] of Object.entries(r.ids)) {
      if (idValue === undefined || idValue === null || idValue === '') continue;
      ids.push({
        t: idType,
        v: String(canonicalIdValue(idValue as IdValue)),
        rid: r.rid,
      });
    }
    if (r.synonyms) {
      r.synonyms.forEach((s, ord) => synonyms.push({ rid: r.rid, ord, s }));
    }
  }
  return { ids, synonyms };
}

/**
 * Which of `stored` and `build` the store should end up holding.
 *
 * A build made from every registered source outranks one that is missing any,
 * so a replica whose download failed cannot overwrite a complete store with a
 * smaller one. Completeness is measured against `allSources` on both sides, so
 * retiring a source does not freeze the store at the last build that had it.
 */
function decide(
  stored: AnimeBuildInfo | null,
  build: AnimeBuild
): PublishOutcome {
  if (build.force || !stored || stored.records === 0) return 'published';
  const complete = (ids: readonly string[]) =>
    build.allSources.every((id) => ids.includes(id));
  if (complete(stored.sources) && !complete(build.sources)) return 'superseded';
  if (stored.fingerprint === build.fingerprint) return 'unchanged';
  return 'published';
}

/** The stored build, as seen through `db` (which may be a transaction). */
async function readBuildWith(db: DbDriver): Promise<AnimeBuildInfo | null> {
  const row = await db.maybeOne<{
    fingerprint: string;
    records: number | string;
    built_at: number | string;
    sources: string;
  }>(
    sql`SELECT fingerprint, records, built_at, sources
          FROM anime_build WHERE id = 1`
  );
  if (!row) return null;
  return {
    fingerprint: row.fingerprint,
    records: num(row.records),
    builtAt: num(row.built_at),
    sources: JSON.parse(row.sources) as string[],
  };
}

export class AnimeRepository {
  /**
   * Every record carrying `idValue` under `idType`, ascending by `rid`.
   * The order matters: `selectBestRecord` falls back to `candidates[0]`.
   */
  static async findCandidates(
    idType: IdType,
    idValue: IdValue
  ): Promise<AnimeRecord[]> {
    const db = getDb();
    const key = String(canonicalIdValue(idValue));
    const rids = await db.query<{ rid: number | string }>(
      sql`SELECT rid FROM anime_ids
          WHERE id_type = ${idType} AND id_value = ${key}`
    );
    if (rids.length === 0) return [];

    const ridList = join(rids.map((r) => sql`${num(r.rid)}`));
    const [rows, synonymRows] = await Promise.all([
      db.query<RecordRow>(
        sql`SELECT * FROM anime_records WHERE rid IN (${ridList}) ORDER BY rid`
      ),
      db.query<{ rid: number | string; synonym: string }>(
        sql`SELECT rid, synonym FROM anime_synonyms
            WHERE rid IN (${ridList}) ORDER BY rid, ord`
      ),
    ]);

    const synonyms = new Map<number, string[]>();
    for (const s of synonymRows) {
      const rid = num(s.rid);
      const existing = synonyms.get(rid);
      if (existing) existing.push(s.synonym);
      else synonyms.set(rid, [s.synonym]);
    }
    return rows.map((row) => rowToRecord(row, synonyms.get(num(row.rid))));
  }

  /** What the stored store was built from, or null if it never has been. */
  static async readBuild(): Promise<AnimeBuildInfo | null> {
    return readBuildWith(getDb());
  }

  /**
   * Replace the stored store with `build`, in one transaction so readers keep
   * the previous one until it commits.
   *
   * Concurrent rebuilds need no outside lock: {@link decide} runs against the
   * row this transaction is about to overwrite, so a redundant build is
   * discarded rather than written twice.
   */
  static async publish(build: AnimeBuild): Promise<PublishOutcome> {
    const { ids, synonyms } = explode(build.records);
    return getDb().tx(async (tx) => {
      if (tx.dialect === 'postgres') {
        await tx.exec(
          sql`LOCK TABLE anime_records, anime_ids, anime_synonyms, anime_build
              IN EXCLUSIVE MODE`
        );
      }
      const outcome = decide(await readBuildWith(tx), build);
      if (outcome !== 'published') return outcome;

      await tx.exec(sql`DELETE FROM anime_synonyms`);
      await tx.exec(sql`DELETE FROM anime_ids`);
      await tx.exec(sql`DELETE FROM anime_records`);

      for (let i = 0; i < build.records.length; i += RECORD_CHUNK_ROWS) {
        const chunk = build.records.slice(i, i + RECORD_CHUNK_ROWS);
        await tx.exec(
          sql`INSERT INTO anime_records
                (rid, type, ids, title, season, year,
                 imdb, tvdb, tmdb, trakt, fanart)
              VALUES ${join(
                chunk.map(
                  (r) =>
                    sql`(${r.rid}, ${r.type}, ${JSON.stringify(r.ids)},
                         ${r.title ?? null}, ${r.animeSeason?.season ?? null},
                         ${r.animeSeason?.year ?? null},
                         ${blob(r.imdb)}, ${blob(r.tvdb)}, ${blob(r.tmdb)},
                         ${blob(r.trakt)}, ${blob(r.fanart)})`
                )
              )}`
        );
      }

      for (let i = 0; i < ids.length; i += ID_CHUNK_ROWS) {
        const chunk = ids.slice(i, i + ID_CHUNK_ROWS);
        await tx.exec(
          sql`INSERT INTO anime_ids (id_type, id_value, rid)
              VALUES ${join(chunk.map((x) => sql`(${x.t}, ${x.v}, ${x.rid})`))}`
        );
      }

      for (let i = 0; i < synonyms.length; i += SYNONYM_CHUNK_ROWS) {
        const chunk = synonyms.slice(i, i + SYNONYM_CHUNK_ROWS);
        await tx.exec(
          sql`INSERT INTO anime_synonyms (rid, ord, synonym)
              VALUES ${join(
                chunk.map((x) => sql`(${x.rid}, ${x.ord}, ${x.s})`)
              )}`
        );
      }

      await tx.exec(sql`DELETE FROM anime_build`);
      await tx.exec(
        sql`INSERT INTO anime_build (id, fingerprint, built_at, records, sources)
            VALUES (1, ${build.fingerprint}, ${Date.now()},
                    ${build.records.length}, ${JSON.stringify(build.sources)})`
      );
      return 'published';
    });
  }
}
