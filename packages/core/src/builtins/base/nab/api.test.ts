import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../../torznab/addon.js';
import { extractTorznabInfoHash, TorznabSearchResultItem } from './api.js';

const VALID_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function makeResult(overrides: {
  infohash?: string;
  magneturl?: string;
  enclosure?: { url: string; type: string }[];
}): TorznabSearchResultItem {
  return {
    title: 'Test.Release.1080p',
    link: undefined,
    guid: 'guid-1',
    pubDate: new Date().toUTCString(),
    prowlarrindexer: undefined,
    jackettindexer: undefined,
    type: undefined,
    size: undefined,
    enclosure: (overrides.enclosure ?? []).map((e) => ({
      url: e.url,
      type: e.type,
      length: 0,
    })),
    torznab: {
      infohash: overrides.infohash,
      magneturl: overrides.magneturl,
    },
  };
}

describe('extractTorznabInfoHash', () => {
  it('returns a valid infohash attr directly', () => {
    const result = makeResult({ infohash: VALID_HASH });
    assert.equal(extractTorznabInfoHash(result), VALID_HASH);
  });

  it('lowercases an uppercase infohash', () => {
    const result = makeResult({ infohash: VALID_HASH.toUpperCase() });
    assert.equal(extractTorznabInfoHash(result), VALID_HASH);
  });

  it('falls back to magneturl when infohash is present but invalid', () => {
    const result = makeResult({
      infohash: 'not-a-real-hash',
      magneturl: `magnet:?xt=urn:btih:${VALID_HASH}&dn=test`,
    });
    assert.equal(extractTorznabInfoHash(result), VALID_HASH);
  });

  it('falls back to a magnet enclosure when infohash and magneturl are both absent', () => {
    const result = makeResult({
      enclosure: [
        {
          url: `magnet:?xt=urn:btih:${VALID_HASH}&dn=test`,
          type: 'application/x-bittorrent',
        },
      ],
    });
    assert.equal(extractTorznabInfoHash(result), VALID_HASH);
  });

  it('accepts the magnet-specific enclosure type from the torznab torrent-support spec', () => {
    const result = makeResult({
      enclosure: [
        {
          url: `magnet:?xt=urn:btih:${VALID_HASH}&dn=test`,
          type: 'application/x-bittorrent;x-scheme-handler/magnet',
        },
      ],
    });
    assert.equal(extractTorznabInfoHash(result), VALID_HASH);
  });

  it('uses a later magnet enclosure when the first hash is invalid', () => {
    const result = makeResult({
      enclosure: [
        {
          url: 'magnet:?xt=urn:btih:not-a-real-hash',
          type: 'application/x-bittorrent',
        },
        {
          url: `magnet:?xt=urn:btih:${VALID_HASH}&dn=test`,
          type: 'application/x-bittorrent',
        },
      ],
    });
    assert.equal(extractTorznabInfoHash(result), VALID_HASH);
  });

  it('ignores a non-magnet .torrent enclosure', () => {
    const result = makeResult({
      enclosure: [
        {
          url: 'https://example.com/download.torrent',
          type: 'application/x-bittorrent',
        },
      ],
    });
    assert.equal(extractTorznabInfoHash(result), undefined);
  });

  it('returns undefined when nothing usable is present', () => {
    assert.equal(extractTorznabInfoHash(makeResult({})), undefined);
  });
});
