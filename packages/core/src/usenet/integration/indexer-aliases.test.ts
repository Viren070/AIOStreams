import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// Use the normal core entry point to initialise the logging/db dependency graph.
import '../../index.js';
import type { UsenetIndexerRollup } from '../../db/index.js';
import {
  buildIndexerAliasIndex,
  foldIndexerErrors,
  foldIndexerRollups,
} from './indexer-aliases.js';

function rollup(
  indexer: string,
  p: Partial<UsenetIndexerRollup> = {}
): UsenetIndexerRollup {
  const ok = p.ok ?? 0;
  const degraded = p.degraded ?? 0;
  const failed = p.failed ?? 0;
  return {
    indexer,
    grabs: ok + degraded + failed,
    ok,
    degraded,
    failed,
    failedMissing: p.failedMissing ?? 0,
    failedFetch: p.failedFetch ?? 0,
    fetchAuth: p.fetchAuth ?? 0,
    fetchLimited: p.fetchLimited ?? 0,
    sumGrabMs: p.sumGrabMs ?? 0,
    grabSamples: p.grabSamples ?? 0,
    sumImportMs: p.sumImportMs ?? 0,
    importSamples: p.importSamples ?? 0,
  };
}

const byName = (rows: { indexer: string }[]) =>
  rows.map((r) => r.indexer).sort();

describe('buildIndexerAliasIndex', () => {
  it('leaves labels untouched when there are no rules', () => {
    const index = buildIndexerAliasIndex({});
    assert.equal(index.empty, true);
    assert.equal(index.canonicalOf('NZBgeek'), 'NZBgeek');
  });

  it('matches a rule key regardless of the recorded casing', () => {
    const index = buildIndexerAliasIndex({ 'drunkenslug.com': 'DrunkenSlug' });
    assert.equal(index.canonicalOf('DrunkenSlug.com'), 'DrunkenSlug');
    assert.equal(index.canonicalOf('  drunkenslug.com  '), 'DrunkenSlug');
  });

  it('does not group case variants that no rule names', () => {
    const index = buildIndexerAliasIndex({ Ds: 'DrunkenSlug' });
    assert.equal(index.canonicalOf('NZBgeek'), 'NZBgeek');
    assert.equal(index.canonicalOf('NZBGeek'), 'NZBGeek');
  });

  it('follows a multi-hop chain to a single canonical', () => {
    const index = buildIndexerAliasIndex({
      Ds: 'DrunkenSlug',
      DrunkenSlug: 'Drunken Slug',
    });
    assert.equal(index.canonicalOf('Ds'), 'Drunken Slug');
    assert.equal(index.canonicalOf('DrunkenSlug'), 'Drunken Slug');
  });

  it('ignores contradictory rules rather than half-applying them', () => {
    // Half-applying `A -> B` / `B -> A` would swap the two groups and make the
    // eraser expand a merged row to the wrong members.
    const index = buildIndexerAliasIndex({ A: 'B', B: 'A' });
    assert.equal(index.empty, true);
    assert.equal(index.canonicalOf('A'), 'A');
    assert.equal(index.canonicalOf('B'), 'B');
  });

  it('ignores a cycle that does not run through the first rule', () => {
    const index = buildIndexerAliasIndex({ A: 'B', B: 'C', C: 'B' });
    assert.equal(index.canonicalOf('A'), 'A');
    assert.equal(index.canonicalOf('B'), 'B');
    assert.equal(index.canonicalOf('C'), 'C');
  });

  it('keeps unrelated rules working when one rule set is contradictory', () => {
    const index = buildIndexerAliasIndex({ A: 'B', B: 'A', DS: 'DrunkenSlug' });
    assert.equal(index.canonicalOf('A'), 'A');
    assert.equal(index.canonicalOf('DS'), 'DrunkenSlug');
  });

  it('drops exact no-op rules and rules touching the Manual sentinel', () => {
    const index = buildIndexerAliasIndex({
      NZBgeek: 'NZBgeek',
      Manual: 'DrunkenSlug',
      Ds: 'Manual',
    });
    assert.equal(index.empty, true);
    assert.equal(index.canonicalOf('Manual'), 'Manual');
  });

  it('treats a case-only rule as a respelling that merges both spellings', () => {
    const index = buildIndexerAliasIndex({ 'nzb.life': 'Nzb.life' });
    assert.equal(index.canonicalOf('nzb.life'), 'Nzb.life');
    assert.equal(index.canonicalOf('Nzb.life'), 'Nzb.life');
  });

  it('ignores a key given two different targets, whichever was typed first', () => {
    // Keys match case-insensitively, so these are one rule with two answers.
    // Honouring either would make the result depend on object key order.
    for (const map of [
      { DS: 'Alpha', ds: 'Beta' },
      { ds: 'Beta', DS: 'Alpha' },
    ]) {
      const index = buildIndexerAliasIndex(map);
      assert.equal(index.empty, true);
      assert.equal(index.canonicalOf('DS'), 'DS');
    }
  });

  it('keeps a key repeated with the same target', () => {
    const index = buildIndexerAliasIndex({
      DS: 'DrunkenSlug',
      ds: 'DrunkenSlug',
    });
    assert.equal(index.canonicalOf('Ds'), 'DrunkenSlug');
  });

  it('ignores blank keys and values', () => {
    const index = buildIndexerAliasIndex({ '  ': 'DrunkenSlug', Ds: '   ' });
    assert.equal(index.empty, true);
  });
});

