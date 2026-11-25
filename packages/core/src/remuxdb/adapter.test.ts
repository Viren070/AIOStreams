import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import type { ParsedStream } from '../db/schemas.js';
import {
  extractNzbGuid,
  matchEntry,
  nzbIndexerGuid,
  remuxDbHostMap,
  resolveRemuxDbIndexer,
  toWireMediaInfo,
} from './adapter.js';
import { MediaProbeVersionSchema } from './client.js';
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
  return { sources: [], tracks: [], has_chapters: false, ...overrides };
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
      sources: [{ kind: 'nzb', indexer: 'nzbnest', indexer_guid: 'guid123' }],
    });
    const s = stream({
      nzbUrl: 'https://nzbnest.com/api?t=get&id=guid123&apikey=x',
    });
    assert.equal(matchEntry([v], s), v);
  });

  test('matches hex guid embedded in path', () => {
    const guid = '1abc9603eb172f3e63ca5970f6518dd9';
    const v = version({
      sources: [{ kind: 'nzb', indexer: 'nzbnest', indexer_guid: guid }],
    });
    const s = stream({
      nzbUrl: `https://nzbnest.com/getnzb/${guid}.nzb&i=136164&r=key`,
    });
    assert.equal(matchEntry([v], s), v);
  });

  test('does not match when the indexer differs', () => {
    const v = version({
      sources: [{ kind: 'nzb', indexer: 'althub', indexer_guid: 'guid123' }],
    });
    const s = stream({
      nzbUrl: 'https://nzbnest.com/api?t=get&id=guid123&apikey=x',
    });
    assert.equal(matchEntry([v], s), undefined);
  });

  test('does not match when the indexer cannot be resolved', () => {
    const v = version({
      sources: [{ kind: 'nzb', indexer: 'nzbnest', indexer_guid: 'guid123' }],
    });
    const s = stream({
      nzbUrl: 'https://unknown-indexer.example/api?t=get&id=guid123&apikey=x',
    });
    assert.equal(matchEntry([v], s), undefined);
  });

  test('does not match a bare guid when nzbUrl is not a URL', () => {
    const v = version({
      sources: [{ kind: 'nzb', indexer: 'nzbnest', indexer_guid: 'raw-guid' }],
    });
    const s = stream({ nzbUrl: 'raw-guid' });
    assert.equal(matchEntry([v], s), undefined);
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

  test('details path keeps its hex when a guid query is also present', () => {
    const guid = '24967ef4c2e26296c65d3bbfa97aa8fe';
    assert.equal(
      extractNzbGuid(
        `https://nzb.su/details/${guid}?guid=not-the-release#comments`
      ),
      guid
    );
  });

  test('an empty id is kept, so a path hash is not read instead', () => {
    const guid = '24967ef4c2e26296c65d3bbfa97aa8fe';
    assert.equal(
      extractNzbGuid(`https://indexer.example/details/${guid}?id=`),
      ''
    );
  });

  test('guid query, when the path has no release id', () => {
    const guid = '0123456789abcdef0123456789abcdef';
    assert.equal(
      extractNzbGuid(`https://nzbgeek.info/geekseek.php?guid=${guid}`),
      guid
    );
  });

  test('guid query keeps the indexer casing', () => {
    assert.equal(
      extractNzbGuid('https://nzbgeek.info/geekseek.php?guid=AbC'),
      'AbC'
    );
  });

  test('comments fragment does not hide the guid query', () => {
    const guid = '0123456789abcdef0123456789abcdef';
    assert.equal(
      extractNzbGuid(`https://nzbgeek.info/geekseek.php?guid=${guid}#comments`),
      guid
    );
  });
});

