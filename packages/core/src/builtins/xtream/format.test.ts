import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { orderFormats } from './format.js';

describe('orderFormats', () => {
  const both = ['ts', 'm3u8'];
  it('puts the preferred format first and keeps the other', () => {
    assert.deepEqual(orderFormats(both, 'hls-first'), ['m3u8', 'ts']);
    assert.deepEqual(orderFormats(both, 'ts-first'), ['ts', 'm3u8']);
  });
  it('offers only the chosen format when asked to', () => {
    assert.deepEqual(orderFormats(both, 'hls'), ['m3u8']);
    assert.deepEqual(orderFormats(both, 'ts'), ['ts']);
  });
  it('falls back to what the account allows', () => {
    assert.deepEqual(orderFormats(['ts'], 'hls'), ['ts']);
    assert.deepEqual(orderFormats(['m3u8'], 'ts-first'), ['m3u8']);
  });
});
