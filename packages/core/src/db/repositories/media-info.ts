import { getDb } from '../db.js';
import { join, raw, sql, type SqlFragment } from '../sql.js';
import {
  asPacked,
  asPackedBase64,
  packInfo,
  unpackInfo,
} from './media-info-codec.js';
import {
  MEDIA_INFO_VERSION,
  type MediaInfoRecord,
} from '../../media-info/record.js';

export const LOCAL_ORIGIN = 'local';

export type MediaInfoOrigin = 'local' | 'stremthru' | 'realdebrid';

/** `info` is set only on rows from another instance. */
export type StoredFile = Omit<MediaInfoRow, 'info'> & {
  info?: MediaInfoRecord;
};

export type PackedRow = Omit<MediaInfoRow, 'info'> & { packed: string };

export interface MediaInfoRow {
  releaseKey: string;
  file: string;
  origin: string;
  /** Feature files in the release when it was probed; 1 means not a pack, 0 unknown. */
  releaseFiles: number;
  size: number | null;
  info: MediaInfoRecord;
  version: number;
  title?: string | null;
}

interface DbRow {
  release_key: string;
  file: string;
  origin: string;
  release_files: number | string;
  size: number | string | null;
  info: string | Uint8Array;
  version: number | string;
  title: string | null;
  [k: string]: unknown;
}

const CHUNK = 200;

// Postgres parses and plans one array parameter faster than a list of them.
function keyIn(keys: string[]): SqlFragment {
  return getDb().dialect === 'postgres'
    ? sql`release_key = ANY(${keys}::text[])`
    : sql`release_key IN (${join(keys.map((k) => sql`${k}`))})`;
}
export const LIST_COUNT_CAP = 10_000;
const EMPTY: MediaInfoRecord = { chapters: false, tracks: [] };

// Rows are validated on write and a lookup reads few of them, so `info` is
// parsed on first use.
function toRow(r: DbRow): MediaInfoRow {
  let info: MediaInfoRecord | undefined;
  const text = r.info;
  return {
    releaseKey: r.release_key,
    file: r.file,
    origin: r.origin,
    releaseFiles: Number(r.release_files),
    size: r.size === null ? null : Number(r.size),
    get info() {
      if (info === undefined) {
        try {
          info = JSON.parse(unpackInfo(text)) as MediaInfoRecord;
        } catch {
          info = EMPTY;
        }
      }
      return info;
    },
    version: Number(r.version),
    title: r.title,
  };
}

function keyRank(key: string): number {
  if (key.startsWith('nh1:') || key.startsWith('btih:')) return 0;
  return key.startsWith('nu1:') ? 1 : 2;
}

// One probe writes a row per key it knows; listings show its best key only.
const SHOWN = sql`m.listed = 1`;

export type MediaInfoKind = 'usenet' | 'torrent';

export interface MediaInfoFileFilter {
  search?: string;
  /** A library entry's content hash. */
  nzbHash?: string;
  infoHash?: string;
  kind?: MediaInfoKind;
  origin?: string;
}

/** The keys a search for a key or a bare hash means, if it is one. */
function keysOf(search: string): string[] | undefined {
  if (/^(btih|nh1|wd1|nu1):[0-9a-f]{32,64}$/.test(search)) return [search];
  if (/^[0-9a-f]{40}$/.test(search)) return [`btih:${search}`, `nh1:${search}`];
  if (/^[0-9a-f]{64}$/.test(search)) return [`btih:${search}`];
  if (/^[0-9a-f]{32}$/.test(search)) return [`wd1:${search}`, `nu1:${search}`];
  return undefined;
}

export class MediaInfoRepository {
  static async getByKeys(releaseKeys: string[]): Promise<MediaInfoRow[]> {
    return (await this.rowsByKeys(releaseKeys)).map(toRow);
  }

  /** Records left packed, in base64, as another instance reads them. */
  static async getPackedByKeys(releaseKeys: string[]): Promise<PackedRow[]> {
    const pg = getDb().dialect === 'postgres';
    // Postgres sends bytea as hex text, twice the bytes, to be decoded here.
    const info = raw(pg ? `encode(info, 'base64')` : 'info');
    return (await this.rowsByKeys(releaseKeys, info)).map((r) => ({
      releaseKey: r.release_key,
      file: r.file,
      origin: r.origin,
      releaseFiles: Number(r.release_files),
      size: r.size === null ? null : Number(r.size),
      packed: pg
        ? asPackedBase64(r.info as string)
        : asPacked(r.info).toString('base64'),
      version: Number(r.version),
      title: r.title,
    }));
  }

