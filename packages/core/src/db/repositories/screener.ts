import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import { sql, raw, join, type SqlFragment } from '../sql.js';
import { createLogger } from '../../logging/logger.js';
import { keyKind } from '../../screener/key.js';
import { evaluateKey, type SourceVerdict } from '../../screener/evaluate.js';
import { dedupeRecords } from '../../screener/io.js';
import {
  LOCAL_SOURCE_ID,
  N_CAP,
  isVerdict,
  normaliseTrust,
  type ScreenerEvalOptions,
  type ScreenerRecord,
  type ScreenerSource,
  type ScreenerVerdict,
  type SourceKind,
  type Trust,
  type Verdict,
} from '../../screener/types.js';

const logger = createLogger('screener-store');

const nowSec = (): number => Math.floor(Date.now() / 1000);
const KEY_CHUNK = 500;

/** SQL `CASE` mapping a verdict column to its severity (fake > dead > mislabeled). */
function severity(col: string): SqlFragment {
  return raw(
    `CASE ${col} WHEN 'fake' THEN 3 WHEN 'dead' THEN 2 WHEN 'mislabeled' THEN 1 ELSE 0 END`
  );
}

function csvToList(csv: unknown): string[] {
  if (typeof csv !== 'string' || csv === '') return [];
  return [
    ...new Set(
      csv
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
    ),
  ];
}

function mergeCsv(existing: unknown, add: readonly string[]): string {
  const set = new Set(csvToList(existing));
  for (const b of add) {
    const t = b.trim();
    if (t !== '') set.add(t);
  }
  return [...set].join(',');
}

interface EntryJoinRow {
  k: string;
  verdict: string;
  backbones: string | null;
  source_id: string;
  trust: string;
  [col: string]: unknown;
}

interface SourceRow {
  id: string;
  kind: string;
  name: string;
  url: string | null;
  enabled: number;
  trust: string;
  refresh_hours: number;
  last_checked: number;
  last_updated: number;
  status: string | null;
  count: number;
  [col: string]: unknown;
}

/**
 * Instance-global store behind the Screener feature: the dead/fake/mislabeled
 * release verdicts and the sources they come from. Per-user filtering knobs
 * (quorum, backbone scope) are passed in per call, not read from here.
 */
export class ScreenerStore {
  // --- presence cache -------------------------------------------------------
  // Lets the request-path filter skip all work on instances with an empty store
  // without a query per request. Invalidated whenever entries change.
  private static presence: { at: number; value: boolean } | null = null;
  private static readonly PRESENCE_TTL_MS = 30_000;

  /** Cheap, cached check for whether the store holds any entries at all. */
  static async hasEntries(): Promise<boolean> {
    const now = Date.now();
    if (this.presence && now - this.presence.at < this.PRESENCE_TTL_MS) {
      return this.presence.value;
    }
    try {
      const total = await getDb().count(
        sql`SELECT COUNT(*) FROM screener_entries`
      );
      this.presence = { at: now, value: total > 0 };
      return this.presence.value;
    } catch (err) {
      // Never cache a DB-error "empty": a transient blip would otherwise disable
      // filtering for the whole TTL. Fall back to the last known value.
      logger.debug(`screener presence check failed: ${err}`);
      return this.presence?.value ?? false;
    }
  }

  private static invalidatePresence(): void {
    this.presence = null;
  }

  // --- auto-fill (local source) ---------------------------------------------

