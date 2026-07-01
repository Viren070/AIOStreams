import { isValidKey, keyKind } from './key.js';
import {
  isVerdict,
  moreSevere,
  N_CAP,
  type ScreenerRecord,
  type Verdict,
} from './types.js';

/**
 * The portable interchange format. NDJSON: a header line then one record per
 * line. Two dialects are read transparently on import:
 *
 *   native (aiostreams)  header {"screener":1,"updated":<unix>}
 *                        record {"k":"btih:...|wd1:...","v":"dead","n":1,"at":<unix>,"bk":[...]}
 *
 *   davex  (nzbdavex)    header {"warden":1,"updated":<unix>}
 *                        record {"fp":"wd1:...","bk":[...],"deadAt":<unix>,"n":1}
 *
 * davex only carries dead usenet fingerprints, so its records import as
 * `verdict: 'dead'`. Exporting the usenet subset back to davex (see
 * `toDavexNdjson`) is lossless, which is what keeps the two ecosystems sharing
 * one pool.
 */

export interface ParsedNdjson {
  records: ScreenerRecord[];
  /** Lines that were non-empty but not a valid record (excludes the header). */
  invalid: number;
}

/** Serialize records as native NDJSON with a header stamped `updatedAt`. */
export function toNdjson(
  records: readonly ScreenerRecord[],
  updatedAt: number
): string {
  const lines: string[] = [
    JSON.stringify({ screener: 1, updated: Math.trunc(updatedAt) }),
  ];
  for (const r of records) {
    const line: ScreenerRecord = { k: r.k, v: r.v, n: r.n, at: r.at };
    if (r.bk && r.bk.length > 0) line.bk = r.bk;
    lines.push(JSON.stringify(line));
  }
  return lines.join('\n') + '\n';
}

/**
 * Serialize the usenet (`wd1:`) subset as davex-format NDJSON so the list can be
 * consumed by an nzbdavex Warden. Non-usenet keys are dropped (davex can't use
 * them). Only `dead` is meaningful to davex; other verdicts are dropped.
 */
export function toDavexNdjson(
  records: readonly ScreenerRecord[],
  updatedAt: number
): string {
  const lines: string[] = [
    JSON.stringify({ warden: 1, updated: Math.trunc(updatedAt) }),
  ];
  for (const r of records) {
    if (r.v !== 'dead' || keyKind(r.k) !== 'usenet') continue;
    lines.push(
      JSON.stringify({ fp: r.k, bk: r.bk ?? [], deadAt: r.at, n: r.n })
    );
  }
  return lines.join('\n') + '\n';
}

/** Build a record from an already-parsed line, or null if it isn't a usable one. */
function parseLine(obj: any): ScreenerRecord | null {
  if (obj === null || typeof obj !== 'object') return null;

  // davex record
  if (typeof obj.fp === 'string') {
    if (!isValidKey(obj.fp) || keyKind(obj.fp) !== 'usenet') return null;
    const rec: ScreenerRecord = {
      k: obj.fp,
      v: 'dead',
      n: toCount(obj.n),
      at: toUnix(obj.deadAt),
    };
    const bk = toBk(obj.bk);
    if (bk) rec.bk = bk;
    return rec;
  }

  // native record
  if (typeof obj.k === 'string') {
    if (!isValidKey(obj.k) || !isVerdict(obj.v)) return null;
    const rec: ScreenerRecord = {
      k: obj.k,
      v: obj.v as Verdict,
      n: toCount(obj.n),
      at: toUnix(obj.at),
    };
    const bk = toBk(obj.bk);
    if (bk) rec.bk = bk;
    return rec;
  }

  // header ({screener|warden, updated}) or unknown shape
  return null;
}

/** Parse a whole NDJSON document (native or davex), skipping header/blank lines. */
export function parseNdjson(text: string): ParsedNdjson {
  const records: ScreenerRecord[] = [];
  let invalid = 0;
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      invalid++;
      continue;
    }
    // A header line is valid input, not an invalid record, don't count it.
    if (isHeader(obj)) continue;
    const rec = parseLine(obj);
    if (rec) records.push(rec);
    else invalid++;
  }
  return { records, invalid };
}

function isHeader(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false;
  if (obj.k !== undefined || obj.fp !== undefined) return false;
  // The version field must be a number, so a malformed first line like
  // {"screener":"oops"} is treated as an invalid record, not a header.
  return typeof obj.screener === 'number' || typeof obj.warden === 'number';
}

function toCount(n: unknown): number {
  const v = Number(n);
  // A positive but fractional count still means "seen once", never truncate it
  // to 0 and silently drop the record's weight. Capped so a crafted import can't
  // seed an absurd count that survives later merges.
  return Number.isFinite(v) && v > 0
    ? Math.min(Math.max(1, Math.trunc(v)), N_CAP)
    : 1;
}

function toUnix(at: unknown): number {
  const v = Number(at);
  return Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0;
}

function toBk(bk: unknown): string[] | undefined {
  if (!Array.isArray(bk)) return undefined;
  const out = bk
    .filter((b): b is string => typeof b === 'string' && b.trim() !== '')
    .map((b) => b.trim());
  return out.length > 0 ? out : undefined;
}

/**
 * Merge duplicate records (same key) across sources for export. Keeps the most
 * severe verdict, sums counts (capped), takes the newest timestamp, and unions
 * backbones, an empty/omitted `bk` is global and stays global rather than being
 * narrowed by a scoped sibling.
 */
export function dedupeRecords(
  records: readonly ScreenerRecord[]
): ScreenerRecord[] {
  const merged = new Map<string, ScreenerRecord>();
  for (const rec of records) {
    const existing = merged.get(rec.k);
    if (!existing) {
      merged.set(rec.k, { ...rec });
      continue;
    }
    existing.v = moreSevere(existing.v, rec.v);
    existing.n = Math.min(existing.n + rec.n, N_CAP);
    existing.at = Math.max(existing.at, rec.at);
    const existingBk = existing.bk ?? [];
    const recBk = rec.bk ?? [];
    if (existingBk.length === 0 || recBk.length === 0) {
      delete existing.bk;
    } else {
      existing.bk = [...new Set([...existingBk, ...recBk])];
    }
  }
  return [...merged.values()];
}
