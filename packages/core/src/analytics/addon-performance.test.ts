import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import test from 'node:test';
import { SqliteDriver } from '../db/driver/sqlite.js';
import { addonPerformance } from '../db/migrations/900005_addon_performance.js';

test('stores compact addon performance rollups without request identity', async () => {
  const filename = `.addon-performance-${process.pid}.sqlite`;
  const db = new SqliteDriver(filename);
  try {
    for (const statement of addonPerformance.up.sqlite
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)) {
      await db.exec(statement);
    }
    await db.exec(
      `INSERT INTO addon_performance_entities
          (preset_id, instance_hash, addon_name)
          VALUES ('test-addon', 'one-way-instance-hash', 'Test Addon')`
    );
    const entity = await db.query<{ id: number }>(
      `SELECT id FROM addon_performance_entities LIMIT 1`
    );
    await db.exec(
      `INSERT INTO addon_performance_daily
          (day, addon_id, requests, with_results, merged, raw_sum, final_sum,
           latency_sum, latency_count, sized_streams, size_sum_bytes,
           max_size_bytes, top_rank_wins, largest_source_wins,
           cached_streams, uncached_streams, usenet_streams)
          VALUES ('2026-08-08', ?, 1, 1, 1, 4, 2, 120, 1,
                  2, 3000, 2000, 1, 1, 1, 1, 1)`,
      [entity[0]!.id]
    );

    const entities = await db.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM addon_performance_entities`
    );
    const daily = await db.query<{
      requests: number;
      final_sum: number;
      size_sum_bytes: number;
      max_size_bytes: number;
    }>(
      `SELECT requests, final_sum, size_sum_bytes, max_size_bytes
       FROM addon_performance_daily`
    );
    assert.equal(Number(entities[0]?.count), 1);
    assert.deepEqual(
      daily.map((row) => ({
        requests: Number(row.requests),
        final: Number(row.final_sum),
        sizeSum: Number(row.size_sum_bytes),
        maxSize: Number(row.max_size_bytes),
      })),
      [{ requests: 1, final: 2, sizeSum: 3_000, maxSize: 2_000 }]
    );

    const columns = await db.query<{ name: string }>(
      `PRAGMA table_info(addon_performance_daily)`
    );
    const names = new Set(columns.map((column) => column.name));
    assert.equal(names.has('uuid_hash'), false);
    assert.equal(names.has('media_id'), false);
    assert.equal(names.has('url'), false);
  } finally {
    await db.close();
    await Promise.all(
      ['', '-wal', '-shm'].map((suffix) =>
        rm(`${filename}${suffix}`, { force: true })
      )
    );
  }
});
