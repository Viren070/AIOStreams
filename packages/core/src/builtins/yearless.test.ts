import './index.js';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';
import { BaseNabAddon } from './base/nab/addon.js';
import { KnabenAddon } from './knaben/addon.js';
import { KnabenCategory } from './knaben/api.js';
import { ProwlarrAddon } from './prowlarr/addon.js';
import { ThePirateBayAddon } from './the-pirate-bay/addon.js';
import { TheRARBGAddon } from './therarbg/addon.js';
import { TorrentGalaxyAddon } from './torrent-galaxy/addon.js';
import { EasynewsSearchAddon } from './easynews-search/addon.js';
import { EasynewsApiError } from './easynews-search/api.js';
import { getYearlessQueries } from './utils/yearless.js';

const stored = new Map<string, string>();
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const movie = { mediaType: 'movie', type: 'imdbId', value: 'tt1234567' };
const metadata = { primaryTitle: 'Example', titles: [], year: 2026 };
const item = (guid: string) => ({ guid, title: `Example ${guid}` });

before(async () => {
  mock.method(SettingsRepository, 'getAll', async () =>
    [...stored].map(([key, value]) => ({ key, value }))
  );
  mock.method(SettingsRepository, 'getVersion', async () => 0);
  mock.method(SettingsRepository, 'set', async (key: string, value: string) => {
    stored.set(key, value);
  });
  await settingsStore.initialise();
});
beforeEach(async () => {
  await settingsStore.set(
    'builtins.scrape.yearlessMovieFallback.enabled',
    true
  );
  await settingsStore.set(
    'builtins.scrape.yearlessMovieFallback.resultThreshold',
    3
  );
});
after(() => mock.restoreAll());

function nab(
  options: { paginate?: boolean; params?: string[]; force?: boolean } = {}
) {
  // Exercise the real query builder and pagination without constructing network clients.
  const addon = Object.create(BaseNabAddon.prototype);
  Object.assign(addon, {
    id: 'newznab',
    logger,
    userData: {
      url: 'https://example.test',
      forceQuerySearch: options.force ?? true,
      paginate: options.paginate ?? false,
    },
  });
  const calls: Record<string, string>[] = [];
  addon.api = {
    getCapabilities: async () => ({
      server: { title: 'Test' },
      limits: { max: 2 },
      searching: {
        search: { available: true, supportedParams: options.params ?? ['q'] },
      },
    }),
    search: async (_fn: string, params: Record<string, string>) => {
      calls.push({ ...params });
      return { results: [], total: 0 };
    },
  };
  return { addon, calls };
}