  /**
   * Record a verdict for a release on the local source. Idempotent-ish: repeat
   * calls bump the count, keep the most severe verdict, and union backbones.
   */
  static async markVerdict(
    key: string,
    verdict: Verdict,
    backbones: readonly string[] = []
  ): Promise<void> {
    const kind = keyKind(key);
    if (!kind || !isVerdict(verdict)) return;
    // Empty backbones == "global" (applies on any backbone); a fresh mark adopts
    // ours, or '' when this instance has none.
    const addCsv = mergeCsv('', backbones);
    const at = nowSec();
    const db = getDb();
    try {
      // Single atomic upsert: the verdict/count/backbone merge happens in the
      // DO UPDATE against the live row, so racing marks can't downgrade a
      // stronger verdict or re-narrow a global backbone set from a stale read.
      // Backbones stay global if either side is global, and don't grow when an
      // unchanged scope is re-marked.
      await db.exec(
        sql`INSERT INTO screener_entries
              (source_id, k, kind, verdict, n, last_at, backbones)
            VALUES (${LOCAL_SOURCE_ID}, ${key}, ${kind}, ${verdict}, 1, ${at}, ${addCsv})
            ON CONFLICT (source_id, k) DO UPDATE SET
              verdict = CASE WHEN (${severity('excluded.verdict')}) >= (${severity('verdict')})
                             THEN excluded.verdict ELSE verdict END,
              n = ${raw('CASE WHEN n + 1 > ' + N_CAP + ' THEN ' + N_CAP + ' ELSE n + 1 END')},
              last_at = ${raw('CASE WHEN excluded.last_at > last_at THEN excluded.last_at ELSE last_at END')},
              backbones = CASE
                WHEN backbones = '' OR excluded.backbones = '' THEN ''
                WHEN backbones = excluded.backbones THEN backbones
                ELSE backbones || ',' || excluded.backbones END`
      );
      ScreenerStore.invalidatePresence();
    } catch (err) {
      // Auto-mark callers are fire-and-forget (they .catch); the /mark route
      // awaits, so surface the failure instead of reporting a fake success.
      logger.debug(`screener mark failed: ${err}`);
      throw err;
    }
  }

  // --- filtering ------------------------------------------------------------

  /**
   * Evaluate a batch of release keys against all enabled sources. Returns a map
   * of key -> verdict for every key that had at least one contributing source
   * row; keys absent from the map are not flagged. `.filtered` says whether the
   * caller should actually hide it.
   */
  static async evaluateKeys(
    keys: readonly string[],
    opts: ScreenerEvalOptions
  ): Promise<Map<string, ScreenerVerdict>> {
    const out = new Map<string, ScreenerVerdict>();
    const unique = [...new Set(keys.filter((k) => keyKind(k) !== null))];
    if (unique.length === 0) return out;
    const db = getDb();

    for (let i = 0; i < unique.length; i += KEY_CHUNK) {
      const slice = unique.slice(i, i + KEY_CHUNK);
      const inList = join(slice.map((k) => sql`${k}`));
      // Let a query failure propagate. The request-path caller (applyScreener)
      // fails open as a whole; swallowing here would instead make this chunk's
      // keys look clean and let flagged releases through silently.
      const rows = await db.query<EntryJoinRow>(
        sql`SELECT e.k AS k, e.verdict AS verdict, e.backbones AS backbones,
                   s.id AS source_id, s.trust AS trust
            FROM screener_entries e
            JOIN screener_sources s ON s.id = e.source_id
            WHERE e.k IN (${inList})
              AND s.enabled = 1
              AND s.trust IN ('full', 'corroborate')`
      );

      const byKey = new Map<string, SourceVerdict[]>();
      for (const r of rows) {
        if (!isVerdict(r.verdict)) continue;
        const list = byKey.get(r.k) ?? [];
        list.push({
          isLocal: r.source_id === LOCAL_SOURCE_ID,
          trust: normaliseTrust(r.trust),
          verdict: r.verdict,
          backbones: csvToList(r.backbones),
        });
        byKey.set(r.k, list);
      }
      for (const [k, list] of byKey) {
        out.set(k, evaluateKey(list, opts));
      }
    }
    return out;
  }

  // --- counts ---------------------------------------------------------------

  static async getCounts(): Promise<{ total: number; local: number }> {
    const db = getDb();
    const total = await db.count(sql`SELECT COUNT(*) FROM screener_entries`);
    const local = await db.count(
      sql`SELECT COUNT(*) FROM screener_entries WHERE source_id = ${LOCAL_SOURCE_ID}`
    );
    return { total, local };
  }

  // --- sources --------------------------------------------------------------

  static async getSources(): Promise<ScreenerSource[]> {
    const db = getDb();
    const rows = await db.query<SourceRow>(
      sql`SELECT s.id, s.kind, s.name, s.url, s.enabled, s.trust, s.refresh_hours,
                 s.last_checked, s.last_updated, s.status,
                 (SELECT COUNT(*) FROM screener_entries e WHERE e.source_id = s.id) AS count
          FROM screener_sources s
          ORDER BY CASE WHEN s.id = ${LOCAL_SOURCE_ID} THEN 0 ELSE 1 END, s.sort, s.name`
    );
    return rows.map(rowToSource);
  }

