import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { streamReleaseKey } from './stream-key.js';

const HASH = 'a'.repeat(40);
const WD1 = 'wd1:fbaefac71441d3539764427a8111b8c7';

describe('streamReleaseKey', () => {
  it('derives a btih key from a torrent infohash', () => {
    assert.equal(
      streamReleaseKey({ type: 'debrid', torrent: { infoHash: HASH.toUpperCase() } }),
      `btih:${HASH}`
    );
  });

  it('uses a precomputed usenet key', () => {
    assert.equal(
      streamReleaseKey({ type: 'usenet', screenerKey: WD1 }),
      WD1
    );
  });

  it('prefers the infohash when both are present', () => {
    assert.equal(
      streamReleaseKey({ torrent: { infoHash: HASH }, screenerKey: WD1 }),
      `btih:${HASH}`
    );
  });

  it('returns null when nothing identifies the release', () => {
    assert.equal(streamReleaseKey({ type: 'usenet' }), null);
    assert.equal(streamReleaseKey({ type: 'http', torrent: null }), null);
    assert.equal(streamReleaseKey({ screenerKey: 'not-a-key' }), null);
    // A usenet stream must not adopt a torrent (btih) key via screenerKey.
    assert.equal(
      streamReleaseKey({ type: 'usenet', screenerKey: `btih:${HASH}` }),
      null
    );
  });
});