describe('resolveRemuxDbIndexer', () => {
  test('resolves a known indexer by hostname', () => {
    assert.equal(
      resolveRemuxDbIndexer('https://nzbnest.com/api?t=get&id=guid123'),
      'nzbnest'
    );
  });

  test('ignores a www. prefix', () => {
    assert.equal(
      resolveRemuxDbIndexer('https://www.nzbnest.com/api?t=get&id=guid123'),
      'nzbnest'
    );
  });

  test('unknown hostname resolves to undefined', () => {
    assert.equal(
      resolveRemuxDbIndexer('https://unknown-indexer.example/api'),
      undefined
    );
  });

  test('not a URL resolves to undefined', () => {
    assert.equal(resolveRemuxDbIndexer('raw-guid'), undefined);
  });

  test('resolves NZBgeek from its website, not only the API host', () => {
    assert.equal(
      resolveRemuxDbIndexer(
        'https://nzbgeek.info/geekseek.php?guid=0123456789abcdef0123456789abcdef'
      ),
      'nzbgeek'
    );
    assert.equal(
      resolveRemuxDbIndexer(
        'https://api.nzbgeek.info/api?t=get&id=0123456789abcdef0123456789abcdef'
      ),
      'nzbgeek'
    );
  });
});

/** The host the map used before profile hosts existed. */
function legacyApiHost(value: string): string {
  return new URL(value).hostname.replace(/^www\./, '');
}

describe('remuxDbHostMap', () => {
  // Loaded after adapter. A static import here evaluates the preset first,
  // and the preset's graph reaches this module before NEWZNAB_INDEXERS exists.
  const indexers = async () =>
    (await import('../presets/newznab.js')).NEWZNAB_INDEXERS;

  test('every API host still resolves to the same indexer', async () => {
    const NEWZNAB_INDEXERS = await indexers();
    const map = remuxDbHostMap(NEWZNAB_INDEXERS);
    for (const indexer of NEWZNAB_INDEXERS) {
      if (!indexer.remuxDbIndexer) continue;
      assert.equal(map[legacyApiHost(indexer.value)], indexer.remuxDbIndexer);
    }
  });

  test('a profile host is mapped only when it is the API host without api.', async () => {
    const NEWZNAB_INDEXERS = await indexers();
    const map = remuxDbHostMap(NEWZNAB_INDEXERS);
    const extras: string[] = [];
    for (const indexer of NEWZNAB_INDEXERS) {
      if (!indexer.remuxDbIndexer || !indexer.apiKeyUrl) continue;
      const api = legacyApiHost(indexer.value);
      const profile = new URL(indexer.apiKeyUrl).hostname
        .toLowerCase()
        .replace(/^www\./, '');
      const website = api.startsWith('api.') ? api.slice(4) : undefined;
      if (website && profile === website) {
        assert.equal(map[profile], indexer.remuxDbIndexer);
        extras.push(profile);
      }
    }
    // A new indexer that fits the rule shows up here. Add it on purpose.
    assert.deepEqual(extras.sort(), [
      'althub.co.za',
      'nzb.life',
      'nzbgeek.info',
      'nzbplanet.net',
    ]);
  });

  test('a profile URL on a different site is not claimed', async () => {
    const map = remuxDbHostMap(await indexers());
    assert.equal(map['torbox.app'], undefined);
    assert.equal(map['search-api.torbox.app'], 'torbox');
    assert.equal(map['searchnzb.com'], undefined);
    assert.equal(map['api.searchnzb.com'], undefined);
  });

  test('an indexer without a RemuxDB id contributes no hosts', () => {
    const map = remuxDbHostMap([
      { value: 'https://api.example.test/api', remuxDbIndexer: 'kept' },
      {
        value: 'not a url',
        apiKeyUrl: 'also not a url',
      },
    ]);
    assert.deepEqual(map, { 'api.example.test': 'kept' });
  });

  test('remuxDbHosts names a site that is neither the API nor the profile', () => {
    const map = remuxDbHostMap([
      {
        value: 'https://feed.example.test/api',
        apiKeyUrl: 'https://feed.example.test/profile',
        remuxDbIndexer: 'example',
        remuxDbHosts: ['details.example.test'],
      },
    ]);
    assert.equal(map['feed.example.test'], 'example');
    assert.equal(map['details.example.test'], 'example');
  });

  test('one host claimed by two indexers is refused', () => {
    assert.throws(
      () =>
        remuxDbHostMap([
          { value: 'https://shared.example/api', remuxDbIndexer: 'first' },
          { value: 'https://shared.example/api', remuxDbIndexer: 'second' },
        ]),
      /claimed by first and second/
    );
  });

  test('the same indexer may have two hosts', () => {
    const map = remuxDbHostMap([
      { value: 'https://feed.example.org/api', remuxDbIndexer: 'animetosho' },
      { value: 'https://feed.example.net/api', remuxDbIndexer: 'animetosho' },
    ]);
    assert.equal(map['feed.example.org'], 'animetosho');
    assert.equal(map['feed.example.net'], 'animetosho');
  });
});

