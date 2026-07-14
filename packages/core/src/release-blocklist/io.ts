import { isValidReleaseKey, WD1_KEY_REGEX } from './keys.js';
import type { BlocklistRecord } from './types.js';
import { isBlocklistVerdict, moreSevereVerdict, N_CAP } from './types.js';

/**
 * NDJSON interchange codec. Two dialects share the shape "header line,
 * then one JSON record per line":
 *
 *   native: {"blocklist":1,"updated":<unix>} then {"k","v","n","at","bk"?}
 *   warden: {"warden":1,"updated":<unix>}    then {"fp","bk","deadAt","n"}
 *
 * Warden records have no verdict field and import as `dead`; exports in
 * the warden dialect therefore carry only the dead usenet subset. Unknown
 * JSON fields are ignored in both directions.
 *
 * The header `updated` defaults to the newest emitted record timestamp so
 * an unchanged list serializes to identical bytes (publish targets rely on
 * this for change detection).
 */

export type BlocklistDialect = 'native' | 'warden';

export interface ParsedBlocklist {
  records: BlocklistRecord[];
  /** Lines that were neither a header nor a valid record. */
  invalid: number;
  dialect: BlocklistDialect | null;
}

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const n = typeof value === 'number' ? Math.floor(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function readBackbones(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const set = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().toLowerCase();
    if (trimmed) set.add(trimmed);
  }
  return [...set];
}

export function parseNdjson(
  text: string,
  nowUnixSeconds: number = Math.floor(Date.now() / 1000)
): ParsedBlocklist {
  const maxAt = nowUnixSeconds + 86400;
  const records: BlocklistRecord[] = [];
  let invalid = 0;
  let dialect: BlocklistDialect | null = null;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      invalid++;
      continue;
    }
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      invalid++;
      continue;
    }
    const row = obj as Record<string, unknown>;

    if (typeof row.k === 'string') {
      if (
        isValidReleaseKey(row.k) &&
        typeof row.v === 'string' &&
        isBlocklistVerdict(row.v)
      ) {
        records.push({
          k: row.k,
          v: row.v,
          n: clampInt(row.n, 1, 1, N_CAP),
          at: clampInt(row.at, 0, 0, maxAt),
          bk: readBackbones(row.bk),
        });
      } else {
        invalid++;
      }
      continue;
    }

    if (typeof row.fp === 'string') {
      if (WD1_KEY_REGEX.test(row.fp)) {
        records.push({
          k: row.fp,
          v: 'dead',
          n: clampInt(row.n, 1, 1, N_CAP),
          at: clampInt(row.deadAt, 0, 0, maxAt),
          bk: readBackbones(row.bk),
        });
      } else {
        invalid++;
      }
      continue;
    }

    if (typeof row.blocklist === 'number') {
      dialect = 'native';
      continue;
    }
    if (typeof row.warden === 'number') {
      dialect = 'warden';
      continue;
    }
    invalid++;
  }

  return { records, invalid, dialect };
}

function maxRecordAt(records: readonly BlocklistRecord[]): number | undefined {
  let max: number | undefined;
  for (const record of records) {
    if (max === undefined || record.at > max) max = record.at;
  }
  return max;
}

export function toNativeNdjson(
  records: readonly BlocklistRecord[],
  updatedAtUnixSeconds?: number
): string {
  const updated =
    updatedAtUnixSeconds ??
    maxRecordAt(records) ??
    Math.floor(Date.now() / 1000);
  const lines = [JSON.stringify({ blocklist: 1, updated })];
  for (const record of records) {
    const line: Record<string, unknown> = {
      k: record.k,
      v: record.v,
      n: record.n,
      at: record.at,
    };
    if (record.bk && record.bk.length > 0) line.bk = record.bk;
    lines.push(JSON.stringify(line));
  }
  return lines.join('\n') + '\n';
}

export function toWardenNdjson(
  records: readonly BlocklistRecord[],
  updatedAtUnixSeconds?: number
): string {
  const subset = records.filter(
    (record) => record.v === 'dead' && WD1_KEY_REGEX.test(record.k)
  );
  const updated =
    updatedAtUnixSeconds ??
    maxRecordAt(subset) ??
    Math.floor(Date.now() / 1000);
  const lines = [JSON.stringify({ warden: 1, updated })];
  for (const record of subset) {
    lines.push(
      JSON.stringify({
        fp: record.k,
        bk: record.bk ?? [],
        deadAt: record.at,
        n: record.n,
      })
    );
  }
  return lines.join('\n') + '\n';
}

/**
 * Merge duplicate keys across records: worst verdict, summed count, newest
 * timestamp. Backbones union, except that an empty set means "applies
 * everywhere" and swallows any narrower scope.
 */
export function dedupeRecords(
  records: readonly BlocklistRecord[]
): BlocklistRecord[] {
  const byKey = new Map<string, BlocklistRecord>();
  for (const record of records) {
    const existing = byKey.get(record.k);
    if (!existing) {
      byKey.set(record.k, { ...record, bk: record.bk ? [...record.bk] : [] });
      continue;
    }
    existing.v = moreSevereVerdict(existing.v, record.v);
    existing.n = Math.min(N_CAP, existing.n + record.n);
    existing.at = Math.max(existing.at, record.at);
    const incoming = record.bk ?? [];
    if (existing.bk!.length === 0 || incoming.length === 0) {
      existing.bk = [];
    } else {
      existing.bk = [...new Set([...existing.bk!, ...incoming])];
    }
  }
  return [...byKey.values()];
}