  private static async rowsByKeys(
    releaseKeys: string[],
    info = raw('info')
  ): Promise<DbRow[]> {
    const wanted = [...new Set(releaseKeys.filter(Boolean))];
    const out: DbRow[] = [];
    for (let i = 0; i < wanted.length; i += CHUNK) {
      out.push(
        ...(await getDb().query<DbRow>(
          sql`SELECT release_key, file, origin, release_files, size,
                     ${info} AS info, version, title
                FROM media_info WHERE ${keyIn(wanted.slice(i, i + CHUNK))}`
        ))
      );
    }
    return out;
  }

  /** The stored files under these keys, without their records. */
  static async getFilesByKeys(releaseKeys: string[]): Promise<StoredFile[]> {
    const wanted = [...new Set(releaseKeys.filter(Boolean))];
    const out: StoredFile[] = [];
    for (let i = 0; i < wanted.length; i += CHUNK) {
      const rows = await getDb().query<DbRow>(
        sql`SELECT release_key, file, origin, release_files, size, version,
                   title
              FROM media_info WHERE ${keyIn(wanted.slice(i, i + CHUNK))}`
      );
      for (const r of rows) {
        out.push({
          releaseKey: r.release_key,
          file: r.file,
          origin: r.origin,
          releaseFiles: Number(r.release_files),
          size: r.size === null ? null : Number(r.size),
          version: Number(r.version),
          title: r.title,
        });
      }
    }
    return out;
  }

  /** Records of these files, by `key \0 file \0 origin`. */
  static async getInfos(
    files: Pick<StoredFile, 'releaseKey' | 'file' | 'origin'>[]
  ): Promise<Map<string, MediaInfoRecord>> {
    const out = new Map<string, MediaInfoRecord>();
    for (let i = 0; i < files.length; i += CHUNK) {
      const tuples = join(
        files
          .slice(i, i + CHUNK)
          .map((f) => sql`(${f.releaseKey}, ${f.file}, ${f.origin})`)
      );
      const rows = await getDb().query<DbRow>(
        sql`SELECT release_key, file, origin, release_files, size, info,
                   version, title
              FROM media_info
             WHERE (release_key, file, origin) IN (VALUES ${tuples})`
      );
      for (const r of rows) {
        out.set(`${r.release_key}\0${r.file}\0${r.origin}`, toRow(r).info);
      }
    }
    return out;
  }

  /** Whether this instance has probed the file with the current prober. */
  static async hasCurrent(releaseKey: string, file: string): Promise<boolean> {
    const rows = await getDb().query<{ version: number | string }>(
      sql`SELECT version FROM media_info
           WHERE release_key = ${releaseKey} AND file = ${file}
             AND origin = ${LOCAL_ORIGIN}`
    );
    return rows.some((r) => Number(r.version) >= MEDIA_INFO_VERSION);
  }

