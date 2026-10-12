import {
  release,
  seriesContext,
  catalogue,
} from '../../test/title-fixtures.js';
import './filterer.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import StreamFilterer from './filterer.js';
import { matchesReleaseIds } from './title-conflicts.js';
import { parseNabReleaseIds } from '../builtins/base/nab/addon.js';
import { BaseNabApi } from '../builtins/base/nab/api.js';
import { NewznabAddon } from '../builtins/newznab/addon.js';
import { TorznabAddon } from '../builtins/torznab/addon.js';
import { BuiltinStreamParser } from '../presets/builtin.js';
import StreamParser from '../parser/streams.js';
import { getOriginalAudioLanguage } from './title-conflicts.js';
import { SkyhookMetadata } from '../metadata/skyhook.js';
import { RegexAccess } from '../utils/regex-access.js';
import { DistributedLock } from '../utils/distributed-lock.js';
import { Cache } from '../utils/cache.js';
import type { Addon, ParsedStream, Stream, UserData } from '../db/schemas.js';
import type { StreamContext } from './context.js';
import { initialiseTestSettings, mockHttp } from '../../test/helpers.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const pack =
  '[xPearse] Marmalade Boy/ママレード ボーイ - Episodes 01-76 [English] [Dual-Audio] [480p]';

async function initialise(t: any) {
  await initialiseTestSettings(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
}

describe('release-level indexer identity', () => {
  it('normalises item identifiers without inventing them from queries or ambiguous namespaces', () => {
    for (const raw of ['0108850', 'tt0108850', 108850])
      assert.deepEqual(parseNabReleaseIds({ imdb: raw, tvdbid: '72421' }), {
        imdbId: 'tt0108850',
        tvdbId: 72421,
      });
    assert.deepEqual(
      parseNabReleaseIds({
        imdb: 'tt0108850',
        imdbid: '0108850',
        tvdbid: '72421,72421',
      }),
      {
        imdbId: 'tt0108850',
        tvdbId: 72421,
      }
    );
    assert.deepEqual(parseNabReleaseIds({ imdb: '0', tvdbid: '72421' }), {
      tvdbId: 72421,
    });
    for (const attrs of [
      {},
      { imdb: '', tvdbid: '0' },
      { tmdbid: '35507' },
      { imdb: 'tt0108850', imdbid: 'tt1234567' },
      { tvdbid: '72421,455890' },
      { imdb: 'tt0108850', tvdbid: '-1' },
      { tvdbid: '1.2' },
      { tvdbid: '1e6' },
      { tvdbid: '9007199254740993' },
      { tvdbid: 'unknown' },
      { imdb: 'tt12345678901' },
    ])
      assert.equal(parseNabReleaseIds(attrs), undefined, JSON.stringify(attrs));
  });

  it('requires at least one comparable ID and rejects contradictions in either namespace', () => {
    const requested = { tvdbId: 72421, imdbId: 'tt0108850' };
    assert.equal(matchesReleaseIds(requested, { tvdbId: 72421 }), true);
    assert.equal(matchesReleaseIds(requested, { imdbId: 'tt0108850' }), true);
    assert.equal(matchesReleaseIds(requested, requested), true);
    for (const release of [
      { tvdbId: 455890 },
      { tvdbId: 72421, imdbId: 'tt1234567' },
      { tvdbId: 455890, imdbId: 'tt0108850' },
    ])
      assert.equal(matchesReleaseIds(requested, release), false);
    assert.equal(matchesReleaseIds(requested, undefined), undefined);
    assert.equal(
      matchesReleaseIds({ tvdbId: 72421 }, { imdbId: 'tt0108850' }),
      undefined
    );
    assert.equal(matchesReleaseIds({}, requested), undefined);
  });

  it('marks actual ID queries, including Auto searches, without treating tvsearch itself as identity', async (t) => {
    await initialise(t);
    for (const namespace of ['newznab', 'torznab'] as const) {
      for (const {
        supportedParams,
        metadata,
        forceQuerySearch,
        expectedId,
      } of [
        {
          supportedParams: ['tvdbid', 'imdbid', 'q', 'season', 'ep'],
          metadata: { tvdbId: 72421, imdbId: 'tt0108850' },
          expectedId: 'tvdbid',
        },
        {
          supportedParams: ['imdbid', 'q'],
          metadata: { imdbId: 'tt0108850' },
          expectedId: 'imdbid',
        },
        {
          supportedParams: ['tmdbid', 'q'],
          metadata: { tmdbId: 35507 },
          expectedId: 'tmdbid',
        },
        {
          supportedParams: ['q', 'season', 'ep'],
          metadata: { tvdbId: 72421 },
          expectedId: undefined,
        },
        {
          supportedParams: ['tvdbid', 'q'],
          metadata: {},
          expectedId: undefined,
        },
        {
          supportedParams: ['season', 'ep'],
          metadata: { tvdbId: 72421 },
          expectedId: undefined,
        },
        {
          supportedParams: ['tvdbid', 'q'],
          metadata: { tvdbId: 72421 },
          forceQuerySearch: true,
          expectedId: undefined,
        },
      ]) {
        const calls: { fn: string; params: Record<string, string> }[] = [];
        const addon = Object.create(
          namespace === 'newznab'
            ? NewznabAddon.prototype
            : TorznabAddon.prototype
        );
        Object.assign(addon, {
          id: namespace,
          logger,
          userData: {
            url: 'https://search-identity.test',
            forceQuerySearch,
            paginate: false,
            seasonEpisodeStrategy: 'episode',
          },
          buildQueries: () => ['Shared Show'],
          api: {
            getCapabilities: async () => ({
              server: { title: 'Test' },
              searching: {
                tvSearch: { available: true, supportedParams },
                search: { available: true, supportedParams: ['q'] },
              },
            }),
            search: async (fn: string, params: Record<string, string>) => {
              calls.push({ fn, params });
              return { results: [], total: 0, offset: 0 };
            },
          },
        });
        const result = await addon.performSearch(
          { mediaType: 'series', season: '1', episode: '10' },
          { primaryTitle: 'Shared Show', ...metadata }
        );
        assert.equal(result.meta.searchType, expectedId ? 'id' : 'query');
        assert.equal(
          calls.length,
          1,
          'an empty ID response does not trigger a text search'
        );
        assert.equal(calls[0].fn, forceQuerySearch ? 'search' : 'tvsearch');
        if (expectedId) {
          assert.ok(calls[0].params[expectedId]);
          assert.equal(calls[0].params.q, undefined);
        } else {
          assert.equal(calls[0].params.tvdbid, undefined);
          assert.equal(
            calls[0].params.q,
            supportedParams.includes('q') || forceQuerySearch
              ? 'Shared Show'
              : undefined
          );
        }
      }
    }
  });

  it('retains real feed IDs through both scanner profiles, addon conversion and builtin parsing', async (t) => {
    await initialise(t);
    t.mock.method(
      DistributedLock.getInstance(),
      'withLock',
      async (_key, fn) => ({ result: await fn() })
    );
    const agent = mockHttp(t);
    for (const namespace of ['newznab', 'torznab'] as const) {
      const origin = `https://${namespace}.release-identity.test`;
      const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:${namespace}="urn:test"><channel>
        <item><title>${pack}</title><guid>test</guid><enclosure url="${origin}/release" type="${namespace === 'newznab' ? 'application/x-nzb' : 'application/x-bittorrent'}" length="23247650884"/>
        <${namespace}:attr name="tvdbid" value="72421"/><${namespace}:attr name="imdb" value=""/>
        <${namespace}:attr name="year" value="1994"/><${namespace}:attr name="category" value="5000"/><${namespace}:attr name="category" value="5070"/>
        <${namespace}:attr name="audio_tracks" value="[{&quot;lang&quot;:&quot;jpn&quot;,&quot;original&quot;:true},{&quot;lang&quot;:&quot;eng&quot;,&quot;dub&quot;:true}]"/>
        <${namespace}:attr name="infohash" value="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"/>
        </item></channel></rss>`;
      agent
        .get(origin)
        .intercept({ path: /^\/api\?/ })
        .reply(200, xml);
      const api = new BaseNabApi(namespace, logger as any, origin);
      const params = {
        q: 'marmalade boy',
        extended: 1,
      };
      const key = `${origin}/api?t=search&${JSON.stringify(params)}&apikey=&{}`;
      await Cache.getInstance(`${namespace}:api:search:v3`).set(
        key,
        {
          results: [{ title: pack, enclosure: [], [namespace]: {} }],
        },
        60
      );
      const response = await api.search('search', params);
      assert.equal(response.results.length, 1);
      const attrs = (response.results[0] as any)[namespace];
      assert.equal(attrs.tvdbid, '72421');
      assert.deepEqual(
        await api.search('search', params),
        response,
        'fresh IDs survive cache round-trips'
      );
      const prototype =
        namespace === 'newznab'
          ? NewznabAddon.prototype
          : TorznabAddon.prototype;
      const addon = Object.create(prototype);
      Object.assign(addon, {
        name: 'Test',
        userData: {},
        getSearchMetadata: async () => ({}),
        performSearch: async () => ({
          results: response.results,
          meta: {
            searchType: 'query',
            capabilities: { server: { title: 'Test' } },
          },
        }),
      });
      const releases =
        namespace === 'newznab'
          ? await addon._searchNzbs({ mediaType: 'series' })
          : await addon._searchTorrents({ mediaType: 'series' });
      assert.deepEqual(releases[0].releaseIds, { tvdbId: 72421 });
      assert.equal(releases[0].releaseMedium, 'animation');
      assert.equal(
        releases[0].confirmed,
        false,
        'keyword result has its own item ID'
      );
      const raw = addon._createStream(
        { ...releases[0], file: { name: pack, size: 23247650884, index: 0 } },
        'tt0108850:1:10',
        {}
      );
      const parser = new BuiltinStreamParser({
        instanceId: 'test',
        name: 'Test',
        preset: { id: namespace },
      } as Addon);
      const parsed = parser.parse(raw);
      assert.ok(!('skip' in parsed));
      assert.deepEqual(parsed.releaseIds, { tvdbId: 72421 });
      assert.equal(parsed.releaseMedium, 'animation');
      assert.equal(getOriginalAudioLanguage(parsed.parsedFile), 'ja');
      assert.equal(parsed.parsedFile?.audioTracks?.[1].dub, true);
      assert.equal(
        parsed.idMatched,
        undefined,
        'query trust is not substituted for item IDs'
      );
      const untrusted = new StreamParser({
        instanceId: 'other',
        name: 'Other',
        preset: { id: 'generic' },
      } as Addon).parse({ ...raw });
      assert.ok(!('skip' in untrusted));
      assert.deepEqual(
        untrusted.releaseIds,
        { tvdbId: 72421 },
        'explicit validated IDs survive generic parsing too'
      );
      assert.equal(untrusted.releaseMedium, undefined);
      addon.performSearch = async () => ({
        results: response.results,
        meta: { searchType: 'id', capabilities: { server: { title: 'Test' } } },
      });
      const idReleases =
        namespace === 'newznab'
          ? await addon._searchNzbs({ mediaType: 'series' })
          : await addon._searchTorrents({ mediaType: 'series' });
      const idRaw = addon._createStream(
        { ...idReleases[0], file: { name: pack, size: 23247650884, index: 0 } },
        'tt0108850:1:10',
        {}
      );
      const idParsed = parser.parse(idRaw);
      assert.ok(!('skip' in idParsed));
      assert.equal(idParsed.idMatched, true);
      const genericIdParsed = new StreamParser({
        instanceId: 'other',
        name: 'Other',
        preset: { id: 'generic' },
      } as Addon).parse(idRaw);
      assert.ok(!('skip' in genericIdParsed));
      assert.equal(genericIdParsed.idMatched, undefined);
      const libraryRaw = addon._createStream(
        {
          ...idReleases[0],
          library: true,
          file: { name: pack, size: 23247650884, index: 0 },
        },
        'tt0108850:1:10',
        {}
      );
      assert.equal(
        libraryRaw.idMatched,
        undefined,
        'filename-matched library confirmation does not claim an ID search'
      );
      for (const releaseIds of [
        { tvdbId: -1 },
        { tvdbId: 72421, imdbId: 'not-an-id' },
      ]) {
        const invalid = parser.parse({
          ...raw,
          releaseIds,
        } as unknown as Stream);
        assert.ok(!('skip' in invalid));
        assert.equal(invalid.releaseIds, undefined);
      }
    }
    agent.assertNoPendingInterceptors();
  });

  it('only built-in query provenance bypasses ambiguity, while external item-ID contradictions still reject', async (t) => {
    await initialise(t);
    t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id) =>
      catalogue(id, [30], undefined)
    );
    const context = seriesContext({
      title: 'Shared Show',
      titles: [{ title: 'Shared Show' }],
      tvdbId: 72421,
      titleConflicts: [{ title: 'Shared Show', tvdbId: 455890 }],
    });
    const filter = new StreamFilterer({
      titleMatching: { enabled: true, ambiguousResults: 'discard' },
    } as UserData);
    for (const [Parser, expected] of [
      [StreamParser, 0],
      [BuiltinStreamParser, 1],
    ] as const) {
      // A preset label on its own cannot grant trust to the default parser.
      const parser = new Parser({
        instanceId: 'identity-boundary',
        name: 'Test',
        preset: { id: 'newznab' },
      } as Addon);
      for (const marker of [true, false, undefined, 'true', 1]) {
        const parsed = parser.parse({
          url: 'https://identity-boundary.test/release',
          behaviorHints: { filename: 'Shared.Show.S01E10.mkv' },
          idMatched: marker,
          releaseIds: { tvdbId: 72421 },
        } as Stream);
        assert.ok(!('skip' in parsed));
        assert.deepEqual(parsed.releaseIds, { tvdbId: 72421 });
        assert.equal(
          (await filter.filter([parsed], context)).length,
          marker === true ? expected : 0,
          `${Parser.name}/${marker}`
        );
      }
      const mismatched = parser.parse({
        url: 'https://identity-boundary.test/release',
        behaviorHints: { filename: 'Shared.Show.S01E10.mkv' },
        idMatched: true,
        releaseIds: { tvdbId: 455890 },
      });
      assert.ok(!('skip' in mismatched));
      assert.deepEqual(mismatched.releaseIds, { tvdbId: 455890 });
      assert.equal((await filter.filter([mismatched], context)).length, 0);
    }
  });

  it('ignores malformed anime IMDb fallbacks while preserving canonical contradictions and parsed request IDs', async (t) => {
    await initialise(t);
    t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id) =>
      catalogue(id, [30], undefined)
    );
    const metadata = {
      title: 'Shared Show',
      titles: [{ title: 'Shared Show' }],
      year: 1994,
      titleConflicts: [{ title: 'Shared Show', tvdbId: 455890, year: 2001 }],
    };
    const filter = new StreamFilterer({
      titleMatching: { enabled: true, ambiguousResults: 'discard' },
    } as UserData);
    const animeRequest = {
      type: 'kitsuId',
      value: '42',
      season: '1',
      episode: '10',
    };
    for (const [animeEntry, expected] of [
      [{ imdb: { id: '0108850' } }, 1],
      [{ mappings: { imdbId: '0108850' } }, 1],
      [{ imdb: { id: 108850 } }, 1],
      [{ mappings: { imdbId: 108850 } }, 1],
      [{ imdb: { id: '' } }, 1],
      [{ imdb: { id: 'tt12345678901' } }, 1],
      [{ imdb: { id: 'not-an-id' } }, 1],
      [{ imdb: { id: 'tt0108850' } }, 1],
      [{ mappings: { imdbId: 'tt0108850' } }, 1],
      [{ imdb: { id: 'tt1234567' } }, 0],
      [{ mappings: { imdbId: 'tt1234567' } }, 0],
    ] as const) {
      for (const idMatched of [undefined, true]) {
        const context = seriesContext(metadata, {
          id: 'kitsu:42:10',
          isAnime: true,
          parsedId: animeRequest,
          animeEntry,
        });
        const make = () =>
          release('Shared.Show.1994.S01E10.mkv', {
            releaseIds: { imdbId: 'tt0108850' },
            idMatched,
          });
        assert.equal(
          (await filter.filter([make()], context)).length,
          expected,
          `${JSON.stringify(animeEntry)}/${idMatched}`
        );
        assert.equal(
          (
            await filter.filter(
              [make()],
              seriesContext(metadata, {
                isAnime: true,
                animeEntry,
                parsedId: {
                  ...animeRequest,
                  type: 'imdbId',
                  value: 'tt0108850',
                },
              })
            )
          ).length,
          1,
          'the parsed IMDb request remains authoritative'
        );
      }
    }
  });

  it('T02/T06/T07: ID provenance resolves ambiguity, while comparable contradictions and other configured filters retain ownership', async (t) => {
    await initialise(t);
    t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id) =>
      catalogue(id, [30], undefined)
    );
    const metadata = {
      title: 'Shared Show',
      titles: [{ title: 'Shared Show' }],
      year: 1994,
      country: 'US',
      originalLanguage: 'en',
      tvdbId: 72421,
      seasons: [{ season_number: 1, episode_count: 76 }],
      episodeTitles: [{ title: 'A Real Episode Name', language: 'en' }],
      titleConflicts: [
        { title: 'Shared Show', tvdbId: 455890, year: 2001, country: 'US' },
      ],
    };
    const context = seriesContext(metadata, {
      id: 'tt0108850:1:10',
      parsedId: {
        type: 'imdbId',
        value: 'tt0108850',
        season: '1',
        episode: '10',
      },
    });
    const options = {
      titleMatching: { enabled: true, ambiguousResults: 'discard' },
      yearMatching: { enabled: true },
      seasonEpisodeMatching: { enabled: true, strict: true },
      episodeTitleMatching: { enabled: true, similarityThreshold: 1 },
    } as UserData;
    const filter = new StreamFilterer(options);
    const make = (
      type: ParsedStream['type'],
      name: string,
      identity: Partial<ParsedStream> = {}
    ) => {
      const item = release(name, { type, ...identity });
      item.parsedFile = {
        ...item.parsedFile,
        languages: ['English'],
        audioTracks: [{ lang: 'English', dub: true }],
      };
      return item;
    };
    for (const type of [
      'usenet',
      'stremio-usenet',
      'p2p',
      'http',
      'debrid',
    ] as const) {
      const check = async (
        name: string,
        expected: number,
        identity: Partial<ParsedStream> = {}
      ) =>
        assert.equal(
          (await filter.filter([make(type, name, identity)], context)).length,
          expected,
          `${type}/${name}/${JSON.stringify(identity)}`
        );
      for (const identity of [
        { releaseIds: { tvdbId: 72421 }, idMatched: true },
        { releaseIds: { imdbId: 'tt0108850' }, idMatched: true },
        { idMatched: true },
      ]) {
        for (const suffix of [
          'S01E10.mkv',
          'S01E01-E76.COMPLETE',
          'S01E10-E11.mkv',
        ]) {
          await check(`Shared.Show.${suffix}`, 1, identity);
          await check(`Shared.Show.1994.${suffix}`, 1, identity);
        }
        await check('Shared.Show.S01E10.A.Real.Episode.Name.mkv', 1, identity);
        for (const name of [
          'Shared.Show.2001.S01E10.mkv',
          'Shared.Show.S01E11.mkv',
          'Other.Show.S01E10.mkv',
          'Shared.Show.S01E10.A.Wrong.Episode.Name.mkv',
          'Shared.Show.UK.S01E10.mkv',
        ])
          await check(name, 0, identity);
      }
      for (const releaseIds of [
        undefined,
        { tvdbId: 72421 },
        { imdbId: 'tt0108850' },
        { tvdbId: 455890 },
        { tvdbId: 72421, imdbId: 'tt1234567' },
      ])
        await check('Shared.Show.S01E10.mkv', 0, { releaseIds });
      for (const releaseIds of [
        { tvdbId: 455890 },
        { tvdbId: 72421, imdbId: 'tt1234567' },
      ])
        await check('Shared.Show.1994.S01E10.mkv', 0, {
          releaseIds,
          idMatched: true,
        });
      await check('Shared.Show.S01E10.mkv', 1, { idMatched: true });
      await check('Shared.Show.1994.S01E10.mkv', 0, {
        releaseIds: { tvdbId: 455890 },
      });
    }
    const packContext = {
      ...context,
      isAnime: true,
      getMetadata: async () => ({
        ...metadata,
        title: 'Marmalade Boy',
        titles: [{ title: 'Marmalade Boy' }],
        country: 'JP',
        originalLanguage: 'ja',
        absoluteEpisode: 10,
        episodeTitles: [],
        titleConflicts: [
          { title: 'Marmalade Boy', tvdbId: 455890, year: 2001, country: 'KR' },
          { title: 'Marmalade Boy', tmdbId: 96475, year: 2001, country: 'TW' },
        ],
      }),
    } as unknown as StreamContext;
    for (const releaseIds of [undefined, { tvdbId: 72421 }])
      assert.equal(
        (
          await filter.filter(
            [make('usenet', pack, { releaseIds })],
            packContext
          )
        ).length,
        0
      );
    for (const titleMatching of [
      { enabled: false },
      { enabled: true, ambiguousResults: 'keep' },
      { ...options.titleMatching, addons: ['another-addon'] },
      { ...options.titleMatching, requestTypes: ['movie'] },
    ])
      assert.equal(
        (
          await new StreamFilterer({
            ...options,
            titleMatching,
          } as UserData).filter(
            [
              make('http', 'Shared.Show.S01E10.mkv', {
                releaseIds: { tvdbId: 455890 },
              }),
            ],
            context
          )
        ).length,
        1
      );
    const withoutEpisodeFilter = new StreamFilterer({
      ...options,
      episodeTitleMatching: { enabled: false },
    });
    assert.equal(
      (
        await withoutEpisodeFilter.filter(
          [
            make('http', 'Shared.Show.S01E10.A.Wrong.Episode.Name.mkv', {
              idMatched: true,
            }),
          ],
          context
        )
      ).length,
      1
    );
    assert.equal(
      (
        await new StreamFilterer({
          ...options,
          excludeSeasonPacks: true,
        }).filter(
          [
            make('http', 'Shared.Show.1994.S01.COMPLETE', {
              releaseIds: { tvdbId: 72421 },
            }),
          ],
          context
        )
      ).length,
      0
    );
  });
});