  static async addSource(
    kind: Exclude<SourceKind, 'local'>,
    name: string,
    url: string | null,
    trust: Trust,
    refreshHours: number
  ): Promise<string> {
    const trimmedUrl = url?.trim() || null;
    if (kind === 'remote' && !trimmedUrl) {
      throw new Error('A remote source requires a URL.');
    }
    const id = 'src_' + randomUUID().replace(/-/g, '').slice(0, 12);
    const db = getDb();
    await db.exec(
      sql`INSERT INTO screener_sources
            (id, kind, name, url, enabled, trust, refresh_hours, last_checked, last_updated, status, sort)
          VALUES (${id}, ${kind}, ${name.trim() || 'Untitled'}, ${trimmedUrl},
                  1, ${normaliseTrust(trust)}, ${clampRefreshHours(refreshHours)}, 0, 0, NULL,
                  ${raw('(SELECT COALESCE(MAX(sort), 0) + 1 FROM screener_sources)')})`
    );
    return id;
  }

  static async updateSource(
    id: string,
    fields: {
      enabled?: boolean;
      trust?: Trust;
      refreshHours?: number;
      name?: string;
    }
  ): Promise<void> {
    if (id === LOCAL_SOURCE_ID) return;
    const sets: SqlFragment[] = [];
    if (fields.enabled !== undefined)
      sets.push(sql`enabled = ${fields.enabled ? 1 : 0}`);
    if (fields.trust !== undefined)
      sets.push(sql`trust = ${normaliseTrust(fields.trust)}`);
    if (fields.refreshHours !== undefined)
      sets.push(sql`refresh_hours = ${clampRefreshHours(fields.refreshHours)}`);
    if (fields.name !== undefined)
      sets.push(sql`name = ${fields.name.trim() || 'Untitled'}`);
    if (sets.length === 0) return;
    await getDb().exec(
      sql`UPDATE screener_sources SET ${join(sets)} WHERE id = ${id}`
    );
  }

  /** Delete a non-local source and its entries. Returns false for 'local'. */
  static async removeSource(id: string): Promise<boolean> {
    if (id === LOCAL_SOURCE_ID) return false;
    const db = getDb();
    await db.tx(async (tx) => {
      await tx.exec(
        sql`DELETE FROM screener_entries WHERE source_id = ${id}`
      );
      await tx.exec(sql`DELETE FROM screener_sources WHERE id = ${id}`);
    });
    ScreenerStore.invalidatePresence();
    return true;
  }

  /** Empty a source's entries (keeps the source row). Returns rows removed. */
  static async clearSource(id: string): Promise<number> {
    const res = await getDb().exec(
      sql`DELETE FROM screener_entries WHERE source_id = ${id}`
    );
    ScreenerStore.invalidatePresence();
    return res.rowCount;
  }

  static async setSourceStatus(
    id: string,
    etag: string | null,
    lastChecked: number,
    lastUpdated: number,
    status: string | null
  ): Promise<void> {
    await getDb().exec(
      sql`UPDATE screener_sources
          SET etag = ${etag}, last_checked = ${lastChecked},
              last_updated = ${lastUpdated}, status = ${status}
          WHERE id = ${id}`
    );
  }

  static async touchChecked(
    id: string,
    when: number,
    status: string | null
  ): Promise<void> {
    await getDb().exec(
      sql`UPDATE screener_sources SET last_checked = ${when}, status = ${status} WHERE id = ${id}`
    );
  }

  static async getSourceEtag(id: string): Promise<string | null> {
    const row = await getDb().maybeOne<{ etag: string | null }>(
      sql`SELECT etag FROM screener_sources WHERE id = ${id}`
    );
    return row?.etag ?? null;
  }

  // --- bulk import / export -------------------------------------------------