describe('yearless movie fallback', () => {
  it('preserves numbers in titles, deduplicates, and avoids already-issued queries', () => {
    assert.deepEqual(
      getYearlessQueries(
        [
          '1917 2019',
          '1917 2019',
          '2019 2019',
          'tt2019',
          'Other',
          'Other 2019',
        ],
        2019
      ),
      ['1917', '2019']
    );
  });

  for (const count of [0, 1, 2, 3, 4]) {
    it(`uses the strict threshold for ${count} initial results`, async () => {
      const { addon, calls } = nab();
      addon.api.search = async (
        _fn: string,
        params: Record<string, string>
      ) => {
        calls.push({ ...params });
        return {
          results: Array.from({ length: count }, (_, i) => item(String(i))),
          total: count,
        };
      };
      await addon.performSearch(movie, metadata);
      assert.deepEqual(
        calls.map((p) => p.q),
        count < 3 ? ['Example 2026', 'Example'] : ['Example 2026']
      );
    });
  }

  it('counts duplicates only once across alternative title queries', async () => {
    const { addon, calls } = nab();
    addon.buildQueries = () => ['Example 2026', 'Alternative 2026'];
    addon.api.search = async (_fn: string, params: Record<string, string>) => {
      calls.push({ ...params });
      return { results: [item('a'), item('b')], total: 2 };
    };
    await addon.performSearch(movie, metadata);
    assert.deepEqual(
      calls.map((p) => p.q),
      ['Example 2026', 'Alternative 2026', 'Example', 'Alternative']
    );
  });

  it('counts fetched pages before deciding to fall back', async () => {
    const { addon, calls } = nab({ paginate: true });
    addon.api.search = async (_fn: string, params: Record<string, string>) => {
      calls.push({ ...params });
      return {
        results: params.offset ? [item('c')] : [item('a'), item('b')],
        total: 3,
        offset: Number(params.offset ?? 0),
      };
    };
    const { results } = await addon.performSearch(movie, metadata);
    assert.equal(results.length, 3);
    assert.deepEqual(
      calls.map((p) => [p.q, p.offset]),
      [
        ['Example 2026', undefined],
        ['Example 2026', '2'],
      ]
    );
  });

  it('paginates the fallback using the same limits', async () => {
    const { addon, calls } = nab({ paginate: true });
    addon.api.search = async (_fn: string, params: Record<string, string>) => {
      calls.push({ ...params });
      return params.q.endsWith('2026')
        ? { results: [item('initial')], total: 1 }
        : {
            results: params.offset ? [item('c')] : [item('a'), item('b')],
            total: 3,
            offset: Number(params.offset ?? 0),
          };
    };
    const { results } = await addon.performSearch(movie, metadata);
    assert.equal(results.length, 4);
    assert.deepEqual(
      calls.map((p) => p.q),
      ['Example 2026', 'Example', 'Example']
    );
    assert.ok(calls.every((p) => p.limit === '2'));
  });

  it('retains initial results when the supplemental search fails', async () => {
    const { addon } = nab();
    addon.api.search = async (_fn: string, params: Record<string, string>) => {
      if (params.q === 'Example') throw new Error('Rate limited');
      return { results: [item('a')], total: 1 };
    };
    assert.deepEqual((await addon.performSearch(movie, metadata)).results, [
      item('a'),
    ]);
  });

  it('removes a structured year parameter while preserving the query', async () => {
    const { addon, calls } = nab({ force: false, params: ['q', 'year'] });
    await addon.performSearch(movie, metadata);
    assert.deepEqual(
      calls.map((p) => [p.q, p.year]),
      [
        ['Example', '2026'],
        ['Example', undefined],
      ]
    );
  });

  it('does not broaden ID searches', async () => {
    const { addon, calls } = nab({
      force: false,
      params: ['q', 'year', 'imdbid'],
    });
    await addon.performSearch(movie, { ...metadata, imdbId: 'tt1234567' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].imdbid, '1234567');
    assert.equal(calls[0].year, '2026');
  });

  it('does not retry series, missing years, or disabled fallback', async () => {
    for (const [id, meta] of [
      [{ ...movie, mediaType: 'series', season: '1', episode: '1' }, metadata],
      [movie, { ...metadata, year: undefined }],
    ]) {
      const { addon, calls } = nab();
      await addon.performSearch(id, meta);
      const enabledCalls = [...calls];
      calls.length = 0;
      await settingsStore.set(
        'builtins.scrape.yearlessMovieFallback.enabled',
        false
      );
      await addon.performSearch(id, meta);
      assert.deepEqual(calls, enabledCalls);
      await settingsStore.set(
        'builtins.scrape.yearlessMovieFallback.enabled',
        true
      );
    }
    await settingsStore.set(
      'builtins.scrape.yearlessMovieFallback.enabled',
      false
    );
    const { addon, calls } = nab();
    await addon.performSearch(movie, metadata);
    assert.equal(calls.length, 1);
  });

  it('retries only underfilled Prowlarr indexers', async () => {
    const addon = Object.create(ProwlarrAddon.prototype);
    const calls: { query: string; indexerIds: number[] }[] = [];
    Object.assign(addon, {
      id: 'prowlarr',
      logger,
      sources: [],
      userData: { url: 'https://example.test' },
      getIndexersByProtocol: async () => [{ id: 1 }, { id: 2 }, { id: 3 }],
      api: {
        search: async (params: { query: string; indexerIds: number[] }) => {
          calls.push(params);
          return {
            data: params.query.endsWith('2026')
              ? [
                  ...['a', 'b', 'c'].map((guid) => ({
                    ...item(guid),
                    infoHash: guid.repeat(40),
                    indexerId: 1,
                  })),
                  { ...item('a'), indexerId: 2 },
                ]
              : [],
          };
        },
      },
    });
    await addon.performSearch('torrent', movie, metadata);
    assert.deepEqual(
      calls.map((p) => p.indexerIds),
      [
        [1, 2, 3],
        [2, 3],
      ]
    );
  });

  for (const protocol of ['torrent', 'usenet']) {
    it(`Prowlarr counts only usable ${protocol} results per indexer`, async () => {
      const addon = Object.create(ProwlarrAddon.prototype);
      const calls: { query: string; indexerIds: number[] }[] = [];
      const initial = [
        ...['a', 'b', 'c'].map((id) => ({
          indexerId: 1,
          title: id,
          infoHash: 'invalid',
        })),
        ...['a', 'b', 'c'].map((id) => ({
          indexerId: 2,
          title: id,
          ...(protocol === 'torrent'
            ? { infoHash: id.repeat(40) }
            : { guid: `https://example.test/${id}.nzb` }),
        })),
        ...['a', 'b', 'c'].map((id) => ({
          indexerId: 3,
          title: id,
          downloadUrl: `https://example.test/${id}`,
        })),
        ...['a', 'b', 'c'].map((id) => ({
          indexerId: 4,
          title: id,
          guid: 'https://example.test/same',
          downloadUrl: 'https://example.test/same',
        })),
        ...['a', 'b', 'c'].map((id) => ({
          indexerId: 5,
          title: id,
          ...(protocol === 'torrent'
            ? { guid: `magnet:?xt=urn:btih:${id.repeat(40)}` }
            : { guid: `https://example.test/${id}` }),
        })),
        ...['a', 'b', 'c'].map((id) => ({
          indexerId: 6,
          title: id,
          ...(protocol === 'torrent'
            ? { magnetUrl: `https://example.test/${id}.torrent` }
            : { downloadUrl: `https://example.test/${id}.nzb` }),
        })),
      ];
      Object.assign(addon, {
        id: 'prowlarr',
        logger,
        sources: [],
        userData: { url: 'https://example.test' },
        getIndexersByProtocol: async () =>
          [1, 2, 3, 4, 5, 6].map((id) => ({ id })),
        api: {
          search: async (params: { query: string; indexerIds: number[] }) => {
            calls.push(params);
            return { data: params.query.endsWith('2026') ? initial : [] };
          },
        },
      });
      await addon.performSearch(protocol, movie, metadata);
      assert.deepEqual(
        calls.map((call) => call.indexerIds),
        [
          [1, 2, 3, 4, 5, 6],
          [1, 4],
        ]
      );
    });
  }

  for (const mode of [
    'empty',
    'duplicates',
    'enough',
    'fallback-error',
    'initial-error',
  ]) {
    it(`Easynews handles ${mode} and preserves pagination`, async () => {
      const addon = Object.create(EasynewsSearchAddon.prototype);
      const calls: { query: string; paginate: boolean }[] = [];
      const release = (hash: string) => ({
        hash,
        title: 'Example',
        size: 1000,
        posted: 0,
      });
      Object.assign(addon, {
        id: 'easynews',
        logger,
        userData: { paginate: true },
        getSearchMetadata: async () => metadata,
        api: {
          search: async (params: { query: string; paginate: boolean }) => {
            calls.push(params);
            if (
              mode === 'initial-error' ||
              (mode === 'fallback-error' && params.query === 'Example')
            ) {
              throw new EasynewsApiError('Unauthorized', 401);
            }
            return {
              downloadInfo: {},
              results:
                params.query === 'Example'
                  ? [release('b')]
                  : mode === 'empty'
                    ? []
                    : mode === 'enough'
                      ? ['a', 'b', 'c'].map(release)
                      : [release('a'), release('a')],
            };
          },
          generateNzbUrl: (item: { hash: string }) =>
            `https://example.test/${item.hash}.nzb`,
          generateEasynewsDlUrl: () => 'https://example.test/file',
          calculateAge: () => 0,
        },
      });
      if (mode === 'initial-error') {
        await assert.rejects(() => addon._searchNzbs(movie));
        assert.equal(calls.length, 1);
      } else {
        const results = await addon._searchNzbs(movie);
        assert.equal(
          results.length,
          mode === 'enough' ? 3 : mode === 'duplicates' ? 2 : 1
        );
        assert.equal(calls.length, mode === 'enough' ? 1 : 2);
        assert.ok(calls.every((call) => call.paginate));
      }
    });
  }

  for (const scenario of [
    'blacklisted',
    'invalid',
    'duplicates',
    'enough',
    'links-disabled',
    'links-enabled',
    'fallback-error',
  ]) {
    it(`Knaben threshold handles ${scenario}`, async () => {
      await settingsStore.set(
        'builtins.knaben.downloadTorrents',
        scenario === 'links-enabled'
      );
      const addon = Object.create(KnabenAddon.prototype);
      const calls: string[] = [];
      const hit = (id: string, initial: boolean) => ({
        hash:
          initial && scenario.startsWith('links-')
            ? null
            : initial && scenario === 'invalid'
              ? id
              : id.repeat(40),
        link:
          initial && scenario.startsWith('links-')
            ? `https://example.test/${id}.torrent`
            : null,
        categoryId: [
          initial && scenario === 'blacklisted'
            ? KnabenCategory.AnimeMusic
            : KnabenCategory.Movies,
        ],
        title: 'Example',
        bytes: 1000,
        seeders: 1,
      });
      Object.assign(addon, {
        id: 'knaben',
        logger,
        getSearchMetadata: async () => metadata,
        api: {
          search: async ({ query }: { query: string }) => {
            calls.push(query);
            const initial = query === 'Example 2026';
            if (!initial && scenario === 'fallback-error')
              throw new Error('Rate limited');
            return {
              hits: (initial
                ? scenario === 'duplicates'
                  ? ['a', 'a', 'a']
                  : scenario === 'fallback-error'
                    ? ['a']
                    : ['a', 'b', 'c']
                : ['d']
              ).map((id) => hit(id, initial)),
            };
          },
        },
      });
      const results = await addon._searchTorrents(movie);
      const skip = scenario === 'enough' || scenario === 'links-enabled';
      assert.deepEqual(
        calls,
        skip ? ['Example 2026'] : ['Example 2026', 'Example']
      );
      assert.equal(
        results.length,
        skip ? 3 : scenario === 'duplicates' ? 2 : 1
      );
    });
  }

  for (const Addon of [ThePirateBayAddon, TheRARBGAddon, TorrentGalaxyAddon]) {
    for (const scenario of [
      {
        name: 'IMDb alone reaches threshold',
        title: [],
        imdb: ['a', 'b', 'c'],
        fallback: false,
      },
      {
        name: 'combined results reach threshold',
        title: ['a'],
        imdb: ['b', 'c'],
        fallback: false,
      },
      {
        name: 'wrong IMDb results do not satisfy threshold',
        title: ['a', 'b', 'c'],
        imdb: [],
        fallback: true,
        resultImdbId: 'tt7654321',
      },
      {
        name: 'invalid hashes do not satisfy threshold',
        title: ['a', 'b', 'c'],
        imdb: [],
        fallback: true,
        invalidHashes: true,
      },
      {
        name: 'overlapping results stay below threshold',
        title: ['a'],
        imdb: ['a', 'b'],
        fallback: true,
      },
    ]) {
      it(`${Addon.name}: ${scenario.name}`, async () => {
        const addon = Object.create(Addon.prototype);
        const calls: string[] = [];
        Object.assign(addon, {
          id: 'test',
          logger,
          getSearchMetadata: async () => ({ ...metadata, imdbId: 'tt1234567' }),
          api: {
            search: async (arg: string | { query: string }) => {
              const query = typeof arg === 'string' ? arg : arg.query;
              calls.push(query);
              const ids =
                query === 'tt1234567'
                  ? scenario.imdb
                  : query === 'Example 2026'
                    ? scenario.title
                    : [];
              const results = ids.map((id) => ({
                hash: scenario.invalidHashes ? id : id.repeat(40),
                imdbId: scenario.resultImdbId,
                name: 'Example',
                size: 1000,
                added: 0,
                age: 0,
              }));
              return Addon === ThePirateBayAddon
                ? results
                : { results, total: results.length, pageSize: 100 };
            },
          },
        });
        await addon._searchTorrents(movie);
        assert.deepEqual(
          calls,
          scenario.fallback
            ? ['Example 2026', 'tt1234567', 'Example']
            : ['Example 2026', 'tt1234567']
        );
      });
    }

    it(`${Addon.name} starts IMDb and title searches concurrently when disabled`, async () => {
      await settingsStore.set(
        'builtins.scrape.yearlessMovieFallback.enabled',
        false
      );
      const addon = Object.create(Addon.prototype);
      const calls: string[] = [];
      let releaseTitle!: () => void;
      const titleGate = new Promise<void>((resolve) => {
        releaseTitle = resolve;
      });
      Object.assign(addon, {
        id: 'test',
        logger,
        getSearchMetadata: async () => ({ ...metadata, imdbId: 'tt1234567' }),
        api: {
          search: async (arg: string | { query: string }) => {
            const query = typeof arg === 'string' ? arg : arg.query;
            calls.push(query);
            if (query === 'Example 2026') await titleGate;
            return Addon === ThePirateBayAddon
              ? []
              : { results: [], total: 0, pageSize: 100 };
          },
        },
      });
      const pending = addon._searchTorrents(movie);
      await new Promise((resolve) => setImmediate(resolve));
      try {
        assert.deepEqual(calls, ['Example 2026', 'tt1234567']);
      } finally {
        releaseTitle();
        await pending;
      }
      assert.deepEqual(calls, ['Example 2026', 'tt1234567']);
    });
  }
});
