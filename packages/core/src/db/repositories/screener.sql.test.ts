import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { screener } from '../migrations/0012_screener.js';
import { evaluateKey, type SourceVerdict } from '../../screener/evaluate.js';
import { dedupeRecords } from '../../screener/io.js';
import { N_CAP, type ScreenerRecord } from '../../screener/types.js';

/**
 * Validates the exact SQL ScreenerStore emits against a real sqlite engine. The
 * store itself can't be imported here (it pulls db.js -> logger, a module-graph
 * cycle that only resolves from the app entry), so these statements mirror the
 * store's; keep them in sync. The export merge is the store's real `dedupeRecords`
 * run over raw rows, so that half can't drift. End-to-end store coverage happens
 * at app runtime.
 */

const DB_PATH = `${tmpdir()}/screener-sql-${process.pid}.db`;
const TORRENT = 'btih:' + 'a'.repeat(40);
const USENET = 'wd1:' + 'b'.repeat(32);

let db: Database.Database;

const SEV = `CASE %COL% WHEN 'fake' THEN 3 WHEN 'dead' THEN 2 WHEN 'mislabeled' THEN 1 ELSE 0 END`;
const sev = (col: string) => SEV.replace('%COL%', col);

// Mirrors ScreenerStore.markVerdict: a single atomic upsert, all merges computed
// against the live row (no stale pre-read).
const MARK = `
  INSERT INTO screener_entries (source_id, k, kind, verdict, n, last_at, backbones)
  VALUES (?, ?, ?, ?, 1, ?, ?)
  ON CONFLICT (source_id, k) DO UPDATE SET
    verdict = CASE WHEN (${sev('excluded.verdict')}) >= (${sev('verdict')})
                   THEN excluded.verdict ELSE verdict END,
    n = CASE WHEN n + 1 > ${N_CAP} THEN ${N_CAP} ELSE n + 1 END,
    last_at = CASE WHEN excluded.last_at > last_at THEN excluded.last_at ELSE last_at END,
    backbones = CASE
      WHEN backbones = '' OR excluded.backbones = '' THEN ''
      WHEN backbones = excluded.backbones THEN backbones
      ELSE backbones || ',' || excluded.backbones END`;

// Mirrors ScreenerStore.bulkUpsert.
const BULK = `
  INSERT INTO screener_entries (source_id, k, kind, verdict, n, last_at, backbones)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (source_id, k) DO UPDATE SET
    verdict = CASE WHEN (${sev('excluded.verdict')}) >= (${sev('verdict')})
                   THEN excluded.verdict ELSE verdict END,
    n = CASE WHEN n + excluded.n > ${N_CAP} THEN ${N_CAP} ELSE n + excluded.n END,
    last_at = CASE WHEN excluded.last_at > last_at THEN excluded.last_at ELSE last_at END,
    backbones = CASE
      WHEN backbones = '' OR excluded.backbones = '' THEN ''
      WHEN backbones = excluded.backbones THEN backbones
      ELSE backbones || ',' || excluded.backbones END`;

const JOIN = `
  SELECT e.k AS k, e.verdict AS verdict, e.backbones AS backbones, s.id AS source_id, s.trust AS trust
  FROM screener_entries e JOIN screener_sources s ON s.id = e.source_id
  WHERE e.k = ? AND s.enabled = 1 AND s.trust IN ('full', 'corroborate')`;

function rowsFor(key: string): SourceVerdict[] {
  return db
    .prepare(JOIN)
    .all(key)
    .map((r: any) => ({
      isLocal: r.source_id === 'local',
      trust: r.trust,
      verdict: r.verdict,
      backbones: r.backbones ? String(r.backbones).split(',').filter(Boolean) : [],
    }));
}

// Mirrors ScreenerStore.getEntries(..., true): raw select -> records -> the real
// dedupeRecords, so the export merge under test is the live code, not a copy.
function exportRecords(ids: string[]): ScreenerRecord[] {
  const inList = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT k, verdict, last_at, n, backbones FROM screener_entries WHERE source_id IN (${inList})`
    )
    .all(...ids);
  const records = rows
    .filter((r: any) => ['dead', 'fake', 'mislabeled'].includes(r.verdict))
    .map((r: any): ScreenerRecord => {
      const bk = r.backbones ? String(r.backbones).split(',').filter(Boolean) : [];
      return {
        k: r.k,
        v: r.verdict,
        n: Number(r.n),
        at: Number(r.last_at),
        ...(bk.length ? { bk } : {}),
      };
    });
  return dedupeRecords(records);
}

function addSrc(id: string, trust = 'corroborate'): void {
  db.prepare(
    `INSERT INTO screener_sources (id, kind, name, url, enabled, trust, refresh_hours)
     VALUES (?, 'remote', ?, ?, 1, ?, 24)`
  ).run(id, id, `https://example.test/${id}`, trust);
}

const OPTS = { quorum: 2, backboneScope: false, myBackbones: [] as string[] };

before(() => {
  db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  db.exec(screener.up.sqlite);
});
after(() => {
  db.close();
  for (const s of ['', '-wal', '-shm']) {
    try {
      rmSync(DB_PATH + s);
    } catch {
      /* ignore */
    }
  }
});
// Reset to the freshly-migrated state before each case so tests are independent
// and order-free. Entries first to respect the FK.
beforeEach(() => {
  db.exec(`DELETE FROM screener_entries; DELETE FROM screener_sources WHERE id != 'local';`);
});

