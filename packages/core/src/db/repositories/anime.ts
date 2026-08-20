/**
 * Persistence for the merged canonical anime store.
 *
 * This layer only moves rows. Which record wins a lookup, and how a record
 * becomes an `AnimeEntry`, stay in `anime-database/` as pure functions over
 * {@link AnimeRecord}.
 */
import { getDb } from '../db.js';
import { sql, join } from '../sql.js';
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
}

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
    const row = await getDb().maybeOne<{
      fingerprint: string;
      records: number | string;
      built_at: number | string;
    }>(
      sql`SELECT fingerprint, records, built_at FROM anime_build WHERE id = 1`
    );
    if (!row) return null;
    return {
      fingerprint: row.fingerprint,
      records: num(row.records),
      builtAt: num(row.built_at),
    };
  }

  /** One transaction, so readers keep the previous store until it commits. */
  static async replaceAll(
    records: readonly AnimeRecord[],
    fingerprint: string
  ): Promise<void> {
    const { ids, synonyms } = explode(records);
    await getDb().tx(async (tx) => {
      await tx.exec(sql`DELETE FROM anime_synonyms`);
      await tx.exec(sql`DELETE FROM anime_ids`);
      await tx.exec(sql`DELETE FROM anime_records`);

      for (let i = 0; i < records.length; i += RECORD_CHUNK_ROWS) {
        const chunk = records.slice(i, i + RECORD_CHUNK_ROWS);
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
        sql`INSERT INTO anime_build (id, fingerprint, built_at, records)
            VALUES (1, ${fingerprint}, ${Date.now()}, ${records.length})`
      );
    });
  }
}
