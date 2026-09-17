import '../streams/filterer.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { TMDBMetadata } from './tmdb.js';
import { settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';
import {
  conflictEpisodeBound,
  getConflictNumberingBounds,
  matchingReleaseSeason,
} from '../streams/title-conflict-episodes.js';
import { confirmsTitleIdentity } from '../streams/title-conflicts.js';

describe('TMDB-only competitor catalogs', () => {
  for (const failure of [
    'none',
    'wrong-id',
    'missing-season',
    'wrong-count',
    'wrong-show',
    'duplicate-episode',
    'empty-season',
    'http',
  ]) {
    it(`validates completeness and caches only success: ${failure}`, async (t) => {
      t.mock.method(SettingsRepository, 'getAll', async () => []);
      t.mock.method(SettingsRepository, 'getVersion', async () => 0);
      await settingsStore.initialise();
      const previous = getGlobalDispatcher();
      const agent = new MockAgent();
      agent.disableNetConnect();
      setGlobalDispatcher(agent);
      t.after(async () => {
        setGlobalDispatcher(previous);
        await agent.close();
      });
      const pool = agent.get('https://api.themoviedb.org');
      const id =
        98766000 +
        [
          'none',
          'wrong-id',
          'missing-season',
          'wrong-count',
          'wrong-show',
          'duplicate-episode',
          'empty-season',
          'http',
        ].indexOf(failure);
      const summary = {
        id,
        number_of_seasons: 1,
        number_of_episodes: 2,
        seasons: [{ season_number: 1, episode_count: 2 }],
      };
      const season = {
        season_number: 1,
        episodes: [1, 2].map((n) => ({
          show_id: id,
          season_number: 1,
          episode_number: n,
        })),
      };
      const broken = structuredClone(summary);
      const badSeason = structuredClone(season);
      if (failure === 'wrong-id') broken.id++;
      if (failure === 'missing-season') broken.number_of_seasons++;
      if (failure === 'wrong-count') broken.number_of_episodes++;
      if (failure === 'wrong-show') badSeason.episodes[0].show_id++;
      if (failure === 'duplicate-episode')
        badSeason.episodes[1].episode_number = 1;
      if (failure === 'empty-season') badSeason.episodes = [];
      pool
        .intercept({ path: `/3/tv/${id}?api_key=test` })
        .reply(failure === 'http' ? 400 : 200, broken);
      if (
        ['none', 'wrong-show', 'duplicate-episode', 'empty-season'].includes(
          failure
        )
      )
        pool
          .intercept({ path: `/3/tv/${id}/season/1?api_key=test` })
          .reply(200, badSeason);
      const client = new TMDBMetadata({ apiKey: 'test' });
      if (failure !== 'none') {
        await assert.rejects(client.getEpisodeCatalog(id));
        pool
          .intercept({ path: `/3/tv/${id}?api_key=test` })
          .reply(200, summary);
        pool
          .intercept({ path: `/3/tv/${id}/season/1?api_key=test` })
          .reply(200, season);
      }
      const catalog = await client.getEpisodeCatalog(id);
      assert.equal(conflictEpisodeBound(catalog), 2);
      assert.deepEqual(await client.getEpisodeCatalog(id), catalog);
      agent.assertNoPendingInterceptors();
    });
  }
  it('uses separate provider keys and still requires every competitor to be ruled out', async () => {
    const conflicts = [
      { title: 'Shared', tmdbId: 7 },
      { title: 'Shared', tvdbId: 7 },
    ];
    let calls = 0;
    const bounds = await getConflictNumberingBounds(
      conflicts,
      async () => ({
        tvdbId: 7,
        title: 'Shared',
        episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
      }),
      undefined,
      async (id) => {
        calls++;
        return {
          tmdbId: id,
          episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
        };
      }
    );
    assert.equal(calls, 1);
    assert.equal(bounds.size, 2);
    const evidence = { episode: 2, conflictNumberingBounds: bounds };
    assert.equal(
      confirmsTitleIdentity(
        { title: 'Shared', titles: [] },
        conflicts,
        evidence
      ),
      true
    );
    bounds.delete('tmdb:7');
    assert.equal(
      confirmsTitleIdentity(
        { title: 'Shared', titles: [] },
        conflicts,
        evidence
      ),
      false
    );
    const absent = await getConflictNumberingBounds(
      [{ title: 'Shared', tmdbId: 8 }],
      undefined,
      undefined,
      async () => ({
        tmdbId: 9,
        episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
      })
    );
    assert.equal(absent.size, 0);
  });
  it('uses an external season only for a matching episode or pack', () => {
    assert.equal(
      matchingReleaseSeason({ seasons: [8], episodes: [2] }, 8, 2),
      8
    );
    assert.equal(
      matchingReleaseSeason({ seasons: [8], episodes: [3] }, 8, 2),
      undefined
    );
    assert.equal(
      matchingReleaseSeason({ seasons: [8], episodes: [2] }, undefined, 2),
      undefined
    );
    assert.equal(
      matchingReleaseSeason(
        { seasons: [8], episodes: [2] },
        8,
        2,
        'Show 2-3-1.mkv'
      ),
      undefined
    );
    assert.equal(matchingReleaseSeason({ seasons: [8] }, 8, 2), 8);
  });
});

it('retains a matching high-season release with TMDB-only conflicts without accepting wrong coordinates or tags', async (t) => {
  t.mock.method(SettingsRepository, 'getAll', async () => []);
  t.mock.method(SettingsRepository, 'getVersion', async () => 0);
  await settingsStore.initialise();
  const { default: StreamFilterer } = await import('../streams/filterer.js');
  const { default: FileParser } = await import('../parser/file.js');
  const { SkyhookMetadata } = await import('./skyhook.js');
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async () => {
    assert.fail('TMDB-only conflicts must not call Skyhook');
  });
  t.mock.method(
    TMDBMetadata.prototype,
    'getSeasonBound',
    async () => undefined as unknown as number
  );
  let unavailable = false;
  t.mock.method(TMDBMetadata.prototype, 'getEpisodeCatalog', async (id) => {
    if (unavailable) throw new Error('unavailable');
    return { tmdbId: id, episodes: [{ seasonNumber: 1, episodeNumber: 1 }] };
  });
  const metadata = {
    title: 'Adventure Time',
    titles: [{ title: 'Adventure Time' }],
    year: 2010,
    country: 'US',
    seasons: [{ season_number: 8, episode_count: 27 }],
    titleConflicts: [
      { title: 'Adventure Time', year: 1959, tmdbId: 9016 },
      { title: 'Adventure Time', year: 1967, tmdbId: 33250 },
    ],
  };
  const context = {
    type: 'series',
    id: 'tt1305826:8:2',
    isAnime: false,
    parsedId: { type: 'imdbId', season: '8', episode: '2' },
    getMetadata: async () => metadata,
    getReleaseDates: async () => undefined,
    getEpisodeAirDate: async () => undefined,
    getEpisodeRuntime: async () => undefined,
    toExpressionContext: () => ({}),
  } as unknown as import('../streams/context.js').StreamContext;
  const makeStreams = () =>
    [
      'Adventure.Time.S08E02.mkv',
      'Adventure.Time.S08E03.mkv',
      'Adventure.Time.S01E02.mkv',
      'Adventure.Time.1967.S08E02.mkv',
      'Adventure.Time.JP.S08E02.mkv',
      'Adventure.Time.S08.mkv',
    ].map((filename, i) => ({
      id: String(i),
      type: 'usenet',
      filename,
      parsedFile: {
        ...FileParser.parse(filename),
        ...(i === 4 ? { country: 'JP' } : {}),
      },
      addon: { preset: { id: 'newznab' } },
    })) as import('../db/schemas.js').ParsedStream[];
  const filter = new StreamFilterer({
    tmdbApiKey: 'test',
    titleMatching: {
      enabled: true,
      mode: 'exact',
      ambiguousResults: 'discard',
    },
  } as import('../db/schemas.js').UserData);
  assert.deepEqual(
    (await filter.filter(makeStreams(), context)).map((s) => s.id),
    ['0', '5']
  );
  unavailable = true;
  assert.deepEqual(
    (await filter.filter(makeStreams(), context)).map((s) => s.id),
    []
  );
});

