import type { MediaInfoProbePath } from '../../config/schema/media-info.js';
import { getDb } from '../db.js';
import { deleteInBatches, type PruneResult } from '../prune.js';
import { sql, type SqlFragment } from '../sql.js';
import { LIST_COUNT_CAP } from './media-info.js';

export type ProbePath = MediaInfoProbePath;
export type ProbeKind = 'usenet' | 'torrent';
export type ProbeReader = 'engine' | 'http' | 'api';
/** `applied` read a file with no trusted key: used once, not stored. */
export type ProbeOutcome =
  | 'stored'
  | 'applied'
  | 'empty'
  | 'failed'
  | 'timeout'
  | 'cancelled';

export interface ProbeAttempt {
  id: string;
  releaseKey: string;
  file: string;
  path: ProbePath;
  kind: ProbeKind;
  reader: ProbeReader;
  outcome: ProbeOutcome;
  error: string | null;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number;
  bytesRead: number;
  tracks: number | null;
}

interface DbRow {
  id: string;
  release_key: string;
  file: string;
  path: string;
  kind: string;
  reader: string;
  outcome: string;
  error: string | null;
  queued_at: number | string;
  started_at: number | string | null;
  finished_at: number | string;
  bytes_read: number | string;
  tracks: number | string | null;
  [k: string]: unknown;
}

function toAttempt(r: DbRow): ProbeAttempt {
  return {
    id: r.id,
    releaseKey: r.release_key,
    file: r.file,
    path: r.path as ProbePath,
    kind: r.kind as ProbeKind,
    reader: r.reader as ProbeReader,
    outcome: r.outcome as ProbeOutcome,
    error: r.error,
    queuedAt: Number(r.queued_at),
    startedAt: r.started_at === null ? null : Number(r.started_at),
    finishedAt: Number(r.finished_at),
    bytesRead: Number(r.bytes_read),
    tracks: r.tracks === null ? null : Number(r.tracks),
  };
}

export interface ProbeAttemptFilter {
  outcome?: ProbeOutcome;
  path?: ProbePath;
  kind?: ProbeKind;
  search?: string;
}

function filters(opts: ProbeAttemptFilter) {
  const where: SqlFragment[] = [sql`1 = 1`];
  if (opts.outcome) where.push(sql`outcome = ${opts.outcome}`);
  if (opts.path) where.push(sql`path = ${opts.path}`);
  if (opts.kind) where.push(sql`kind = ${opts.kind}`);
  const search = opts.search?.trim().toLowerCase();
  if (search) where.push(sql`LOWER(file) LIKE ${`%${search}%`}`);
  return where.reduce((acc, part) => sql`${acc} AND ${part}`);
}

export class MediaInfoProbeRepository {
  static async record(a: ProbeAttempt): Promise<void> {
    await getDb().exec(
      sql`INSERT INTO media_info_probes
            (id, release_key, file, path, kind, reader, outcome, error,
             queued_at, started_at, finished_at, bytes_read, tracks)
          VALUES (${a.id}, ${a.releaseKey}, ${a.file}, ${a.path}, ${a.kind},
                  ${a.reader}, ${a.outcome}, ${a.error}, ${a.queuedAt},
                  ${a.startedAt}, ${a.finishedAt}, ${a.bytesRead}, ${a.tracks})`
    );
  }

  static async list(
    opts: { limit: number; offset: number } & ProbeAttemptFilter
  ): Promise<{ items: ProbeAttempt[]; total: number; capped: boolean }> {
    const where = filters(opts);
    const [rows, counted] = await Promise.all([
      getDb().query<DbRow>(
        sql`SELECT * FROM media_info_probes WHERE ${where}
             ORDER BY finished_at DESC
             LIMIT ${opts.limit} OFFSET ${opts.offset}`
      ),
      getDb().count(
        sql`SELECT COUNT(*) AS count FROM (
              SELECT 1 AS one FROM media_info_probes WHERE ${where}
              LIMIT ${LIST_COUNT_CAP + 1}) capped`
      ),
    ]);
    return {
      items: rows.map(toAttempt),
      total: Math.min(counted, LIST_COUNT_CAP),
      capped: counted > LIST_COUNT_CAP,
    };
  }

  static async countBy(
    column: 'outcome' | 'path',
    from: number
  ): Promise<Map<string, number>> {
    const rows = await getDb().query<{ value: string; n: number | string }>(
      column === 'outcome'
        ? sql`SELECT outcome AS value, COUNT(*) AS n FROM media_info_probes
               WHERE finished_at >= ${from} GROUP BY outcome`
        : sql`SELECT path AS value, COUNT(*) AS n FROM media_info_probes
               WHERE finished_at >= ${from} GROUP BY path`
    );
    return new Map(rows.map((r) => [r.value, Number(r.n)]));
  }

  static async countByHour(from: number): Promise<Map<number, number>> {
    const rows = await getDb().query<{
      hour: number | string;
      n: number | string;
    }>(
      sql`SELECT finished_at / 3600000 AS hour, COUNT(*) AS n
            FROM media_info_probes WHERE finished_at >= ${from}
           GROUP BY finished_at / 3600000`
    );
    return new Map(rows.map((r) => [Number(r.hour), Number(r.n)]));
  }

  /** The `index`th shortest read since `from`, in ms. */
  static async readMsAt(from: number, index: number): Promise<number | null> {
    const [row] = await getDb().query<{ ms: number | string }>(
      sql`SELECT finished_at - started_at AS ms FROM media_info_probes
           WHERE finished_at >= ${from} AND started_at IS NOT NULL
             AND outcome IN ('stored', 'applied')
           ORDER BY ms LIMIT 1 OFFSET ${index}`
    );
    return row ? Number(row.ms) : null;
  }

  static async recentReadMs(from: number, limit: number): Promise<number[]> {
    const rows = await getDb().query<{ ms: number | string }>(
      sql`SELECT finished_at - started_at AS ms FROM media_info_probes
           WHERE finished_at >= ${from} AND started_at IS NOT NULL
             AND outcome IN ('stored', 'applied')
           ORDER BY finished_at DESC LIMIT ${limit}`
    );
    return rows.map((r) => Number(r.ms));
  }

  static async pruneOlderThan(cutoff: number): Promise<PruneResult> {
    return deleteInBatches(async () => {
      const result = await getDb().exec(
        sql`DELETE FROM media_info_probes WHERE id IN (
              SELECT id FROM media_info_probes WHERE finished_at < ${cutoff}
              LIMIT 500)`
      );
      return result.rowCount;
    });
  }
}
