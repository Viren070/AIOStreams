import './filterer.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  animationFromGenres,
  confirmsTitleIdentity,
  getConflictAnimationTypes,
} from './title-conflicts.js';
import { parseNabReleaseMedium } from '../builtins/base/nab/addon.js';
import { BaseNabApi } from '../builtins/base/nab/api.js';
import { NewznabAddon } from '../builtins/newznab/addon.js';
import { TorznabAddon } from '../builtins/torznab/addon.js';
import { BuiltinStreamParser } from '../presets/builtin.js';
import StreamParser from '../parser/streams.js';
import StreamFilterer from './filterer.js';
import FileParser from '../parser/file.js';
import { SkyhookMetadata } from '../metadata/skyhook.js';
import { TMDBMetadata } from '../metadata/tmdb.js';
import { RegexAccess } from '../utils/regex-access.js';
import { DistributedLock } from '../utils/distributed-lock.js';
import type { Addon, ParsedStream, UserData } from '../db/schemas.js';
import type { StreamContext } from './context.js';
import {
  initialiseTestSettings,
  mockHttp,
  createTestStreamContext,
} from '../../test/helpers.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const conflicts = [
  { title: 'Shared Show', year: 2001, country: 'US', tvdbId: 455890 },
  { title: 'Shared Show', year: 2001, country: 'US', tmdbId: 96475 },
];
const metadata = {
  title: 'Shared Show',
  titles: [{ title: 'Shared Show' }],
  year: 1994,
  country: 'US',
  originalLanguage: 'en',
  genres: ['Animation', 'Comedy'],
  absoluteEpisode: 10,
  seasons: [{ season_number: 1, episode_count: 76 }],
  episodeTitles: [{ title: 'A Real Episode Name' }],
  titleConflicts: conflicts,
};
function contextFor(data = metadata, isAnime = false): StreamContext {
  return createTestStreamContext({
    type: 'series',
    id: 'tt0108850:1:10',
    isAnime,
    parsedId: {
      type: 'imdbId',
      value: 'tt0108850',
      season: '1',
      episode: '10',
    },
    getMetadata: async () => data,
  });
}
const options = {
  tmdbApiKey: 'test',
  titleMatching: { enabled: true, mode: 'exact', ambiguousResults: 'discard' },
  yearMatching: { enabled: true },
  seasonEpisodeMatching: { enabled: true, strict: true },
  episodeTitleMatching: { enabled: true, similarityThreshold: 1 },
} as UserData;
async function initialise(t: any) {
  await initialiseTestSettings(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id) => ({
    tvdbId: id,
    status: 'Ended',
    genres: ['Comedy', 'Drama'],
    episodes: Array.from({ length: 30 }, (_, i) => ({
      seasonNumber: 1,
      episodeNumber: i + 1,
    })),
  }));
  t.mock.method(TMDBMetadata.prototype, 'getEpisodeCatalog', async (id) => ({
    tmdbId: id,
    status: 'Ended',
    episodes: Array.from({ length: 30 }, (_, i) => ({
      seasonNumber: 1,
      episodeNumber: i + 1,
    })),
  }));
  t.mock.method(TMDBMetadata.prototype, 'getGenres', async () => [
    'Comedy',
    'Drama',
  ]);
}