describe('independent TMDB season summaries', () => {
  for (const failure of [
    'none',
    'wrong-id',
    'missing-season',
    'duplicate',
    'gap',
    'http',
  ]) {
    it(`validates season evidence without requiring episode counts: ${failure}`, async (t) => {
      t.mock.method(SettingsRepository, 'getAll', async () => []);
      t.mock.method(SettingsRepository, 'getVersion', async () => 0);
      await settingsStore.initialise();
      const previous = getGlobalDispatcher();
      const agent = new MockAgent();
      agent.disableNetConnect();
      setGlobalDispatcher(agent);
      t.after(async () => {
        setGlobalDispatcher(previous);
        await agent.close();
      });
      const id =
        98767000 +
        [
          'none',
          'wrong-id',
          'missing-season',
          'duplicate',
          'gap',
          'http',
        ].indexOf(failure);
      const summary = {
        id,
        number_of_seasons: 2,
        // Deliberately inconsistent/absent episode counts must not hide seasons.
        number_of_episodes: 999,
        seasons: [
          { season_number: 0 },
          { season_number: 1, episode_count: 0 },
          { season_number: 2 },
        ],
      };
      const broken = structuredClone(summary);
      if (failure === 'wrong-id') broken.id++;
      if (failure === 'missing-season') broken.seasons.pop();
      if (failure === 'duplicate') broken.seasons[2].season_number = 1;
      if (failure === 'gap') broken.seasons[2].season_number = 3;
      const pool = agent.get('https://api.themoviedb.org');
      pool
        .intercept({ path: `/3/tv/${id}?api_key=test` })
        .reply(failure === 'http' ? 500 : 200, broken);
      const client = new TMDBMetadata({ apiKey: 'test' });
      if (failure !== 'none') {
        await assert.rejects(client.getSeasonBound(id));
        pool
          .intercept({ path: `/3/tv/${id}?api_key=test` })
          .reply(200, summary);
      }
      assert.equal(await client.getSeasonBound(id), 2);
      assert.equal(await client.getSeasonBound(id), 2);
      agent.assertNoPendingInterceptors();
    });
  }
});
