import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EasynewsApi, type EasynewsSearchItem } from './api.js';
import FileParser from '../../parser/file.js';
import { getOriginalAudioLanguage } from '../../streams/title-conflicts.js';
import { EasynewsSearchAddon } from './addon.js';
import { BuiltinStreamParser } from '../../presets/builtin.js';
import type { Addon } from '../../db/schemas.js';
import { Cache } from '../../utils/cache.js';
import { DistributedLock } from '../../utils/distributed-lock.js';
import { initialiseTestSettings, mockHttp } from '../../../test/helpers.js';

describe('Easynews filename separators', () => {
  for (const fixture of [
    {
      input: 'Show Name S03 - 09',
      title: 'Show.Name.S03.-.09.mkv',
      seasons: [3],
      episodes: [9],
    },
    {
      input: 'Show Name S03-09',
      title: 'Show.Name.S03-09.mkv',
      seasons: [3, 4, 5, 6, 7, 8, 9],
      episodes: [],
    },
    {
      input: 'Show Name S03E09',
      title: 'Show.Name.S03E09.mkv',
      seasons: [3],
      episodes: [9],
    },
  ]) {
    it(fixture.input, () => {
      // Exercise the production result parser without an authenticated search.
      const api = new EasynewsApi('test', 'test') as unknown as {
        parseItem(raw: unknown): EasynewsSearchItem | null;
      };
      const item = api.parseItem({
        hash: 'test-hash',
        fn: fixture.input,
        ext: '.mkv',
        runtime: 1440,
      });
      assert.ok(item);
      assert.equal(item.title, fixture.title);
      const parsed = FileParser.parse(item.title);
      assert.deepEqual(parsed.seasons, fixture.seasons);
      assert.deepEqual(parsed.episodes ?? [], fixture.episodes);
    });
  }
});

