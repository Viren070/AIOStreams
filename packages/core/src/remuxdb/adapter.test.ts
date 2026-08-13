import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import type { ParsedStream } from '../db/schemas.js';
import { extractNzbGuid, matchEntry, toWireMediaInfo } from './adapter.js';
import type { MediaProbeVersion, TrackDetail } from './client.js';

function track(overrides: Partial<TrackDetail> = {}): TrackDetail {
  return {
    kind: 'video',
    idx: 0,
    is_default: true,
    is_forced: false,
    is_hearing_impaired: false,
    is_external: false,
    is_anamorphic: false,
    hdr10_plus_present: false,
    ...overrides,
  };
}

function version(
  overrides: Partial<MediaProbeVersion> = {}
): MediaProbeVersion {
  return { sources: [], tracks: [], ...overrides };
}

function stream(overrides: Partial<ParsedStream> = {}): ParsedStream {
  return { id: 's1', type: 'debrid', ...overrides } as ParsedStream;
}

describe('matchEntry', () => {
  test('matches by torrent hash + fileIdx', () => {
    const v = version({
      sources: [
        { kind: 'torrent', torrent_info_hash: 'abc', torrent_file_idx: 1 },
      ],
    });
    const s = stream({ torrent: { infoHash: 'ABC', fileIdx: 1 } });
    assert.equal(matchEntry([v], s), v);
  });

  test('season-pack fileIdx mismatch does not match', () => {
    const v = version({
      sources: [
        { kind: 'torrent', torrent_info_hash: 'abc', torrent_file_idx: 1 },
      ],
    });
    const s = stream({ torrent: { infoHash: 'abc', fileIdx: 2 } });
    assert.equal(matchEntry([v], s), undefined);
  });

  test('matches nzb by id query param', () => {
    const v = version({
      sources: [{ kind: 'nzb', indexer_guid: 'guid123' }],
    });
    const s = stream({
      nzbUrl: 'https://indexer.example/api?t=get&id=guid123&apikey=x',
    });
    assert.equal(matchEntry([v], s), v);
  });

  test('matches hex guid embedded in path', () => {
    const guid = '1abc9603eb172f3e63ca5970f6518dd9';
    const v = version({
      sources: [{ kind: 'nzb', indexer_guid: guid }],
    });
    const s = stream({
      nzbUrl: `https://indexer.example/getnzb/${guid}.nzb&i=136164&r=key`,
    });
    assert.equal(matchEntry([v], s), v);
  });

  test('falls back to bare guid when nzbUrl is not a URL', () => {
    const v = version({
      sources: [{ kind: 'nzb', indexer_guid: 'raw-guid' }],
    });
    const s = stream({ nzbUrl: 'raw-guid' });
    assert.equal(matchEntry([v], s), v);
  });

  test('no identity fields yields no match', () => {
    const v = version({
      sources: [{ kind: 'torrent', torrent_info_hash: 'abc' }],
    });
    assert.equal(matchEntry([v], stream()), undefined);
  });
});

describe('extractNzbGuid', () => {
  test('id query param', () => {
    assert.equal(
      extractNzbGuid('https://indexer.example/api?t=get&id=guid123&apikey=x'),
      'guid123'
    );
  });

  test('guid in path, no query separator before the trailing params', () => {
    const guid = '1abc9603eb172f3e63ca5970f6518dd9';
    assert.equal(
      extractNzbGuid(
        `https://indexer.example/getnzb/${guid}.nzb&i=136164&r=key`
      ),
      guid
    );
  });

  test('guid in path, followed by a query string', () => {
    const guid = '29774b14147f37e383534f7d6e158575';
    assert.equal(
      extractNzbGuid(`https://indexer.example/getnzb/${guid}?r=key`),
      guid
    );
  });

  test('bare guid (not a URL)', () => {
    assert.equal(extractNzbGuid('raw-guid'), 'raw-guid');
  });
});

describe('toWireMediaInfo', () => {
  test('derives dv over hdr10+ and color_transfer', () => {
    const v = version({
      tracks: [
        track({
          dv_profile: 5,
          hdr10_plus_present: true,
          color_transfer: 'smpte2084',
        }),
      ],
    });
    assert.deepEqual(toWireMediaInfo(v).video?.hdr, ['dv']);
  });

  test('derives hdr10+ when no dv profile', () => {
    const v = version({ tracks: [track({ hdr10_plus_present: true })] });
    assert.deepEqual(toWireMediaInfo(v).video?.hdr, ['hdr10+']);
  });

  test('derives hdr10 from color_transfer smpte2084', () => {
    const v = version({ tracks: [track({ color_transfer: 'smpte2084' })] });
    assert.deepEqual(toWireMediaInfo(v).video?.hdr, ['hdr10']);
  });

  test('derives hlg from color_transfer arib-std-b67', () => {
    const v = version({ tracks: [track({ color_transfer: 'arib-std-b67' })] });
    assert.deepEqual(toWireMediaInfo(v).video?.hdr, ['hlg']);
  });

  test('no hdr tags when nothing indicates hdr', () => {
    const v = version({ tracks: [track()] });
    assert.deepEqual(toWireMediaInfo(v).video?.hdr, []);
  });

  test('maps audio and subtitle tracks', () => {
    const v = version({
      tracks: [
        track({
          kind: 'audio',
          language: 'eng',
          channels: 6,
          channel_layout: '5.1',
          codec: 'eac3',
        }),
        track({ kind: 'subtitle', language: 'fre', title: 'French' }),
      ],
    });
    const wire = toWireMediaInfo(v);
    assert.equal(wire.audio?.length, 1);
    assert.deepEqual(wire.audio?.[0], {
      codec: 'eac3',
      profile: undefined,
      lang: 'eng',
      title: undefined,
      ch_layout: '5.1',
      ch: 6,
    });
    assert.deepEqual(wire.subtitle?.[0], { lang: 'fre', title: 'French' });
  });

  test('converts duration from seconds to nanoseconds', () => {
    const v = version({ duration: 120, size: 1000, bitrate: 500 });
    const wire = toWireMediaInfo(v);
    assert.equal(wire.format?.dur, 120 * 1_000_000_000);
    assert.equal(wire.format?.s, 1000);
    assert.equal(wire.format?.br, 500);
  });

  test('has_chapters reflects chapters length', () => {
    assert.equal(toWireMediaInfo(version()).has_chapters, false);
    assert.equal(
      toWireMediaInfo(version({ chapters: [{}] })).has_chapters,
      true
    );
  });
});
