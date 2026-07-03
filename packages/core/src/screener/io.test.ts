import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toNdjson, toDavexNdjson, parseNdjson, dedupeRecords } from './io.js';
import type { ScreenerRecord } from './types.js';

const WD1 = 'wd1:fbaefac71441d3539764427a8111b8c7';
const BTIH = 'btih:' + 'a'.repeat(40);

const RECORDS: ScreenerRecord[] = [
  { k: WD1, v: 'dead', n: 3, at: 1719705600, bk: ['news.example.com'] },
  { k: BTIH, v: 'fake', n: 1, at: 1719705600 },
];

describe('native NDJSON round-trip', () => {
  it('writes a header then one record per line', () => {
    const text = toNdjson(RECORDS, 1719799999);
    const lines = text.trim().split('\n');
    assert.deepEqual(JSON.parse(lines[0]), { screener: 1, updated: 1719799999 });
    assert.equal(lines.length, 3);
  });

  it('parses back to the same records (skipping the header)', () => {
    const { records, invalid } = parseNdjson(toNdjson(RECORDS, 1719799999));
    assert.equal(invalid, 0);
    assert.equal(records.length, 2);
    assert.deepEqual(records[0], RECORDS[0]);
    assert.equal(records[1].k, BTIH);
    assert.equal(records[1].v, 'fake');
  });
});

describe('davex bridge', () => {
  it('exports only the dead usenet subset in davex format', () => {
    const text = toDavexNdjson(RECORDS, 1719799999);
    const lines = text.trim().split('\n');
    assert.deepEqual(JSON.parse(lines[0]), { warden: 1, updated: 1719799999 });
    // BTIH (torrent) and any non-dead are dropped; only the WD1 dead remains.
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[1]), {
      fp: WD1,
      bk: ['news.example.com'],
      deadAt: 1719705600,
      n: 3,
    });
  });

  it('imports a davex file as dead usenet verdicts', () => {
    const davex =
      JSON.stringify({ warden: 1, updated: 1719799999 }) +
      '\n' +
      JSON.stringify({ fp: WD1, bk: ['news.example.com'], deadAt: 1719705600, n: 5 }) +
      '\n';
    const { records, invalid } = parseNdjson(davex);
    assert.equal(invalid, 0);
    assert.equal(records.length, 1);
    assert.deepEqual(records[0], {
      k: WD1,
      v: 'dead',
      n: 5,
      at: 1719705600,
      bk: ['news.example.com'],
    });
  });

  it('round-trips aiostreams -> davex -> aiostreams losslessly for dead usenet', () => {
    const davex = toDavexNdjson(RECORDS, 1719799999);
    const { records } = parseNdjson(davex);
    assert.equal(records.length, 1);
    assert.deepEqual(records[0], RECORDS[0]);
  });
});

describe('parse robustness', () => {
  it('counts malformed lines as invalid but keeps good ones', () => {
    const text = [
      JSON.stringify({ screener: 1, updated: 1 }),
      JSON.stringify({ k: WD1, v: 'dead', n: 1, at: 1719705600 }),
      'not json',
      JSON.stringify({ k: 'bogus-key', v: 'dead', n: 1, at: 1 }),
      JSON.stringify({ k: BTIH, v: 'not-a-verdict', n: 1, at: 1 }),
      '# a comment',
      '',
    ].join('\n');
    const { records, invalid } = parseNdjson(text);
    assert.equal(records.length, 1);
    assert.equal(invalid, 3); // bad json, bad key, bad verdict
  });

  it('defaults a non-positive count to 1', () => {
    const { records } = parseNdjson(
      JSON.stringify({ k: BTIH, v: 'dead', n: 0, at: 5 }) + '\n'
    );
    assert.equal(records[0].n, 1);
  });

  it('trims backbones and drops blank ones on import', () => {
    const { records } = parseNdjson(
      JSON.stringify({
        k: WD1,
        v: 'dead',
        n: 1,
        at: 5,
        bk: ['  news.a.com ', '', '   ', 'news.b.com'],
      }) + '\n'
    );
    assert.deepEqual(records[0].bk, ['news.a.com', 'news.b.com']);
  });
});

describe('dedupeRecords (export merge)', () => {
  it('keeps the most severe verdict, sums counts, takes the newest timestamp', () => {
    const out = dedupeRecords([
      { k: WD1, v: 'dead', n: 2, at: 10, bk: ['a.com'] },
      { k: WD1, v: 'mislabeled', n: 3, at: 20, bk: ['b.com'] },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].v, 'dead');
    assert.equal(out[0].n, 5);
    assert.equal(out[0].at, 20);
    assert.deepEqual(out[0].bk, ['a.com', 'b.com']);
  });

  it('stays global when either side is unscoped', () => {
    const out = dedupeRecords([
      { k: WD1, v: 'dead', n: 1, at: 10, bk: ['a.com'] },
      { k: WD1, v: 'dead', n: 1, at: 10 },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].bk, undefined);
  });
});
