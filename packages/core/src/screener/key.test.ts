import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  torrentKey,
  usenetKey,
  keyKind,
  isValidKey,
  parseKey,
} from './key.js';

const HASH40 = 'abcdef0123456789abcdef0123456789abcdef01';
const HASH64 = 'a'.repeat(64);

describe('torrentKey', () => {
  it('lowercases and prefixes a v1 infohash', () => {
    assert.equal(torrentKey(HASH40.toUpperCase()), `btih:${HASH40}`);
    assert.equal(torrentKey(`  ${HASH40}  `), `btih:${HASH40}`);
  });

  it('accepts a v2 (64-hex) infohash', () => {
    assert.equal(torrentKey(HASH64), `btih:${HASH64}`);
  });

  it('rejects non-hex / wrong-length / empty', () => {
    assert.equal(torrentKey('not-a-hash'), null);
    assert.equal(torrentKey('abc'), null);
    assert.equal(torrentKey(''), null);
    assert.equal(torrentKey(null), null);
  });
});

describe('usenetKey', () => {
  it('delegates to the wd1 fingerprint', () => {
    assert.equal(
      usenetKey(1073741824, 'a@b.com', 1719705600),
      'wd1:fbaefac71441d3539764427a8111b8c7'
    );
  });

  it('returns null for non-identifying input', () => {
    assert.equal(usenetKey(0, 'a@b.com', 1719705600), null);
  });
});

describe('keyKind / isValidKey / parseKey', () => {
  it('classifies torrent and usenet keys by prefix', () => {
    assert.equal(keyKind(`btih:${HASH40}`), 'torrent');
    assert.equal(keyKind('wd1:fbaefac71441d3539764427a8111b8c7'), 'usenet');
  });

  it('rejects malformed keys', () => {
    assert.equal(keyKind('btih:xyz'), null);
    assert.equal(keyKind('wd1:nothex'), null);
    assert.equal(keyKind('plain'), null);
    assert.equal(keyKind(null), null);
    assert.ok(!isValidKey('btih:short'));
  });

  it('parseKey strips the btih prefix but keeps the wd1 key whole', () => {
    assert.deepEqual(parseKey(`btih:${HASH40}`), {
      kind: 'torrent',
      id: HASH40,
    });
    assert.deepEqual(parseKey('wd1:fbaefac71441d3539764427a8111b8c7'), {
      kind: 'usenet',
      id: 'wd1:fbaefac71441d3539764427a8111b8c7',
    });
    assert.equal(parseKey('garbage'), null);
  });
});