describe('independent indexed content medium', () => {
  it('uses only the explicit item TV/Anime category, never broad TV or presentation tags', () => {
    assert.equal(
      parseNabReleaseMedium({ category: '5000,5070,5070' }),
      'animation'
    );
    for (const attrs of [
      {},
      { category: '5000,5030,5040,5080' },
      { category: 'anime' },
      { category: '50700' },
      { category: '5.07e3' },
      { query: 'cat=5070' },
      { genre: 'Animation' },
    ])
      assert.equal(parseNabReleaseMedium(attrs), undefined);
    assert.equal(animationFromGenres([' Comedy ', 'Animation']), true);
    assert.equal(animationFromGenres(['Comedy', 'Drama']), false);
    assert.equal(animationFromGenres(['Anime']), true);
    for (const genres of [
      undefined,
      null,
      [],
      [''],
      ['Comedy', null],
      'Animation',
    ])
      assert.equal(animationFromGenres(genres), undefined);
  });

  it('requires each competitor to be excluded and preserves explicit contradictions', () => {
    const evidence = {
      releaseMedium: 'animation' as const,
      conflictAnimationTypes: new Map<number | string, boolean>([
        [455890, false],
        ['tmdb:96475', false],
      ]),
    };
    assert.equal(confirmsTitleIdentity(metadata, conflicts, evidence), true);
    for (const extra of [
      { year: '2001' },
      { country: 'JP' },
      { releaseYear: '2001' },
    ])
      assert.equal(
        confirmsTitleIdentity(metadata, conflicts, { ...evidence, ...extra }),
        false
      );
    for (const genres of [undefined, [], ['Comedy']])
      assert.equal(
        confirmsTitleIdentity({ ...metadata, genres }, conflicts, evidence),
        false
      );
    for (const types of [
      new Map([[455890, false]]),
      new Map<number | string, boolean>([
        [455890, false],
        ['tmdb:96475', true],
      ]),
    ])
      assert.equal(
        confirmsTitleIdentity(metadata, conflicts, {
          ...evidence,
          conflictAnimationTypes: types,
        }),
        false
      );
    assert.equal(
      confirmsTitleIdentity(metadata, conflicts, {
        ...evidence,
        releaseMedium: undefined,
      }),
      false
    );
    assert.equal(
      confirmsTitleIdentity(
        metadata,
        [...conflicts, { title: 'Unknown' }],
        evidence
      ),
      false
    );
    assert.equal(
      confirmsTitleIdentity(metadata, conflicts, {
        ...evidence,
        conflictAnimationTypes: new Map([[455890, false]]),
        country: 'US',
      }),
      false,
      'same country/language adds no evidence for the remaining competitor'
    );
  });

  it('deduplicates lookups, separates ID namespaces and rejects missing or conflicting classifications', async (t) => {
    const calls: number[] = [];
    const other = [
      { title: 'Shared', tvdbId: 7 },
      { title: 'Shared', tmdbId: 7 },
      { title: 'Shared', tvdbId: 7 },
      { title: 'Shared', tvdbId: 8, tmdbId: 9 },
      { title: 'Shared', tvdbId: 10 },
      { title: 'Shared', tvdbId: 11 },
    ];
    const actual = await getConflictAnimationTypes(
      other,
      async (id) => {
        calls.push(id);
        if (id === 10) throw new Error('unavailable');
        return id === 11 ? [] : ['Comedy'];
      },
      async (id) => (id === 9 ? ['Animation'] : ['Comedy'])
    );
    assert.deepEqual(
      actual,
      new Map<number | string, boolean>([
        [7, false],
        ['tmdb:7', false],
      ])
    );
    assert.deepEqual(
      calls.sort((a, b) => a - b),
      [7, 8, 10, 11]
    );
    t.mock.method(SkyhookMetadata.prototype, 'getShow', async () => ({
      tvdbId: 99,
      genres: ['Comedy'],
    }));
    assert.equal(
      (await getConflictAnimationTypes([{ title: 'Shared', tvdbId: 98 }])).size,
      0
    );
  });

  it('carries both logged Althub episodes through either Nab feed and admits each alone without a pack, ID or year', async (t) => {
    await initialise(t);
    t.mock.method(
      DistributedLock.getInstance(),
      'withLock',
      async (_key, fn) => ({ result: await fn() })
    );
    const agent = mockHttp(t);
    const data = {
      ...metadata,
      title: 'Marmalade Boy',
      titles: [{ title: 'Marmalade Boy' }],
    };
    for (const namespace of ['newznab', 'torznab'] as const) {
      const origin = `https://${namespace}.release-medium.test`;
      const filenames = [
        '[Xanth] Marmalade Boy 10 DVDrip dual x264 10b [A44BF6C9]',
        '[xPearse] Marmalade Boy - Episode 10 [English] [Dual-Audio] [480p]',
      ];
      const xml = `<rss xmlns:${namespace}="urn:test"><channel>${filenames
        .map(
          (filename, i) => `<item><title>${filename}</title><guid>${i}</guid>
        <enclosure url="${origin}/${i}" type="${namespace === 'newznab' ? 'application/x-nzb' : 'application/x-bittorrent'}" length="266066381"/>
        <${namespace}:attr name="category" value="5000"/><${namespace}:attr name="category" value="5070"/>
        <${namespace}:attr name="infohash" value="${String(i).repeat(40)}"/>
        </item>`
        )
        .join('')}</channel></rss>`;
      agent
        .get(origin)
        .intercept({ path: /^\/api\?/ })
        .reply(200, xml);
      const api = new BaseNabApi(namespace, logger as any, origin);
      const response = await api.search('search', { q: 'marmalade boy' });
      assert.deepEqual(
        await api.search('search', { q: 'marmalade boy' }),
        response
      );
      const addon = Object.create(
        namespace === 'newznab'
          ? NewznabAddon.prototype
          : TorznabAddon.prototype
      );
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
      assert.equal(releases.length, 2);
      const addonInfo = {
        instanceId: 'test',
        name: 'Test',
        preset: { id: namespace },
      } as Addon;
      for (const release of releases) {
        assert.equal(release.releaseMedium, 'animation');
        assert.equal(release.releaseIds, undefined);
        assert.equal(release.releaseYear, undefined);
        const raw = addon._createStream(
          {
            ...release,
            file: { name: release.title, size: release.size, index: -1 },
          },
          'tt0108850:1:10',
          {}
        );
        const parsed = new BuiltinStreamParser(addonInfo).parse({ ...raw });
        assert.ok(!('skip' in parsed));
        assert.equal(parsed.releaseMedium, 'animation');
        assert.equal(
          (
            await new StreamFilterer(options).filter(
              [parsed],
              contextFor(data, true)
            )
          ).length,
          1,
          release.title
        );
        const untrusted = new StreamParser({
          ...addonInfo,
          preset: { id: 'generic' },
        } as Addon).parse({ ...raw });
        assert.ok(!('skip' in untrusted));
        assert.equal(untrusted.releaseMedium, undefined);
      }
    }
    agent.assertNoPendingInterceptors();
  });

  it('works for other animated series and stream types, while preserving strict episode, ID and title checks', async (t) => {
    await initialise(t);
    const make = (
      filename = 'Shared.Show.S01E10.mkv',
      extra: Partial<ParsedStream> = {}
    ) =>
      ({
        id: 'one',
        type: 'usenet',
        filename,
        parsedFile: FileParser.parse(filename),
        releaseMedium: 'animation',
        addon: { preset: { id: 'newznab' } },
        ...extra,
      }) as ParsedStream;
    const filter = new StreamFilterer(options);
    for (const type of [
      'usenet',
      'stremio-usenet',
      'p2p',
      'http',
      'debrid',
    ] as const)
      for (const filename of [
        'Shared.Show.S01E10.mkv',
        'Shared.Show.S01E01-E76.COMPLETE',
      ])
        assert.equal(
          (await filter.filter([make(filename, { type })], contextFor()))
            .length,
          1,
          'medium evidence still recovers episodes and packs without IDs or years'
        );
    for (const stream of [
      make(undefined, { releaseMedium: undefined }),
      make('Other.Show.S01E10.mkv'),
      make('Shared.Show.S01E11.mkv'),
      make('Shared.Show.2001.S01E10.mkv'),
      make(undefined, { releaseYear: '2001' }),
      make(undefined, { releaseIds: { imdbId: 'tt1234567' } }),
      make(undefined, {
        parsedFile: {
          ...FileParser.parse('Shared.Show.S01E10.mkv'),
          country: 'JP',
        },
      }),
      make(undefined, {
        parsedFile: {
          ...FileParser.parse('Shared.Show.S01E10.mkv'),
          episodeTitle: 'A Different Event',
        },
      }),
    ])
      assert.equal(
        (await filter.filter([stream], contextFor())).length,
        0,
        stream.filename
      );
    t.mock.method(TMDBMetadata.prototype, 'getGenres', async () => [
      'Animation',
    ]);
    assert.equal(
      (
        await filter.filter(
          [
            make(undefined, {
              releaseIds: { imdbId: 'tt0108850' },
              releaseYear: '1994',
            }),
          ],
          contextFor()
        )
      ).length,
      0,
      'another animated series remains ambiguous despite matching indexer IDs and year'
    );
    t.mock.method(TMDBMetadata.prototype, 'getGenres', async () => undefined);
    assert.equal(
      (await filter.filter([make()], contextFor())).length,
      0,
      'missing classification remains ambiguous'
    );
  });

  it('avoids genre lookups when matching is off, keep mode applies, or the addon/request is outside scope', async (t) => {
    await initialise(t);
    t.mock.method(TMDBMetadata.prototype, 'getGenres', async () =>
      assert.fail('unnecessary genre lookup')
    );
    for (const titleMatching of [
      { enabled: false },
      { enabled: true, ambiguousResults: 'keep' },
      { enabled: true, ambiguousResults: 'discard', addons: ['easynews'] },
      { enabled: true, ambiguousResults: 'discard', requestTypes: ['movie'] },
    ]) {
      const stream = {
        id: 'one',
        type: 'usenet',
        filename: 'Shared.Show.S01E10.mkv',
        parsedFile: FileParser.parse('Shared.Show.S01E10.mkv'),
        releaseMedium: 'animation',
        addon: { preset: { id: 'newznab' } },
      } as ParsedStream;
      assert.equal(
        (
          await new StreamFilterer({
            ...options,
            titleMatching,
          } as UserData).filter([stream], contextFor())
        ).length,
        1
      );
    }
  });
});
