import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Use the normal core entry point to initialise the logging/db dependency graph.
import '../../index.js';
import { closeDb, initDb } from '../db.js';
import {
  scopeWhere,
  UsenetIndexerMetricsRepository,
} from './usenet-indexer-metrics.js';

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

describe('distinctIndexers', () => {
  let dir: string;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'aiostreams-indexer-metrics-'));
    await initDb(`sqlite://${join(dir, 'test.sqlite')}`);
  });

  after(async () => {
    await closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it('includes a label that only has a last error', async () => {
    // Rollups can be pruned while the last-error row survives, and a reset of
    // the merged group still has to reach that label.
    await UsenetIndexerMetricsRepository.record({
      indexer: 'DrunkenSlug',
      ok: 1,
    });
    await UsenetIndexerMetricsRepository.setLastError('DS', {
      message: 'boom',
    });

    const labels = await UsenetIndexerMetricsRepository.distinctIndexers();
    assert.deepEqual([...labels].sort(), ['DS', 'DrunkenSlug']);
  });

  it('returns each label once when it appears in both tables', async () => {
    await UsenetIndexerMetricsRepository.record({
      indexer: 'NZBGeek',
      failed: 1,
    });
    await UsenetIndexerMetricsRepository.setLastError('NZBGeek', {
      message: 'boom',
    });

    const labels = await UsenetIndexerMetricsRepository.distinctIndexers();
    assert.equal(labels.filter((l) => l === 'NZBGeek').length, 1);
  });
});