describe('foldIndexerRollups', () => {
  it('passes rows through untouched when no rules exist', () => {
    const rows = [rollup('NZBgeek', { ok: 3 }), rollup('NZBGeek', { ok: 2 })];
    const folded = foldIndexerRollups(rows, buildIndexerAliasIndex({}));
    assert.deepEqual(byName(folded), ['NZBGeek', 'NZBgeek']);
    assert.deepEqual(folded[0].members, ['NZBgeek']);
  });

  it('sums every stored counter across the merged spellings', () => {
    const rows = [
      rollup('Drunken Slug', {
        ok: 5,
        degraded: 1,
        failed: 13,
        failedFetch: 9,
        fetchAuth: 2,
      }),
      rollup('DrunkenSlug', {
        ok: 3,
        failed: 16,
        failedFetch: 4,
        fetchLimited: 1,
      }),
      rollup('DS', { ok: 2, failed: 4, failedMissing: 3 }),
    ];
    const index = buildIndexerAliasIndex({
      'Drunken Slug': 'DrunkenSlug',
      DS: 'DrunkenSlug',
    });
    const folded = foldIndexerRollups(rows, index);

    assert.equal(folded.length, 1);
    const g = folded[0];
    assert.equal(g.indexer, 'DrunkenSlug');
    assert.equal(g.ok, 10);
    assert.equal(g.degraded, 1);
    assert.equal(g.failed, 33);
    assert.equal(g.grabs, 44);
    assert.equal(g.failedMissing, 3);
    assert.equal(g.failedFetch, 13);
    assert.equal(g.fetchAuth, 2);
    assert.equal(g.fetchLimited, 1);
  });

  it('keeps the subset invariants the UI subtracts with', () => {
    const rows = [
      rollup('a', {
        failed: 10,
        failedMissing: 4,
        failedFetch: 5,
        fetchAuth: 3,
        fetchLimited: 1,
      }),
      rollup('b', {
        failed: 6,
        failedMissing: 2,
        failedFetch: 3,
        fetchAuth: 1,
        fetchLimited: 2,
      }),
    ];
    const g = foldIndexerRollups(rows, buildIndexerAliasIndex({ b: 'a' }))[0];
    assert.ok(g.failedMissing + g.failedFetch <= g.failed);
    assert.ok(g.fetchAuth + g.fetchLimited <= g.failedFetch);
  });

  it('recombines means from sums and samples, not from per-row averages', () => {
    // 'fast' timed 10 grabs at 100ms; 'slow' timed 1 at 1000ms. Weighting by
    // grabs (11 and 20) rather than samples would skew the mean badly.
    const rows = [
      rollup('fast', { ok: 10, failed: 1, sumGrabMs: 1000, grabSamples: 10 }),
      rollup('slow', { ok: 1, failed: 19, sumGrabMs: 1000, grabSamples: 1 }),
    ];
    const g = foldIndexerRollups(
      rows,
      buildIndexerAliasIndex({ slow: 'fast' })
    )[0];
    assert.equal(g.sumGrabMs, 2000);
    assert.equal(g.grabSamples, 11);
    assert.equal(Math.round(g.sumGrabMs / g.grabSamples), 182);
    // The grabs-weighted answer would have been 2000/31 = 65 — the trap.
    assert.notEqual(Math.round(g.sumGrabMs / g.grabs), 182);
  });

  it('leaves the overall grab total unchanged, so shares still sum to 1', () => {
    const rows = [
      rollup('Nzb.life', { ok: 13, failed: 8 }),
      rollup('nzb.life', { ok: 8, failed: 10 }),
      rollup('NZB.su', { ok: 21, failed: 1 }),
    ];
    const before = rows.reduce((s, r) => s + r.grabs, 0);
    const folded = foldIndexerRollups(
      rows,
      buildIndexerAliasIndex({ 'nzb.life': 'Nzb.life' })
    );
    const after = folded.reduce((s, r) => s + r.grabs, 0);
    assert.equal(after, before);
    assert.equal(folded.length, 2);
    const shares = folded.map((r) => r.grabs / after);
    assert.equal(Math.round(shares.reduce((a, b) => a + b, 0) * 1e6) / 1e6, 1);
  });

  it('never merges two indexers that no rule connects', () => {
    const rows = [rollup('NZB.su', { ok: 22 }), rollup('nzb.life', { ok: 18 })];
    const folded = foldIndexerRollups(
      rows,
      buildIndexerAliasIndex({ 'Nzb.life': 'nzb.life' })
    );
    assert.deepEqual(byName(folded), ['NZB.su', 'nzb.life']);
  });

  it('lists the merged spellings, most grabs first', () => {
    const rows = [
      rollup('DS', { ok: 6 }),
      rollup('DrunkenSlug', { ok: 19 }),
      rollup('Drunken Slug', { ok: 12 }),
    ];
    const g = foldIndexerRollups(
      rows,
      buildIndexerAliasIndex({
        DS: 'DrunkenSlug',
        'Drunken Slug': 'DrunkenSlug',
      })
    )[0];
    assert.deepEqual(g.members, ['DrunkenSlug', 'Drunken Slug', 'DS']);
  });

  it('does not mutate the rows it was given', () => {
    const rows = [rollup('a', { ok: 2 }), rollup('b', { ok: 3 })];
    foldIndexerRollups(rows, buildIndexerAliasIndex({ b: 'a' }));
    assert.equal(rows[0].ok, 2);
    assert.equal(rows[0].indexer, 'a');
  });
});

describe('foldIndexerErrors', () => {
  it('keeps the most recent error across the merged spellings', () => {
    const errors = [
      { indexer: 'DrunkenSlug', message: 'old', atMs: 1000 },
      { indexer: 'DS', message: 'newest', atMs: 3000 },
      { indexer: 'Drunken Slug', message: 'middle', atMs: 2000 },
    ];
    const index = buildIndexerAliasIndex({
      DS: 'DrunkenSlug',
      'Drunken Slug': 'DrunkenSlug',
    });
    const folded = foldIndexerErrors(errors, index);
    assert.equal(folded.size, 1);
    assert.equal(folded.get('DrunkenSlug')?.message, 'newest');
  });

  it('keys unmapped indexers by their own label', () => {
    const folded = foldIndexerErrors(
      [{ indexer: 'NZB.su', message: 'boom', atMs: 1 }],
      buildIndexerAliasIndex({})
    );
    assert.equal(folded.get('NZB.su')?.message, 'boom');
  });
});