  /** `entry` carries the entry's NZB URL, which must not leave the server. */
  static async listFiles(
    opts: { limit: number; offset: number } & MediaInfoFileFilter
  ): Promise<{
    items: (MediaInfoRow & {
      nzbName: string | null;
      updatedAt: number;
      entry: { releaseKey: string | null; nzbUrl: string | null };
    })[];
    total: number;
    capped: boolean;
  }> {
    // Planners without statistics walk the listed index for any filter; `+`
    // keeps narrow key filters, and the few usenet keys, on the primary key.
    const search = opts.search?.trim().toLowerCase();
    const searchedKeys = search ? keysOf(search) : undefined;
    const keys = opts.nzbHash
      ? [`nh1:${opts.nzbHash}`]
      : opts.infoHash
        ? [`btih:${opts.infoHash}`]
        : searchedKeys;
    let where = keys
      ? sql`m.release_key IN (${join(keys.map((k) => sql`${k}`))})`
      : opts.kind === 'usenet'
        ? sql`+m.listed = 1`
        : sql`m.listed = 1`;
    // A probe found by any key it is stored under, listed or not.
    if (keys && !searchedKeys) where = sql`${where} AND +m.listed = 1`;
    if (opts.origin) where = sql`${where} AND m.origin = ${opts.origin}`;
    if (opts.kind === 'torrent') {
      where = sql`${where} AND m.release_key >= 'btih:' AND m.release_key < 'btih;'`;
    } else if (opts.kind === 'usenet') {
      where = sql`${where} AND m.release_key > 'btih;'`;
    }
    // A name search reads every row, so it is never counted.
    const byName = search && !searchedKeys;
    if (byName) {
      const pattern = `%${search}%`;
      where = sql`${where} AND (LOWER(m.file) LIKE ${pattern}
        OR LOWER(COALESCE(m.title, '')) LIKE ${pattern})`;
    }
    const from = sql`FROM media_info m
      LEFT JOIN usenet_library l
        ON m.release_key LIKE 'nh1:%' AND l.nzb_hash = SUBSTR(m.release_key, 5)`;
    const [rows, counted] = await Promise.all([
      getDb().query<
        DbRow & {
          nzb_name: string | null;
          entry_release_key: string | null;
          entry_nzb_url: string | null;
          updated_at: unknown;
        }
      >(
        sql`SELECT m.release_key, m.file, m.origin, m.release_files, m.size,
                   m.info, m.version, m.title, m.updated_at,
                   l.name AS nzb_name, l.release_key AS entry_release_key,
                   l.nzb_url AS entry_nzb_url
            ${from} WHERE ${where}
            ORDER BY m.updated_at DESC
            LIMIT ${opts.limit + 1} OFFSET ${opts.offset}`
      ),
      byName
        ? Promise.resolve(undefined)
        : getDb().count(
            sql`SELECT COUNT(*) AS count FROM (
                  SELECT 1 AS one FROM media_info m WHERE ${where}
                  LIMIT ${LIST_COUNT_CAP + 1}) capped`
          ),
    ]);
    const more = rows.length > opts.limit;
    const items = rows.slice(0, opts.limit).map((r) => ({
      ...toRow(r),
      nzbName: r.nzb_name,
      updatedAt: Number(r.updated_at),
      entry: { releaseKey: r.entry_release_key, nzbUrl: r.entry_nzb_url },
    }));
    if (counted === undefined) {
      return {
        items,
        total: opts.offset + items.length + (more ? 1 : 0),
        capped: more,
      };
    }
    return {
      items,
      total: Math.min(counted, LIST_COUNT_CAP),
      capped: counted > LIST_COUNT_CAP,
    };
  }

  /** How many files of each post this instance has probed. */
  static async countByPost(nzbHashes: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const keys = [...new Set(nzbHashes)].map((h) => `nh1:${h}`);
    for (let i = 0; i < keys.length; i += CHUNK) {
      const rows = await getDb().query<{
        release_key: string;
        n: number | string;
      }>(
        sql`SELECT release_key, COUNT(*) AS n FROM media_info
             WHERE ${keyIn(keys.slice(i, i + CHUNK))}
               AND origin = ${LOCAL_ORIGIN}
             GROUP BY release_key`
      );
      for (const r of rows) counts.set(r.release_key.slice(4), Number(r.n));
    }
    return counts;
  }

  /**
   * Rows written together for one file and record are one probe, listed under
   * its best key.
   */
  static async upsert(rows: MediaInfoRow[]): Promise<void> {
    if (rows.length === 0) return;
    const now = Date.now();
    const texts = rows.map((r) => JSON.stringify(r.info));
    const best = new Map<string, number>();
    rows.forEach((r, i) => {
      const probe = `${r.origin}\0${r.file}\0${texts[i]}`;
      const held = best.get(probe);
      if (
        held === undefined ||
        keyRank(r.releaseKey) < keyRank(rows[held].releaseKey)
      ) {
        best.set(probe, i);
      }
    });
    const listed = new Set(best.values());
    for (let i = 0; i < rows.length; i += CHUNK) {
      const values = rows.slice(i, i + CHUNK).map((r, j) => {
        const at = i + j;
        return sql`(${r.releaseKey}, ${r.file}, ${r.origin}, ${r.releaseFiles},
            ${r.size}, ${packInfo(texts[at])}, ${r.version}, ${r.title ?? null},
            ${listed.has(at) ? 1 : 0}, ${now}, ${now})`;
      });
      await getDb().exec(
        sql`INSERT INTO media_info
              (release_key, file, origin, release_files, size, info, version,
               title, listed, created_at, updated_at)
            VALUES ${join(values)}
            ON CONFLICT(release_key, file, origin) DO UPDATE SET
              release_files = excluded.release_files,
              size = excluded.size,
              info = excluded.info,
              version = excluded.version,
              title = COALESCE(excluded.title, media_info.title),
              listed = excluded.listed,
              updated_at = excluded.updated_at
            WHERE media_info.version <= excluded.version
              AND (media_info.version < excluded.version
                OR media_info.info <> excluded.info
                OR media_info.release_files <> excluded.release_files
                OR media_info.listed <> excluded.listed
                OR (media_info.title IS NULL AND excluded.title IS NOT NULL))`
      );
    }
  }
}