  /**
   * Upsert records into a source. With `replace`, the source's existing entries
   * are cleared first. Invalid keys/verdicts are skipped. Returns rows written.
   */
  static async bulkUpsert(
    sourceId: string,
    records: readonly ScreenerRecord[],
    opts: { replace?: boolean } = {}
  ): Promise<number> {
    const db = getDb();
    const now = nowSec();
    let written = 0;
    const valid = records.filter((rec) => keyKind(rec.k) && isVerdict(rec.v));
    // Block a replace whose payload had records but none survived validation (a
    // garbage feed would otherwise wipe the source). An intentionally empty
    // payload (no records at all) is allowed through to clear the source.
    if (opts.replace && records.length > 0 && valid.length === 0) {
      throw new Error('Refusing to replace a source with only invalid entries.');
    }
    await db.tx(async (tx) => {
      if (opts.replace) {
        await tx.exec(
          sql`DELETE FROM screener_entries WHERE source_id = ${sourceId}`
        );
      }
      for (const rec of valid) {
        const kind = keyKind(rec.k)!;
        const n =
          Number.isFinite(rec.n) && rec.n > 0
            ? Math.min(Math.trunc(rec.n), N_CAP)
            : 1;
        const at = Number.isFinite(rec.at)
          ? Math.min(Math.max(Math.trunc(rec.at), 0), now + 86400)
          : 0;
        const bk = [
          ...new Set((rec.bk ?? []).map((b) => b.trim()).filter((b) => b !== '')),
        ].join(',');
        await tx.exec(
          sql`INSERT INTO screener_entries
                (source_id, k, kind, verdict, n, last_at, backbones)
              VALUES (${sourceId}, ${rec.k}, ${kind}, ${rec.v}, ${n}, ${at}, ${bk})
              ON CONFLICT (source_id, k) DO UPDATE SET
                verdict = CASE WHEN ${severity('excluded.verdict')} >= ${severity('verdict')}
                               THEN excluded.verdict ELSE verdict END,
                n = ${raw('CASE WHEN n + excluded.n > ' + N_CAP + ' THEN ' + N_CAP + ' ELSE n + excluded.n END')},
                last_at = CASE WHEN excluded.last_at > last_at THEN excluded.last_at ELSE last_at END,
                backbones = CASE
                  WHEN backbones = '' OR excluded.backbones = '' THEN ''
                  WHEN backbones = excluded.backbones THEN backbones
                  ELSE backbones || ',' || excluded.backbones
                END`
        );
        written++;
      }
    });
    ScreenerStore.invalidatePresence();
    return written;
  }

  /**
   * Read entries for export. With `dedup`, same-key rows across the given
   * sources are merged into one record: most severe verdict, summed n, latest
   * timestamp, and unioned backbones. Backbones are preserved either way so the
   * export round-trips back through import.
   */
  static async getEntries(
    sourceIds: readonly string[],
    dedup: boolean
  ): Promise<ScreenerRecord[]> {
    const ids = sourceIds.length === 0 ? [LOCAL_SOURCE_ID] : sourceIds;
    const inList = join(ids.map((id) => sql`${id}`));
    const db = getDb();
    const rows = await db.query<{
      k: string;
      verdict: string;
      last_at: number;
      n: number;
      backbones: string | null;
    }>(
      sql`SELECT k, verdict, last_at, n, backbones
          FROM screener_entries WHERE source_id IN (${inList})`
    );

    const records = rows
      .filter((r) => isVerdict(r.verdict))
      .map((r): ScreenerRecord => {
        const bk = csvToList(r.backbones);
        return {
          k: r.k,
          v: r.verdict as Verdict,
          n: Number(r.n),
          at: Number(r.last_at),
          ...(bk.length ? { bk } : {}),
        };
      });
    if (!dedup) return records;
    return dedupeRecords(records);
  }
}

function rowToSource(r: SourceRow): ScreenerSource {
  return {
    id: r.id,
    kind: (['local', 'remote', 'imported'].includes(r.kind)
      ? r.kind
      : 'imported') as SourceKind,
    name: r.name,
    url: r.url,
    enabled: Number(r.enabled) !== 0,
    trust: normaliseTrust(r.trust),
    refreshHours: Number(r.refresh_hours),
    lastChecked: Number(r.last_checked),
    lastUpdated: Number(r.last_updated),
    status: r.status,
    count: Number(r.count),
  };
}

function clampRefreshHours(hours: number): number {
  if (!Number.isFinite(hours)) return 24;
  return Math.min(Math.max(Math.trunc(hours), 1), 24 * 30);
}
