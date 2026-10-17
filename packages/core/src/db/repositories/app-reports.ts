import { randomInt } from 'node:crypto';
import { getDb } from '../db.js';
import { deleteInBatches } from '../prune.js';
import { join, sql } from '../sql.js';

export type AppReportKind = 'crash' | 'report';

export interface AppReportInput {
  uuid?: string | null;
  persona?: string | null;
  /** The server that passed the report on. */
  origin?: string | null;
  kind: AppReportKind;
  platform: string;
  appVersion: string;
  device: string;
  note: string;
  summary: string;
  details: string;
}

export interface AppReportListing {
  code: string;
  createdAt: number;
  uuid: string | null;
  persona: string | null;
  origin: string | null;
  kind: AppReportKind;
  platform: string;
  appVersion: string;
  device: string;
  note: string;
  /** The summary's first line. */
  headline: string;
}

export interface AppReport extends AppReportListing {
  summary: string;
  details: string;
}

interface Row {
  code: string;
  created_at: number | string;
  uuid: string | null;
  persona: string | null;
  origin: string | null;
  kind: string;
  platform: string;
  app_version: string;
  device: string;
  note: string;
  summary: string;
  details?: string;
  [k: string]: unknown;
}

/** Read aloud from a TV, so nothing that looks like another character. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 7;

const newCode = () =>
  Array.from(
    { length: CODE_LENGTH },
    () => ALPHABET[randomInt(ALPHABET.length)]
  ).join('');

/** A code as typed or read out: any case, with or without its dash. */
export const normaliseReportCode = (code: string) =>
  code.toUpperCase().replace(/[^0-9A-Z]/g, '');

/** As shown: `ABC-DEFG`. */
export const formatReportCode = (code: string) =>
  `${code.slice(0, 3)}-${code.slice(3)}`;

function listing(row: Row): AppReportListing {
  return {
    code: row.code,
    createdAt: Number(row.created_at),
    uuid: row.uuid,
    persona: row.persona,
    origin: row.origin,
    kind: row.kind === 'crash' ? 'crash' : 'report',
    platform: row.platform,
    appVersion: row.app_version,
    device: row.device,
    note: row.note,
    headline: row.summary.split('\n', 1)[0] ?? '',
  };
}

export class AppReportRepository {
  /** Stores a report under a new code. */
  static async create(report: AppReportInput): Promise<string> {
    for (;;) {
      const code = newCode();
      const res = await getDb().exec(
        sql`INSERT INTO app_reports (code, created_at, uuid, persona, origin, kind,
              platform, app_version, device, note, summary, details)
            VALUES (${code}, ${Date.now()}, ${report.uuid ?? null}, ${report.persona ?? null},
              ${report.origin ?? null}, ${report.kind}, ${report.platform}, ${report.appVersion},
              ${report.device}, ${report.note}, ${report.summary}, ${report.details})
            ON CONFLICT (code) DO NOTHING`
      );
      if (res.rowCount) return code;
    }
  }

  static async get(code: string): Promise<AppReport | null> {
    const row = await getDb().maybeOne<Row>(
      sql`SELECT * FROM app_reports WHERE code = ${normaliseReportCode(code)}`
    );
    return row
      ? { ...listing(row), summary: row.summary, details: row.details ?? '' }
      : null;
  }

  /** A page of them, newest first, and how many there are. */
  static async list(
    limit: number,
    offset: number
  ): Promise<{ items: AppReportListing[]; total: number }> {
    const [rows, total] = await Promise.all([
      getDb().query<Row>(
        sql`SELECT code, created_at, uuid, persona, origin, kind, platform, app_version,
                   device, note, summary
              FROM app_reports
             ORDER BY created_at DESC
             LIMIT ${limit} OFFSET ${offset}`
      ),
      getDb().count(sql`SELECT COUNT(*) FROM app_reports`),
    ]);
    return { items: rows.map(listing), total };
  }

  static async remove(codes: string[]): Promise<number> {
    if (!codes.length) return 0;
    const res = await getDb().exec(
      sql`DELETE FROM app_reports WHERE code IN (${join(
        codes.map((c) => sql`${normaliseReportCode(c)}`)
      )})`
    );
    return res.rowCount ?? 0;
  }

  /** Deletes all but the newest `keep`. */
  static async trim(keep: number): Promise<number> {
    const res = await getDb().exec(
      sql`DELETE FROM app_reports WHERE code IN (
            SELECT code FROM app_reports ORDER BY created_at DESC
             LIMIT 1000000000 OFFSET ${keep})`
    );
    return res.rowCount ?? 0;
  }

  static async clear(): Promise<number> {
    const res = await getDb().exec(sql`DELETE FROM app_reports`);
    return res.rowCount ?? 0;
  }

  static async prune(olderThanMs: number): Promise<number> {
    const before = Date.now() - olderThanMs;
    const { deleted } = await deleteInBatches(async () => {
      const res = await getDb().exec(
        sql`DELETE FROM app_reports WHERE code IN (
              SELECT code FROM app_reports WHERE created_at < ${before} LIMIT 500)`
      );
      return res.rowCount ?? 0;
    });
    return deleted;
  }
}