describe('Easynews structured audio evidence', () => {
  const parse = (audio_tracks: unknown, extra = {}) => {
    const api = new EasynewsApi('test', 'test') as unknown as {
      parseItem(raw: unknown): EasynewsSearchItem | null;
    };
    return api.parseItem({
      hash: 'test-hash',
      fn: 'Shared.Show.S01E10',
      ext: '.mkv',
      runtime: 1440,
      audio_tracks,
      ...extra,
    });
  };
  it('preserves explicit roles and languages on the individual result', () => {
    const item = parse([
      { lang: 'jpn', original: true },
      { lang: 'eng', dub: true },
    ]);
    assert.ok(item);
    assert.deepEqual(item.audioLangs, ['Japanese', 'English']);
    assert.equal(item.audioTracks?.[0].original, true);
    assert.equal(item.audioTracks?.[1].dub, true);
    assert.equal(
      getOriginalAudioLanguage({
        mediaInfoQuality: 'indexer',
        audioTracks: item.audioTracks,
      }),
      'ja'
    );
  });
  it('does not infer original dialogue from language strings, defaults or display labels', () => {
    for (const tracks of [
      ['Japanese', 'Original'],
      [{ lang: 'jpn', default: true }],
      [{ lang: 'jpn', title: 'Original' }],
      [{ lang: 'jpn', original: 'true' }],
      [{ lang: 'jpn', original: true, dub: true }],
      [{ lang: 'jpn', original: true, commentary: true }],
      [{ lang: 'jpn', original: true, visualImpaired: true }],
      [{ original: true }],
    ]) {
      const item = parse(tracks);
      assert.ok(item);
      assert.equal(
        getOriginalAudioLanguage({
          mediaInfoQuality: 'indexer',
          audioTracks: item.audioTracks,
        }),
        undefined
      );
    }
  });
  it('handles mixed and malformed arrays without dropping valid tracks or crashing', () => {
    const item = parse([
      null,
      42,
      [],
      'English',
      { language: 'jpn', original: true },
    ]);
    assert.ok(item);
    assert.deepEqual(item.audioLangs, ['English', 'Japanese']);
    assert.equal(item.audioTracks?.length, 5);
    assert.equal(
      getOriginalAudioLanguage({
        mediaInfoQuality: 'indexer',
        audioTracks: item.audioTracks,
      }),
      'ja'
    );
    assert.equal(
      parse([
        { lang: 'jpn', original: true },
        { lang: 'eng', original: true },
      ])?.audioTracks?.length,
      2
    );
    assert.equal(
      getOriginalAudioLanguage({
        mediaInfoQuality: 'indexer',
        audioTracks: parse([
          { lang: 'jpn', original: true },
          { lang: 'eng', original: true },
        ])?.audioTracks,
      }),
      undefined
    );
  });

  it('carries provider roles through the real addon and builtin stream parser', async (t) => {
    await initialiseTestSettings(t);
    const item = parse([
      { lang: 'jpn', original: true },
      { lang: 'eng', dub: true },
    ]);
    assert.ok(item);
    let searches = 0;
    const addon = Object.create(EasynewsSearchAddon.prototype);
    Object.assign(addon, {
      userData: {},
      buildQueries: () => ['Shared Show'],
      getSearchMetadata: async () => ({ primaryTitle: 'Shared Show' }),
      api: {
        search: async () => {
          searches++;
          return { results: [item], downloadInfo: {} };
        },
        generateNzbUrl: () => 'https://test.invalid/file.nzb',
        calculateAge: () => 24,
        generateEasynewsDlUrl: () => 'https://test.invalid/file.mkv',
      },
    });
    const releases = await addon._searchNzbs({ mediaType: 'series' });
    assert.equal(searches, 1);
    const raw = addon._createStream(
      {
        ...releases[0],
        file: { name: item.title, size: item.size, index: -1 },
      },
      'tt0108850:1:10',
      {}
    );
    const stream = new BuiltinStreamParser({
      instanceId: 'test',
      name: 'Easynews',
      preset: { id: 'easynews-search' },
    } as Addon).parse(raw);
    assert.ok(!('skip' in stream));
    assert.equal(stream.parsedFile?.mediaInfoQuality, 'indexer');
    assert.equal(getOriginalAudioLanguage(stream.parsedFile), 'ja');
    assert.equal(stream.parsedFile?.audioTracks?.[1].dub, true);
  });
});

it('refreshes old Easynews projections and retains per-item roles through cache round-trips', async (t) => {
  await initialiseTestSettings(t);
  t.mock.method(
    DistributedLock.getInstance(),
    'withLock',
    async (_key, fn) => ({ result: await fn() })
  );
  const agent = mockHttp(t);
  const options = { query: 'independent audio cache regression' };
  const key = JSON.stringify({ ...options, apiVersion: '3.0' });
  await Cache.getInstance('easynews:search').set(
    key,
    {
      results: [{ hash: 'old', title: 'Old.Show.S01E10.mkv' }],
      downloadInfo: {},
    },
    60
  );
  agent
    .get('https://members.easynews.com')
    .intercept({ path: /^\/3\.0\/api\/search\?/ })
    .reply(200, {
      data: [
        {
          hash: 'fresh',
          fn: 'Shared.Show.S01E10',
          ext: '.mkv',
          runtime: 1440,
          audio_tracks: [
            { lang: 'eng', original: true },
            { lang: 'fra', dub: true },
          ],
        },
      ],
      results: 1,
      returned: 1,
      numPages: 1,
    });
  const api = new EasynewsApi('test-cache', 'test-cache');
  const fresh = await api.search(options);
  assert.equal(fresh.results[0].hash, 'fresh');
  assert.equal(
    getOriginalAudioLanguage({
      mediaInfoQuality: 'indexer',
      audioTracks: fresh.results[0].audioTracks,
    }),
    'en'
  );
  const cached = await api.search(options);
  assert.deepEqual(cached, fresh);
  agent.assertNoPendingInterceptors();
});
