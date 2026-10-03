import '../streams/filterer.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TMDBMetadata } from './tmdb.js';
import {
  conflictEpisodeBound,
  getConflictNumberingBounds,
  matchingReleaseSeason,
} from '../streams/title-conflict-episodes.js';
import { confirmsTitleIdentity } from '../streams/title-conflicts.js';
import {
  initialiseTestSettings,
  mockHttp,
  createTestStreamContext,
} from '../../test/helpers.js';
import type { ParsedStream, UserData } from '../db/schemas.js';

describe('TMDB-only competitor catalogs', () => {
  it('keeps genre evidence but never derives bounds or fetches seasons for ongoing/unknown-status competitors', async (t) => {
    await initialiseTestSettings(t);
    const agent = mockHttp(t);
    const client = new TMDBMetadata({ apiKey: 'test' });
    for (const [offset, status] of [undefined, 'Returning Series'].entries()) {
      const id = 98768998 + offset;
      agent
        .get('https://api.themoviedb.org')
        .intercept({ path: `/3/tv/${id}?api_key=test` })
        .reply(200, {
          id,
          status,
          genres: [{ id: 35, name: 'Comedy' }],
          number_of_seasons: 1,
          number_of_episodes: 1,
          seasons: [{ season_number: 1, episode_count: 1 }],
        });
      await assert.rejects(client.getEpisodeCatalog(id));
      if (status === undefined)
        agent
          .get('https://api.themoviedb.org')
          .intercept({ path: `/3/tv/${id}?api_key=test` })
          .reply(200, {
            id,
            genres: [{ id: 35, name: 'Comedy' }],
            number_of_seasons: 1,
            number_of_episodes: 1,
            seasons: [{ season_number: 1, episode_count: 1 }],
          });
      await assert.rejects(client.getSeasonBound(id), /not known to be ended/);
      assert.deepEqual(await client.getGenres(id), ['Comedy']);
    }
    agent.assertNoPendingInterceptors();
  });
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
      await initialiseTestSettings(t);
      const agent = mockHttp(t);
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
        status: 'Ended',
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
        if (
          !['wrong-show', 'duplicate-episode', 'empty-season'].includes(failure)
        )
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
        status: 'Ended',
        episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
      }),
      undefined,
      async (id) => {
        calls++;
        return {
          tmdbId: id,
          status: 'Ended',
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
        status: 'Ended',
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
  await initialiseTestSettings(t);
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
    return {
      tmdbId: id,
      status: 'Ended',
      episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
    };
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
    getPermittedPatterns: async () => ({
      permitted: new Set<string>(),
      unrestricted: true,
    }),
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
  it('coalesces concurrent genre and season-bound reads into one summary request', async (t) => {
    await initialiseTestSettings(t);
    const agent = mockHttp(t);
    const id = 98768997;
    agent
      .get('https://api.themoviedb.org')
      .intercept({ path: `/3/tv/${id}?api_key=test` })
      .reply(200, {
        id,
        status: 'Ended',
        genres: [{ id: 35, name: 'Comedy' }],
        number_of_seasons: 1,
        seasons: [{ season_number: 1 }],
      });
    const client = new TMDBMetadata({ apiKey: 'test' });
    const [bound, genres] = await Promise.all([
      client.getSeasonBound(id),
      client.getGenres(id),
    ]);
    assert.equal(bound, 1);
    assert.deepEqual(genres, ['Comedy']);
    agent.assertNoPendingInterceptors();
  });
  for (const failure of [
    'none',
    'wrong-id',
    'missing-season',
    'duplicate',
    'gap',
    'http',
  ]) {
    it(`validates season evidence without requiring episode counts: ${failure}`, async (t) => {
      await initialiseTestSettings(t);
      const agent = mockHttp(t);
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
        status: 'Ended',
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

// Genre evidence must come from the same ID-validated summary as numbering.
describe('TMDB competitor genre evidence', () => {
  for (const mode of [
    'season-summary',
    'episode-catalog',
    'failed-season',
    'wrong-id',
    'missing-genres',
    'empty-genres',
    'malformed-genres',
  ]) {
    it(`reuses valid show facts and refreshes unusable genres: ${mode}`, async (t) => {
      await initialiseTestSettings(t);
      const agent = mockHttp(t);
      const id =
        98768000 +
        [
          'season-summary',
          'episode-catalog',
          'failed-season',
          'wrong-id',
          'missing-genres',
          'empty-genres',
          'malformed-genres',
        ].indexOf(mode);
      const summary = {
        id: mode === 'wrong-id' ? id + 1 : id,
        status: 'Ended',
        number_of_seasons: 1,
        number_of_episodes: 1,
        seasons: [{ season_number: 1, episode_count: 1 }],
        ...(mode === 'missing-genres'
          ? {}
          : {
              genres:
                mode === 'empty-genres'
                  ? []
                  : mode === 'malformed-genres'
                    ? [{ id: 35, name: null }]
                    : [{ id: 35, name: 'Comedy' }],
            }),
      };
      const pool = agent.get('https://api.themoviedb.org');
      pool.intercept({ path: `/3/tv/${id}?api_key=test` }).reply(200, summary);
      const client = new TMDBMetadata({ apiKey: 'test' });
      if (mode === 'wrong-id') {
        await assert.rejects(client.getGenres(id));
        pool.intercept({ path: `/3/tv/${id}?api_key=test` }).reply(200, {
          ...summary,
          id,
          genres: [{ id: 16, name: 'Animation' }],
        });
        assert.deepEqual(await client.getGenres(id), ['Animation']);
      } else {
        if (['episode-catalog', 'failed-season'].includes(mode)) {
          pool
            .intercept({ path: `/3/tv/${id}/season/1?api_key=test` })
            .reply(mode === 'failed-season' ? 404 : 200, {
              season_number: 1,
              episodes: [{ show_id: id, season_number: 1, episode_number: 1 }],
            });
          if (mode === 'failed-season')
            await assert.rejects(client.getEpisodeCatalog(id));
          else await client.getEpisodeCatalog(id);
        } else await client.getSeasonBound(id);
        if (['missing-genres', 'malformed-genres'].includes(mode))
          pool
            .intercept({ path: `/3/tv/${id}?api_key=test` })
            .reply(200, summary);
        assert.deepEqual(
          await client.getGenres(id),
          mode === 'empty-genres'
            ? []
            : ['missing-genres', 'malformed-genres'].includes(mode)
              ? undefined
              : ['Comedy']
        );
        assert.equal(await client.getSeasonBound(id), 1);
      }
      agent.assertNoPendingInterceptors();
    });
  }
});

describe('shared TMDB show facts', () => {
  for (const [offset, mode] of [
    'ongoing',
    'increased-counts',
    'increased-episodes',
    'status-only-ended',
  ].entries()) {
    it(`rejects a cached ended catalogue contradicted by newer show facts: ${mode}`, async (t) => {
      await initialiseTestSettings(t);
      const agent = mockHttp(t),
        id = 98769340 + offset;
      const pool = agent.get('https://api.themoviedb.org');
      const path = `/3/tv/${id}?api_key=test`;
      pool.intercept({ path }).reply(200, {
        id,
        status: 'Ended',
        number_of_seasons: 1,
        number_of_episodes: 1,
        seasons: [{ season_number: 1, episode_count: 1 }],
      });
      pool.intercept({ path: `/3/tv/${id}/season/1?api_key=test` }).reply(200, {
        season_number: 1,
        episodes: [{ show_id: id, season_number: 1, episode_number: 1 }],
      });
      const client = new TMDBMetadata({ apiKey: 'test' });
      assert.equal(conflictEpisodeBound(await client.getEpisodeCatalog(id)), 1);
      pool.intercept({ path }).reply(200, {
        id,
        status: 'Returning Series',
        original_language: 'ja',
        genres:
          mode === 'status-only-ended'
            ? undefined
            : [{ id: 16, name: 'Animation' }],
        ...(mode === 'increased-counts'
          ? {
              status: 'Ended',
              number_of_seasons: 2,
              number_of_episodes: 2,
              seasons: [
                { season_number: 1, episode_count: 1 },
                { season_number: 2, episode_count: 1 },
              ],
            }
          : {}),
        ...(mode === 'increased-episodes'
          ? {
              status: 'Ended',
              number_of_seasons: 1,
              number_of_episodes: 2,
              seasons: [{ season_number: 1, episode_count: 2 }],
            }
          : {}),
      });
      assert.equal(await client.getOriginalLanguage(id), 'ja');
      if (mode === 'status-only-ended') {
        // Independent clients cannot use a temporary per-request status veto.
        pool.intercept({ path }).reply(200, {
          id,
          status: 'Ended',
          genres: [{ id: 35, name: 'Comedy' }],
        });
        await new TMDBMetadata({ apiKey: 'test' }).getGenres(id);
      }
      await assert.rejects(
        new TMDBMetadata({ apiKey: 'test' }).getEpisodeCatalog(id),
        mode === 'ongoing'
          ? /not known to be ended/
          : mode === 'status-only-ended'
            ? /lacks coherent current numbering/
            : /contradicts current show facts/
      );
      assert.deepEqual(await client.getGenres(id), [
        mode === 'status-only-ended' ? 'Comedy' : 'Animation',
      ]);
      agent.assertNoPendingInterceptors();
    });
  }

  for (const [offset, [mode, status]] of (
    [
      ['missing', undefined],
      ['blank', ' '],
      ['malformed', { name: 'Ended' }],
      ['ongoing', 'Returning Series'],
    ] as const
  ).entries()) {
    it(`refreshes unusable numbering status and caches valid ongoing status: ${mode}`, async (t) => {
      await initialiseTestSettings(t);
      const agent = mockHttp(t),
        id = 98769303 + offset;
      const pool = agent.get('https://api.themoviedb.org');
      const path = `/3/tv/${id}?api_key=test`;
      const summary = {
        id,
        number_of_seasons: 1,
        seasons: [{ season_number: 1 }],
      };
      pool
        .intercept({ path })
        .reply(
          200,
          mode === 'ongoing' ? { id, status } : { ...summary, status }
        );
      await assert.rejects(
        new TMDBMetadata({ apiKey: 'test' }).getSeasonBound(id)
      );
      if (mode === 'ongoing') {
        const client = new TMDBMetadata({ apiKey: 'test' });
        await assert.rejects(
          client.getSeasonBound(id),
          /not known to be ended/
        );
        await assert.rejects(
          client.getEpisodeCatalog(id),
          /not known to be ended/
        );
      } else {
        pool.intercept({ path }).reply(200, { ...summary, status: 'Ended' });
        assert.equal(
          await new TMDBMetadata({ apiKey: 'test' }).getSeasonBound(id),
          1
        );
      }
      agent.assertNoPendingInterceptors();
    });
  }

  for (const [offset, [mode, genres]] of (
    [
      ['missing', undefined],
      ['malformed', [{ id: 35, name: null }]],
      ['blank', [{ id: 35, name: ' ' }]],
    ] as const
  ).entries()) {
    it(`refreshes incomplete genre data on a later client: ${mode}`, async (t) => {
      await initialiseTestSettings(t);
      const agent = mockHttp(t);
      const id = 98769100 + offset;
      const pool = agent.get('https://api.themoviedb.org');
      pool
        .intercept({ path: `/3/tv/${id}?api_key=test` })
        .reply(200, { id, genres });
      assert.equal(
        await new TMDBMetadata({ apiKey: 'test' }).getGenres(id),
        undefined
      );
      pool.intercept({ path: `/3/tv/${id}?api_key=test` }).reply(200, {
        id,
        genres: [{ id: 16, name: 'Animation' }],
      });
      assert.deepEqual(
        await new TMDBMetadata({ apiKey: 'test' }).getGenres(id),
        ['Animation']
      );
      agent.assertNoPendingInterceptors();
    });
  }

  it('evaluates concurrent cache requirements independently before sharing a refresh', async (t) => {
    await initialiseTestSettings(t);
    const agent = mockHttp(t);
    const id = 98769102;
    const pool = agent.get('https://api.themoviedb.org');
    const summary = {
      id,
      status: 'Ended',
      number_of_seasons: 1,
      seasons: [{ season_number: 1 }],
    };
    pool.intercept({ path: `/3/tv/${id}?api_key=test` }).reply(200, summary);
    assert.equal(
      await new TMDBMetadata({ apiKey: 'test' }).getSeasonBound(id),
      1
    );
    pool
      .intercept({ path: `/3/tv/${id}?api_key=test` })
      .reply(200, { ...summary, original_language: 'ko' });
    const client = new TMDBMetadata({ apiKey: 'test' });
    const [bound, language] = await Promise.all([
      client.getSeasonBound(id),
      client.getOriginalLanguage(id),
    ]);
    assert.equal(bound, 1);
    assert.equal(language, 'ko');
    agent.assertNoPendingInterceptors();
  });

  it('retains independent facts on a partial refresh without borrowing an ended status for new numbering', async (t) => {
    await initialiseTestSettings(t);
    const agent = mockHttp(t);
    const id = 98769103;
    const pool = agent.get('https://api.themoviedb.org');
    const path = `/3/tv/${id}?api_key=test`;
    pool.intercept({ path }).reply(200, {
      id,
      status: 'Ended',
      number_of_seasons: 1,
      seasons: [{ season_number: 1 }],
    });
    const client = new TMDBMetadata({ apiKey: 'test' });
    assert.equal(await client.getSeasonBound(id), 1);
    pool.intercept({ path }).reply(200, { id, original_language: 'ko' });
    assert.equal(await client.getOriginalLanguage(id), 'ko');
    assert.equal(await client.getSeasonBound(id), 1);
    pool.intercept({ path }).reply(200, {
      id,
      genres: [{ id: 16, name: 'Animation' }],
      number_of_seasons: 2,
      seasons: [{ season_number: 1 }, { season_number: 2 }],
    });
    assert.deepEqual(await client.getGenres(id), ['Animation']);
    assert.equal(await client.getOriginalLanguage(id), 'ko');
    // A missing status permits one refresh, but cannot borrow the old status.
    pool.intercept({ path }).reply(200, {
      id,
      number_of_seasons: 2,
      seasons: [{ season_number: 1 }, { season_number: 2 }],
    });
    await assert.rejects(client.getSeasonBound(id), /not known to be ended/);
    agent.assertNoPendingInterceptors();
  });

  for (const [offset, [status, mode]] of (
    [
      ['Returning Series', 'bound'],
      [undefined, 'bound'],
      ['Returning Series', 'filter'],
    ] as const
  ).entries()) {
    it(`never promotes nonfinal cached counts with an ended status-only refresh: ${status ?? 'unknown'}, ${mode}`, async (t) => {
      await initialiseTestSettings(t);
      const agent = mockHttp(t);
      const id = 98769400 + offset;
      const pool = agent.get('https://api.themoviedb.org');
      const path = `/3/tv/${id}?api_key=test`;
      pool.intercept({ path }).reply(200, {
        id,
        status,
        original_language: 'ja',
        number_of_seasons: 1,
        seasons: [{ season_number: 1 }],
      });
      const first = new TMDBMetadata({ apiKey: 'test' });
      assert.equal(await first.getOriginalLanguage(id), 'ja');
      pool.intercept({ path }).reply(200, {
        id,
        status: 'Ended',
        genres: [{ id: 35, name: 'Comedy' }],
      });
      assert.deepEqual(await first.getGenres(id), ['Comedy']);
      // The next request has no access to the first client's temporary veto.
      const next = new TMDBMetadata({ apiKey: 'test' });
      pool.intercept({ path }).reply(200, { id, status: 'Ended' });
      if (mode === 'bound') await assert.rejects(next.getSeasonBound(id));
      else {
        const { default: StreamFilterer } =
          await import('../streams/filterer.js');
        const { default: FileParser } = await import('../parser/file.js');
        const filename = 'Shared.Show.S03.mkv';
        const context = createTestStreamContext({
          type: 'series',
          id: 'tt0108850:3:5',
          isAnime: false,
          parsedId: {
            type: 'imdbId',
            value: 'tt0108850',
            season: '3',
            episode: '5',
          },
          getMetadata: async () => ({
            title: 'Shared Show',
            titles: [{ title: 'Shared Show' }],
            year: 1998,
            country: 'US',
            seasons: [{ season_number: 3, episode_count: 5 }],
            titleConflicts: [
              { title: 'Shared Show', tmdbId: id, year: 2020, country: 'US' },
            ],
          }),
        });
        const filter = new StreamFilterer({
          tmdbApiKey: 'test',
          titleMatching: {
            enabled: true,
            mode: 'exact',
            ambiguousResults: 'discard',
          },
        } as UserData);
        assert.equal(
          (
            await filter.filter(
              [
                {
                  id: 'release',
                  type: 'usenet',
                  filename,
                  parsedFile: FileParser.parse(filename),
                  addon: { preset: { id: 'newznab' } },
                } as ParsedStream,
              ],
              context
            )
          ).length,
          0
        );
      }
      assert.equal(await next.getOriginalLanguage(id), 'ja');
      assert.deepEqual(await next.getGenres(id), ['Comedy']);
      agent.assertNoPendingInterceptors();
    });
  }

  it('shares one HTTP response across language, genres, seasons and the episode catalog', async (t) => {
    await initialiseTestSettings(t);
    const agent = mockHttp(t);
    const id = 98769001;
    const pool = agent.get('https://api.themoviedb.org');
    pool.intercept({ path: `/3/tv/${id}?api_key=test` }).reply(200, {
      id,
      status: 'Ended',
      original_language: 'ko',
      genres: [{ id: 35, name: 'Comedy' }],
      number_of_seasons: 1,
      number_of_episodes: 1,
      seasons: [{ season_number: 1, episode_count: 1 }],
    });
    pool.intercept({ path: `/3/tv/${id}/season/1?api_key=test` }).reply(200, {
      season_number: 1,
      episodes: [{ show_id: id, season_number: 1, episode_number: 1 }],
    });
    const client = new TMDBMetadata({ apiKey: 'test' });
    const [language, genres, season, catalog] = await Promise.all([
      client.getOriginalLanguage(id),
      client.getGenres(id),
      client.getSeasonBound(id),
      client.getEpisodeCatalog(id),
    ]);
    assert.equal(language, 'ko');
    assert.deepEqual(genres, ['Comedy']);
    assert.equal(season, 1);
    assert.equal(conflictEpisodeBound(catalog), 1);
    agent.assertNoPendingInterceptors();
  });

  it('keeps language and genres usable when episode and season information is missing', async (t) => {
    await initialiseTestSettings(t);
    const agent = mockHttp(t);
    const id = 98769002;
    agent
      .get('https://api.themoviedb.org')
      .intercept({ path: `/3/tv/${id}?api_key=test` })
      .reply(200, {
        id,
        status: 'Ended',
        original_language: 'ko',
        genres: [{ id: 35, name: 'Comedy' }],
      });
    const client = new TMDBMetadata({ apiKey: 'test' });
    const [language, genres, season, catalog] = await Promise.allSettled([
      client.getOriginalLanguage(id),
      client.getGenres(id),
      client.getSeasonBound(id),
      client.getEpisodeCatalog(id),
    ]);
    assert.deepEqual(language, { status: 'fulfilled', value: 'ko' });
    assert.deepEqual(genres, { status: 'fulfilled', value: ['Comedy'] });
    assert.equal(season.status, 'rejected');
    assert.equal(catalog.status, 'rejected');
    assert.equal(await client.getOriginalLanguage(id), 'ko');
    assert.deepEqual(await client.getGenres(id), ['Comedy']);
    agent.assertNoPendingInterceptors();
  });
});
