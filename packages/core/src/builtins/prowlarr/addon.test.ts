import assert from 'node:assert/strict';
import test from 'node:test';
import { collectProwlarrResultsUntilDeadline } from './deadline.js';

test('returns completed Prowlarr query results without waiting for a slow alias', async () => {
  let releaseSlow: (() => void) | undefined;
  const slow = new Promise<number[]>((resolve) => {
    releaseSlow = () => resolve([3]);
  });
  const errors: unknown[] = [];

  const results = await collectProwlarrResultsUntilDeadline(
    [Promise.resolve([1, 2]), slow],
    10,
    (error) => errors.push(error)
  );

  assert.deepEqual(results, [1, 2]);
  assert.deepEqual(errors, []);
  releaseSlow?.();
});

test('keeps successful Prowlarr results when another query fails', async () => {
  const errors: unknown[] = [];
  const results = await collectProwlarrResultsUntilDeadline(
    [Promise.resolve([1]), Promise.reject(new Error('query failed'))],
    1_000,
    (error) => errors.push(error)
  );

  assert.deepEqual(results, [1]);
  assert.equal(errors.length, 1);
});
