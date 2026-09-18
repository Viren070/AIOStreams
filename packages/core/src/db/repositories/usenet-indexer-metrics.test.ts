import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// Use the normal core entry point to initialise the logging/db dependency graph.
import '../../index.js';
import { scopeWhere } from './usenet-indexer-metrics.js';

describe('scopeWhere', () => {
  it('matches every row for an empty scope', () => {
    const f = scopeWhere({});
    assert.equal(f.text, '1 = 1');
    assert.deepEqual(f.params, []);
  });

  it('matches NOTHING for an empty indexer list', () => {
    // The guard that keeps "reset this indexer" from becoming "reset
    // everything" when a merged row expands to no members. If this ever
    // renders `1 = 1`, a one-row eraser silently wipes the table.
    const f = scopeWhere({ indexers: [] });
    assert.equal(f.text, '1 = 0');
    assert.deepEqual(f.params, []);
  });

  it('still matches nothing when an empty list is combined with a window', () => {
    const f = scopeWhere({ indexers: [], sinceMs: 1, untilMs: 2 });
    assert.equal(f.text, '1 = 0');
    assert.deepEqual(f.params, []);
  });

  it('parameterises an indexer list in order', () => {
    const f = scopeWhere({ indexers: ['DS', 'Drunken Slug', 'DrunkenSlug'] });
    assert.equal(f.text, 'indexer IN (?, ?, ?)');
    assert.deepEqual(f.params, ['DS', 'Drunken Slug', 'DrunkenSlug']);
  });

  it('keeps params aligned when a list is combined with a window', () => {
    const f = scopeWhere({ indexers: ['a', 'b'], sinceMs: 10, untilMs: 20 });
    assert.equal(f.text, 'indexer IN (?, ?) AND hour_ms >= ? AND hour_ms < ?');
    assert.deepEqual(f.params, ['a', 'b', 10, 20]);
  });

  it('leaves the single-indexer scope exactly as it was', () => {
    const f = scopeWhere({ indexer: 'DrunkenSlug', sinceMs: 1, untilMs: 2 });
    assert.equal(f.text, 'indexer = ? AND hour_ms >= ? AND hour_ms < ?');
    assert.deepEqual(f.params, ['DrunkenSlug', 1, 2]);
  });
});
