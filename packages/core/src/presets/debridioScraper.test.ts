import assert from 'node:assert/strict';
import test from 'node:test';

import type { Stream } from '../db/index.js';
import {
  extractDebridioInfoHash,
  toDebridioP2PStream,
} from './debridio-p2p.js';

const infoHash = '0123456789abcdef0123456789abcdef01234567';

const supportedProviders = [
  'realdebrid',
  'alldebrid',
  'debridlink',
  'easydebrid',
  'premiumize',
  'pikpak',
  'offcloud',
  'debrider',
  'torbox',
] as const;

test('extracts an info hash from every supported Debridio provider shape', () => {
  for (const provider of supportedProviders) {
    const stream = {
      url: `https://debridio.com/${provider}/stream/${infoHash}/video.mkv`,
    } as Stream;
    assert.equal(
      extractDebridioInfoHash(stream),
      infoHash,
      `provider ${provider} should expose a 40-character info hash`
    );
    const converted = toDebridioP2PStream(stream);
    assert.equal(converted.infoHash, infoHash);
    assert.equal(converted.url, undefined);
  }
});

test('rejects malformed or non-Debridio hashes', () => {
  assert.equal(
    extractDebridioInfoHash({
      url: 'https://debridio.com/stream/not-a-hash/video.mkv',
    } as Stream),
    undefined
  );
  assert.equal(
    extractDebridioInfoHash({
      url: `https://example.com/stream/${infoHash}/video.mkv`,
    } as Stream),
    undefined
  );
});
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
