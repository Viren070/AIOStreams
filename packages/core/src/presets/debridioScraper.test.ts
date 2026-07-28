import assert from 'node:assert/strict';
import test from 'node:test';

import type { Stream } from '../db/index.js';
import { toDebridioP2PStream } from './debridio-p2p.js';

const infoHash = '0123456789abcdef0123456789abcdef01234567';
test('converts Debridio playback URLs into explicit P2P streams', () => {
  const stream = toDebridioP2PStream({
    name: '[RD] Example',
    url: `https://debridio.com/stream/${infoHash}/video.mkv`,
  } as Stream);

  assert.equal(stream.url, undefined);
  assert.equal(stream.infoHash, infoHash);
  assert.match(stream.name || '', /^\[P2P WARNING\]/);
});

test('does not convert non-Debridio URLs into P2P streams', () => {
  const original = {
    name: 'External result',
    url: `https://example.com/stream/${infoHash}/video.mkv`,
  } as Stream;

  const stream = toDebridioP2PStream(original);

  assert.deepEqual(stream, original);
});
