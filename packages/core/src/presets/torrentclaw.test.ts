import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterTorrentClawPlaybackActions,
  getTorrentClawCachedStatus,
  type TorrentClawStreamShape,
} from './torrentclaw-cache.js';

const cachedStream: TorrentClawStreamShape = {
  name: '⚡️ INSTANT 1080p · Bluray',
  title: '🔵 72/100 · TB\n✅ TrueSpec Verified',
  url: 'https://example.com/play',
  behaviorHints: { notWebReady: false, filename: 'cached.mkv' },
};

const uncachedStream: TorrentClawStreamShape = {
  name: '⬇️ Download 1080p · Bluray',
  title: '🔵 64/100 · TB · ⏳ caches on play',
  externalUrl: 'https://example.com/cache',
};

const p2pStream: TorrentClawStreamShape = {
  name: '🌐 1080p · Bluray',
  title: '🟢 81/100\n✅ TrueSpec Verified',
  infoHash: '0123456789abcdef0123456789abcdef01234567',
};

test('marks observed TorrentClaw instant streams as cached', () => {
  assert.equal(getTorrentClawCachedStatus(cachedStream), true);
});

test('marks observed TorrentClaw cache-on-play actions as uncached', () => {
  assert.equal(getTorrentClawCachedStatus(uncachedStream), false);
});

test('structured cache hints take precedence when TorrentClaw supplies one', () => {
  assert.equal(
    getTorrentClawCachedStatus({
      ...cachedStream,
      behaviorHints: { ...cachedStream.behaviorHints, cached: false },
    }),
    false
  );
});

test('explicit uncached text wins over cached words', () => {
  assert.equal(
    getTorrentClawCachedStatus({
      ...uncachedStream,
      title: 'TB · cached lookup · UNCACHED · caches on play',
    }),
    false
  );
});

test('cache-on-play actions are included by default for normal AIO filtering', () => {
  assert.deepEqual(filterTorrentClawPlaybackActions([uncachedStream], {}), [
    uncachedStream,
  ]);
});

test('users can still explicitly hide TorrentClaw cache-on-play actions', () => {
  assert.deepEqual(
    filterTorrentClawPlaybackActions([uncachedStream], {
      downloadActions: false,
    }),
    []
  );
});

test('keeps standard Stremio info-hash streams as playable uncached P2P results', () => {
  assert.equal(getTorrentClawCachedStatus(p2pStream), false);
  assert.deepEqual(
    filterTorrentClawPlaybackActions([p2pStream], {
      downloadActions: false,
    }),
    [p2pStream]
  );
});