describe('migration DDL', () => {
  it('seeds the local full-trust source', () => {
    const row: any = db
      .prepare(`SELECT kind, trust FROM screener_sources WHERE id = 'local'`)
      .get();
    assert.equal(row.kind, 'local');
    assert.equal(row.trust, 'full');
  });
});

describe('mark upsert (local auto-fill)', () => {
  const at = 1719705600;

  it('upgrades to the more severe verdict and bumps the count', () => {
    db.prepare(MARK).run('local', TORRENT, 'torrent', 'dead', at, '');
    db.prepare(MARK).run('local', TORRENT, 'torrent', 'fake', at, '');
    const row: any = db
      .prepare(`SELECT verdict, n FROM screener_entries WHERE source_id='local' AND k=?`)
      .get(TORRENT);
    assert.equal(row.verdict, 'fake'); // fake(3) >= dead(2)
    assert.equal(row.n, 2);
  });

  it('never downgrades an already-stronger verdict', () => {
    db.prepare(MARK).run('local', TORRENT, 'torrent', 'fake', at, '');
    db.prepare(MARK).run('local', TORRENT, 'torrent', 'dead', at, '');
    const row: any = db
      .prepare(`SELECT verdict FROM screener_entries WHERE source_id='local' AND k=?`)
      .get(TORRENT);
    assert.equal(row.verdict, 'fake'); // dead(2) < fake(3), so it stays
  });

  it('keeps a global verdict global when re-marked with a scope', () => {
    db.prepare(MARK).run('local', USENET, 'usenet', 'dead', at, ''); // global
    db.prepare(MARK).run('local', USENET, 'usenet', 'dead', at, 'news.a.com');
    const row: any = db
      .prepare(`SELECT backbones FROM screener_entries WHERE source_id='local' AND k=?`)
      .get(USENET);
    assert.equal(row.backbones, '');
  });

  it("doesn't grow backbones when an unchanged scope is re-marked", () => {
    db.prepare(MARK).run('local', USENET, 'usenet', 'dead', at, 'news.a.com');
    db.prepare(MARK).run('local', USENET, 'usenet', 'dead', at, 'news.a.com');
    const row: any = db
      .prepare(`SELECT backbones FROM screener_entries WHERE source_id='local' AND k=?`)
      .get(USENET);
    assert.equal(row.backbones, 'news.a.com');
  });

  it('a local (full) verdict filters on its own', () => {
    db.prepare(MARK).run('local', TORRENT, 'torrent', 'dead', at, '');
    const v = evaluateKey(rowsFor(TORRENT), OPTS);
    assert.equal(v.filtered, true);
    assert.equal(v.verdict, 'dead');
  });
});

describe('bulk upsert (import / remote) with severity CASE', () => {
  it('keeps the more severe verdict and sums counts on conflict', () => {
    addSrc('src_a');
    db.prepare(BULK).run('src_a', USENET, 'usenet', 'mislabeled', 1, 1719705600, '');
    db.prepare(BULK).run('src_a', USENET, 'usenet', 'dead', 2, 1719792000, '');
    const row: any = db
      .prepare(`SELECT verdict, n, last_at FROM screener_entries WHERE source_id='src_a' AND k=?`)
      .get(USENET);
    assert.equal(row.verdict, 'dead'); // dead(2) > mislabeled(1)
    assert.equal(row.n, 3); // 1 + 2
    assert.equal(row.last_at, 1719792000); // max
  });

  it('one corroborate source does not meet quorum 2', () => {
    addSrc('src_a');
    db.prepare(BULK).run('src_a', USENET, 'usenet', 'dead', 1, 1719705600, '');
    assert.equal(evaluateKey(rowsFor(USENET), OPTS).filtered, false);
  });

  it('a second corroborate source meets quorum 2', () => {
    addSrc('src_a');
    addSrc('src_b');
    db.prepare(BULK).run('src_a', USENET, 'usenet', 'dead', 1, 1719705600, '');
    db.prepare(BULK).run('src_b', USENET, 'usenet', 'dead', 1, 1719705600, '');
    assert.equal(evaluateKey(rowsFor(USENET), OPTS).filtered, true);
  });
});

describe('dedup export (mirrors getEntries JS merge)', () => {
  it('merges across sources: union backbones, sum counts, newest timestamp', () => {
    addSrc('src_a');
    addSrc('src_b');
    db.prepare(BULK).run('src_a', USENET, 'usenet', 'dead', 3, 1719792000, 'news.a.com');
    db.prepare(BULK).run('src_b', USENET, 'usenet', 'dead', 1, 1719705600, 'news.b.com');
    const recs = exportRecords(['src_a', 'src_b']);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].v, 'dead');
    assert.equal(recs[0].n, 4); // 3 + 1
    assert.equal(recs[0].at, 1719792000); // max
    assert.deepEqual(recs[0].bk, ['news.a.com', 'news.b.com']);
  });

  it('stays global when any contributing source is unscoped', () => {
    addSrc('src_a');
    addSrc('src_b');
    db.prepare(BULK).run('src_a', USENET, 'usenet', 'dead', 1, 1719705600, 'news.a.com');
    db.prepare(BULK).run('src_b', USENET, 'usenet', 'dead', 1, 1719705600, ''); // global
    const recs = exportRecords(['src_a', 'src_b']);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].bk, undefined); // empty-bk means global, and global wins
  });
});