const GEEK_GUID = '0123456789abcdef0123456789abcdef';
const GEEK_INFO = `https://nzbgeek.info/geekseek.php?guid=${GEEK_GUID}`;

describe('nzbIndexerGuid', () => {
  test('NZBgeek info page, with the download URL pointing at Prowlarr', () => {
    assert.deepEqual(
      nzbIndexerGuid(
        'http://prowlarr.local:9696/1/download?apikey=x&link=y',
        GEEK_INFO
      ),
      { indexer: 'nzbgeek', guid: GEEK_GUID }
    );
  });

  test('an empty id on the download URL does not hide the info page', () => {
    assert.deepEqual(
      nzbIndexerGuid('https://api.nzbgeek.info/api?t=get&id=', GEEK_INFO),
      { indexer: 'nzbgeek', guid: GEEK_GUID }
    );
  });

  test('a direct download URL wins over a different id on the info page', () => {
    assert.deepEqual(
      nzbIndexerGuid(
        `https://api.nzbgeek.info/api?t=get&id=from-download&apikey=x`,
        GEEK_INFO
      ),
      { indexer: 'nzbgeek', guid: 'from-download' }
    );
  });

  test('a details path still matches, including the comments fragment', () => {
    const guid = '24967ef4c2e26296c65d3bbfa97aa8fe';
    assert.deepEqual(
      nzbIndexerGuid(undefined, `https://nzbnest.com/details/${guid}#comments`),
      { indexer: 'nzbnest', guid }
    );
  });

  test('info page matches the release inside matchEntry', () => {
    const v = version({
      sources: [{ kind: 'nzb', indexer: 'nzbgeek', indexer_guid: GEEK_GUID }],
    });
    const s = stream({
      type: 'usenet',
      nzbUrl: 'http://prowlarr.local:9696/1/download?link=y',
      infoUrl: GEEK_INFO,
    });
    assert.equal(matchEntry([v], s), v);
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
          bit_rate: 640_000,
          sample_rate: 48_000,
        }),
        track({ kind: 'subtitle', language: 'fre', title: 'French' }),
      ],
    });
    const wire = toWireMediaInfo(v);
    assert.equal(wire.audio?.length, 1);
    assert.partialDeepStrictEqual(wire.audio?.[0], {
      codec: 'eac3',
      lang: 'eng',
      ch_layout: '5.1',
      ch: 6,
      br: 640_000,
      sample_rate: 48_000,
    });
    assert.partialDeepStrictEqual(wire.subtitle?.[0], {
      lang: 'fre',
      title: 'French',
    });
  });

  test('converts duration from seconds to nanoseconds', () => {
    const v = version({ duration: 120, size: 1000, bitrate: 500 });
    const wire = toWireMediaInfo(v);
    assert.equal(wire.format?.dur, 120 * 1_000_000_000);
    assert.equal(wire.format?.s, 1000);
    assert.equal(wire.format?.br, 500);
  });

  test('has_chapters reflects chapters length', () => {
    const parse = (chapters?: unknown[]) =>
      MediaProbeVersionSchema.parse({ sources: [], tracks: [], chapters });
    assert.equal(toWireMediaInfo(parse()).has_chapters, false);
    assert.equal(toWireMediaInfo(parse([{}])).has_chapters, true);
    assert.equal('chapters' in parse([{}]), false);
  });
});
