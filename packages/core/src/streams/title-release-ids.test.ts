import './filterer.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import StreamFilterer from './filterer.js';
import { matchesReleaseIds, hasIdSearchIdentity } from './title-conflicts.js';
import { parseNabReleaseIds } from '../builtins/base/nab/addon.js';
import { BaseNabApi } from '../builtins/base/nab/api.js';
import { NewznabAddon } from '../builtins/newznab/addon.js';
import { TorznabAddon } from '../builtins/torznab/addon.js';
import { BuiltinStreamParser } from '../presets/builtin.js';
import StreamParser from '../parser/streams.js';
import { getOriginalAudioLanguage } from './title-conflicts.js';
import FileParser from '../parser/file.js';
import { SkyhookMetadata } from '../metadata/skyhook.js';
import { RegexAccess } from '../utils/regex-access.js';
import { DistributedLock } from '../utils/distributed-lock.js';
import { Cache } from '../utils/cache.js';
import type {
  Addon,
  ParsedStream,
  ReleaseIds,
  Stream,
  UserData,
} from '../db/schemas.js';
import type { StreamContext } from './context.js';
import {
  initialiseTestSettings,
  mockHttp,
  createTestStreamContext,
} from '../../test/helpers.js';

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

  it('requires ID-search provenance and retains explicit ID/year/country contradictions', () => {
    const metadata = { title: 'Shared Show', year: 1994, country: 'US' };
    const requested = { tvdbId: 72421, imdbId: 'tt0108850' };
    assert.equal(
      hasIdSearchIdentity(metadata, requested, { releaseIds: requested }),
      false
    );
    assert.equal(
      hasIdSearchIdentity(metadata, requested, { idMatched: true }),
      true
    );
    assert.equal(
      hasIdSearchIdentity(
        { title: 'Shared Show' },
        {},
        {
          idMatched: true,
          parsedFile: FileParser.parse('Shared.Show.UK.1994.S01E10.mkv'),
        }
      ),
      true,
      'unknown requested metadata is not a contradiction'
    );
    for (const extra of [
      { releaseIds: { tvdbId: 455890 } },
      { releaseIds: { tvdbId: 72421, imdbId: 'tt1234567' } },
      { releaseYear: '2001' },
      { releaseYear: 'unknown' },
      { parsedFile: FileParser.parse('Shared.Show.UK.S01E10.mkv') },
      { parsedFile: FileParser.parse('Shared.Show.2001.S01E10.mkv') },
    ])
      assert.equal(
        hasIdSearchIdentity(metadata, requested, { idMatched: true, ...extra }),
        false
      );
  });

  it('keeps ID provenance from narrowing ordinary release-year compatibility', async (t) => {
    await initialise(t);
    const cases = [
      {
        isAnime: true,
        metadata: { year: 1998, releaseYears: [1998], seasonYear: 2021 },
        filename: 'Shared.Show.2021.S01E10.mkv',
        keep: true,
      },
      ...[2004, 2022, 2026].map((year) => ({
        isAnime: true,
        metadata: { year: 2004, yearEnd: 2024, seasonYear: 2022 },
        filename: `Shared.Show.${year}.S01E10.mkv`,
        keep: year <= 2024,
      })),
      {
        isAnime: true,
        metadata: {
          year: 2004,
          yearEnd: 2024,
          seasonYear: 2022,
          releaseYears: [2022],
        },
        filename: 'Shared.Show.2004.S01E10.mkv',
        keep: false,
      },
      {
        isAnime: false,
        metadata: { year: 2015, yearEnd: 2026 },
        filename: 'Shared.Show.2026.S01E10.mkv',
        keep: true,
      },
      {
        isAnime: false,
        metadata: { year: 2015, yearEnd: 2026, releaseYears: [2015] },
        filename: 'Shared.Show.2026.S01-S03.COMPLETE.mkv',
        keep: true,
      },
      {
        isAnime: false,
        metadata: { year: 2015, yearEnd: 2026, releaseYears: [2015] },
        filename: 'Shared.Show.2026.S01E10.mkv',
        keep: false,
      },
      {
        isAnime: false,
        metadata: { year: 2015, yearEnd: 2026 },
        filename: 'Shared.Show.2030.S01E10.mkv',
        keep: false,
      },
    ];
    for (const item of cases) {
      const context = createTestStreamContext({
        type: 'series',
        id: 'tt0108850:1:10',
        isAnime: item.isAnime,
        parsedId: {
          type: 'imdbId',
          value: 'tt0108850',
          season: '1',
          episode: '10',
        },
        getMetadata: async () => ({
          title: 'Shared Show',
          titles: [{ title: 'Shared Show' }],
          ...item.metadata,
        }),
      });
      const filter = new StreamFilterer({
        titleMatching: { enabled: true, ambiguousResults: 'discard' },
        yearMatching: { enabled: true },
      } as UserData);
      for (const idMatched of [undefined, true]) {
        const release = {
          id: 'one',
          type: 'usenet',
          filename: item.filename,
          idMatched,
          parsedFile: FileParser.parse(item.filename),
          addon: { preset: { id: 'newznab' } },
        } as ParsedStream;
        assert.equal(
          (await filter.filter([release], context)).length,
          item.keep ? 1 : 0,
          `${item.filename}, ID ${idMatched}`
        );
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
      assert.equal(releases[0].releaseYear, '1994');
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
      assert.equal(parsed.releaseYear, '1994');
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
      assert.equal(untrusted.releaseYear, undefined);
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
      assert.equal(genericIdParsed.idMatched, true);
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

  it('uses ID-search provenance for ambiguity, preserving ordinary matching settings', async (t) => {
    await initialise(t);
    t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id) => ({
      tvdbId: id,
      title: 'Shared Show',
      episodes: Array.from({ length: 30 }, (_, i) => ({
        seasonNumber: 1,
        episodeNumber: i + 1,
      })),
    }));
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
    const context = createTestStreamContext({
      type: 'series',
      id: 'tt0108850:1:10',
      isAnime: false,
      parsedId: {
        type: 'imdbId',
        value: 'tt0108850',
        season: '1',
        episode: '10',
      },
      getMetadata: async () => metadata,
    });
    const makeStream = (
      type: ParsedStream['type'],
      name: string,
      releaseIds?: ReleaseIds,
      idMatched?: boolean
    ): ParsedStream =>
      ({
        id: name,
        type,
        filename: name,
        releaseIds,
        idMatched,
        parsedFile: {
          ...FileParser.parse(name),
          languages: ['English'],
          audioTracks: [{ lang: 'English', dub: true }],
        },
        addon: { preset: { id: 'test' } },
      }) as ParsedStream;
    const options = {
      titleMatching: { enabled: true, ambiguousResults: 'discard' },
      yearMatching: { enabled: true },
      seasonEpisodeMatching: { enabled: true, strict: true },
      episodeTitleMatching: { enabled: true, similarityThreshold: 1 },
    } as UserData;
    const filter = new StreamFilterer(options);
    for (const type of [
      'usenet',
      'stremio-usenet',
      'p2p',
      'http',
      'debrid',
    ] as const) {
      for (const identity of [
        { releaseIds: { tvdbId: 72421 }, idMatched: true },
        { releaseIds: { imdbId: 'tt0108850' }, idMatched: true },
        { idMatched: true },
      ] as Partial<ParsedStream>[]) {
        const { releaseIds, idMatched } = identity;
        for (const suffix of [
          'S01E10.mkv',
          'S01E01-E76.COMPLETE',
          'S01E10-E11.mkv',
        ]) {
          const ambiguous = makeStream(
            type,
            `Shared.Show.${suffix}`,
            releaseIds,
            idMatched
          );
          ambiguous.releaseYear = '1994';
          assert.equal(
            (await filter.filter([ambiguous], context)).length,
            1,
            `${type}: ID provenance resolves ambiguity without another release or pack`
          );
          assert.equal(
            (
              await filter.filter(
                [
                  makeStream(
                    type,
                    `Shared.Show.1994.${suffix}`,
                    releaseIds,
                    idMatched
                  ),
                ],
                context
              )
            ).length,
            1,
            `${type}: a distinguishing filename year still recovers the release`
          );
        }
        assert.equal(
          (
            await filter.filter(
              [
                makeStream(
                  type,
                  'Shared.Show.S01E10.A.Real.Episode.Name.mkv',
                  releaseIds,
                  idMatched
                ),
              ],
              context
            )
          ).length,
          1,
          'a matching episode name remains usable without a filename year'
        );
        for (const name of [
          'Shared.Show.2001.S01E10.mkv',
          'Shared.Show.S01E11.mkv',
          'Other.Show.S01E10.mkv',
          'Shared.Show.S01E10.A.Wrong.Episode.Name.mkv',
          'Shared.Show.UK.S01E10.mkv',
        ])
          assert.equal(
            (
              await filter.filter(
                [makeStream(type, name, releaseIds, idMatched)],
                context
              )
            ).length,
            0,
            `${type}: ${name}`
          );
      }
      for (const releaseIds of [
        undefined,
        { tvdbId: 72421 },
        { imdbId: 'tt0108850' },
        { tvdbId: 455890 },
        { tvdbId: 72421, imdbId: 'tt1234567' },
      ])
        assert.equal(
          (
            await filter.filter(
              [makeStream(type, 'Shared.Show.S01E10.mkv', releaseIds)],
              context
            )
          ).length,
          0
        );
      for (const releaseIds of [
        { tvdbId: 455890 },
        { tvdbId: 72421, imdbId: 'tt1234567' },
      ])
        assert.equal(
          (
            await filter.filter(
              [
                makeStream(
                  type,
                  'Shared.Show.1994.S01E10.mkv',
                  releaseIds,
                  true
                ),
              ],
              context
            )
          ).length,
          0,
          'ID search does not bypass contradictory item IDs'
        );
      const wrongItemYear = makeStream(
        type,
        'Shared.Show.S01E10.mkv',
        undefined,
        true
      );
      wrongItemYear.releaseYear = '2001';
      assert.equal(
        (await filter.filter([wrongItemYear], context)).length,
        0,
        'ID search does not bypass contradictory item years'
      );
      const idSearch = makeStream(type, 'Shared.Show.S01E10.mkv');
      idSearch.idMatched = true;
      assert.equal(
        (await filter.filter([idSearch], context)).length,
        1,
        'explicit ID-search provenance is usable when item IDs are absent'
      );
      assert.equal(
        (
          await filter.filter(
            [
              makeStream(type, 'Shared.Show.1994.S01E10.mkv', {
                tvdbId: 455890,
              }),
            ],
            context
          )
        ).length,
        0,
        'known wrong ID vetoes a matching year'
      );
    }
    const marmalade = {
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
    assert.equal(
      (
        await filter.filter(
          [makeStream('usenet', pack, { tvdbId: 72421 })],
          marmalade
        )
      ).length,
      0,
      'matching item IDs alone cannot recover a keyword-search pack'
    );
    assert.equal(
      (await filter.filter([makeStream('usenet', pack)], marmalade)).length,
      0,
      'a range alone cannot defeat incomplete competitor metadata'
    );
    for (const titleMatching of [
      { enabled: false, ambiguousResults: 'discard' as const },
      { enabled: true, ambiguousResults: 'keep' as const },
      {
        enabled: true,
        ambiguousResults: 'discard' as const,
        addons: ['another-addon'],
      },
      {
        enabled: true,
        ambiguousResults: 'discard' as const,
        requestTypes: ['movie' as const],
      },
    ]) {
      const scoped = new StreamFilterer({ ...options, titleMatching });
      assert.equal(
        (
          await scoped.filter(
            [makeStream('http', 'Shared.Show.S01E10.mkv', { tvdbId: 455890 })],
            context
          )
        ).length,
        1,
        'identity checks respect matching scope'
      );
    }
    const withoutEpisodeFilter = new StreamFilterer({
      ...options,
      episodeTitleMatching: { enabled: false, similarityThreshold: 1 },
    });
    assert.equal(
      (
        await withoutEpisodeFilter.filter(
          [
            makeStream(
              'http',
              'Shared.Show.S01E10.A.Wrong.Episode.Name.mkv',
              {
                tvdbId: 72421,
              },
              true
            ),
          ],
          context
        )
      ).length,
      1,
      'ID recovery leaves the disabled episode-title filter disabled'
    );
    const excludingPacks = new StreamFilterer({
      ...options,
      excludeSeasonPacks: true,
    });
    assert.equal(
      (
        await excludingPacks.filter(
          [
            makeStream('http', 'Shared.Show.1994.S01.COMPLETE', {
              tvdbId: 72421,
            }),
          ],
          context
        )
      ).length,
      0,
      'user pack exclusion remains effective'
    );
  });
});
