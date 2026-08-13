import assert from 'node:assert/strict';
import test from 'node:test';
import { withInternalTimeoutMargin } from './timeout.js';

test('keeps an explicit outer timeout when it already covers the internal budget', () => {
  assert.equal(withInternalTimeoutMargin(45_000, 30_000), 45_000);
});

test('adds response margin when an outer timeout is shorter than its internal operation', () => {
  assert.equal(withInternalTimeoutMargin(7_000, 30_000), 33_000);
  assert.equal(withInternalTimeoutMargin(undefined, 30_000), 33_000);
});
