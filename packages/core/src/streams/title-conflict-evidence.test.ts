import './filterer.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SkyhookMetadata } from '../metadata/skyhook.js';
import { TVDBMetadata } from '../metadata/tvdb.js';
import { TMDBMetadata } from '../metadata/tmdb.js';
import {
  createConflictLookupBudget,
  resolveConflictEvidence,
} from './title-conflict-evidence.js';
import {
  conflictEpisodeBound,
  getConflictNumberingBounds,
} from './title-conflict-episodes.js';
import type { ParsedStream } from '../db/schemas.js';
import type { UserData } from '../db/schemas.js';
import StreamFilterer from './filterer.js';
import FileParser from '../parser/file.js';
import {
  getStreamTitleConflicts,
  titleConflictKey,
} from './title-conflicts.js';
import { RegexAccess } from '../utils/regex-access.js';
import {
  initialiseTestSettings,
  createTestStreamContext,
  mockHttp,
} from '../../test/helpers.js';

const stream = {
  filename: 'Shared.Show.S01E10.mkv',
  parsedFile: {
    title: 'Shared Show',
    episodeTitle: 'A Distinctive Episode Name',
    mediaInfoQuality: 'indexer',
    audioTracks: [{ lang: 'ja', original: true }],
  },
  releaseMedium: 'animation',
  addon: { preset: { id: 'newznab' } },
} as ParsedStream;
const metadata = {
  title: 'Shared Show',
  tvdbId: 1,
  originalLanguage: 'ja',
  genres: ['Animation'],
};
const args = {
  metadata,
  streams: [stream],
  titleConflicts: new Map([
    ['sharedshow', [{ title: 'Shared Show', tvdbId: 2 }]],
  ]),
  titleKey: () => 'sharedshow',
  releaseEpisode: () => 10,
  releaseSeason: () => 1,
  auth: {},
  budgetMs: 20,
};
async function initialise(t: any) {
  await initialiseTestSettings(t);
}

describe('bounded competitor evidence resolution', () => {
  it('skips competitor enrichment when ID-search evidence already resolves identity', async (t) => {
    await initialise(t);
    const show = t.mock.method(
      SkyhookMetadata.prototype,
      'getShow',
      async () => {
        throw new Error('unexpected enrichment');
      }
    );
    const result = await resolveConflictEvidence({
      ...args,
      hasIdMatch: () => true,
    });
    assert.equal(show.mock.callCount(), 0);
    assert.equal(result.numberingBounds.size, 0);
    assert.equal(result.episodeTitles.size, 0);
  });

  it(
    'bounds stalled lookups, aborts requests, and shares a single show read across evidence paths',
    { timeout: 2000 },
    async (t) => {
      await initialise(t);
      const calls: number[] = [];
      const signals: AbortSignal[] = [];
      t.mock.method(
        SkyhookMetadata.prototype,
        'getShow',
        async (id, signal) => {
          calls.push(id);
          signals.push(signal!);
          if (id === 1)
            return {
              tvdbId: 1,
              title: 'Shared Show',
              status: 'Ended',
              episodes: [
                {
                  seasonNumber: 1,
                  episodeNumber: 1,
                  title: 'A Distinctive Episode Name',
                },
              ],
            };
          return new Promise<never>(() => {});
        }
      );
      const result = await resolveConflictEvidence(args);
      assert.equal(result.numberingBounds.size, 0);
      assert.equal(result.originalLanguages.size, 0);
      assert.equal(result.animationTypes.size, 0);
      assert.equal(result.episodeTitles.size, 0);
      assert.deepEqual(calls.sort(), [1, 2]);
      assert.ok(
        signals.every((signal) => signal === signals[0] && signal.aborted)
      );
    }
  );

  it(
    'retains known competitor names when the requested catalog times out',
    { timeout: 2000 },
    async (t) => {
      await initialise(t);
      t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id) =>
        id === 1
          ? new Promise<never>(() => {})
          : {
              tvdbId: id,
              title: 'Shared Show',
              status: 'Continuing',
              episodes: [
                { seasonNumber: 1, episodeNumber: 1, title: 'Homecoming' },
              ],
            }
      );
      const result = await resolveConflictEvidence(args);
      assert.equal(result.episodeTitles.size, 0);
      assert.deepEqual(result.conflictEpisodeTitles.get(2), ['homecoming']);
      assert.equal(result.numberingBounds.size, 0);
    }
  );

  it(
    'retains completed audio and genre evidence when catalog lookups run out of time',
    { timeout: 2000 },
    async (t) => {
      await initialise(t);
      const show = t.mock.method(
        SkyhookMetadata.prototype,
        'getShow',
        async (id) => ({
          tvdbId: id,
          title: 'Shared Show',
          originalLanguage: 'ko',
          genres: ['Comedy'],
          // Missing episodes cannot supply numbering or episode-name evidence.
          episodes: [],
        })
      );
      const bound = t.mock.method(
        TMDBMetadata.prototype,
        'getSeasonBound',
        async () => new Promise<never>(() => {})
      );
      t.mock.method(
        TMDBMetadata.prototype,
        'getOriginalLanguage',
        async () => 'ko'
      );
      t.mock.method(TMDBMetadata.prototype, 'getGenres', async () => [
        'Comedy',
      ]);
      const result = await resolveConflictEvidence({
        ...args,
        titleConflicts: new Map([
          ['sharedshow', [{ title: 'Shared Show', tvdbId: 2, tmdbId: 2 }]],
        ]),
        auth: { tmdbApiKey: 'test' },
      });
      assert.equal(result.numberingBounds.size, 0);
      assert.equal(result.originalLanguages.get(2), 'ko');
      assert.equal(result.animationTypes.get(2), false);
      assert.equal(bound.mock.callCount(), 1);
      assert.equal(
        show.mock.calls.filter(({ arguments: [id] }) => id === 2).length,
        1
      );
    }
  );

  it('does not fetch details for empty conflict maps or out-of-scope addons', async (t) => {
    await initialise(t);
    const show = t.mock.method(
      SkyhookMetadata.prototype,
      'getShow',
      async () => {
        throw new Error('must not fetch');
      }
    );
    const titleKey = t.mock.fn(() => {
      throw new Error('must not match a title');
    });
    for (const titleConflicts of [new Map(), new Map([['sharedshow', []]])]) {
      const result = await resolveConflictEvidence({
        ...args,
        titleConflicts,
        titleKey,
      });
      assert.ok(Object.values(result).every((map) => map.size === 0));
    }
    await resolveConflictEvidence({
      ...args,
      addons: ['another-addon'],
      titleKey,
    });
    assert.equal(titleKey.mock.callCount(), 0);
    assert.equal(show.mock.callCount(), 0);
  });

  it('does not treat an ongoing or unknown-status catalog as a final upper bound', () => {
    const catalog = {
      episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
    };
    for (const status of [
      undefined,
      'Continuing',
      'Returning Series',
      'In Production',
      'unknown',
      '',
    ])
      assert.equal(conflictEpisodeBound({ ...catalog, status }), undefined);
    for (const status of ['Ended', 'Canceled', 'cancelled'])
      assert.equal(conflictEpisodeBound({ ...catalog, status }), 1);
  });

  it('does not override a known open series with another provider’s cached upper bound', async () => {
    let fallbacks = 0;
    const bounds = await getConflictNumberingBounds(
      [{ title: 'Shared Show', tvdbId: 2, tmdbId: 2 }],
      async () => ({
        tvdbId: 2,
        title: 'Shared Show',
        status: 'Continuing',
        episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
      }),
      async () => {
        fallbacks++;
        return undefined;
      },
      undefined,
      async () => 1
    );
    assert.equal(bounds.size, 0);
    assert.equal(fallbacks, 0, 'open status blocks the full fallback catalog');
  });
});

it('checks known conflicts for fuzzy and contains titles without weakening title matching', async (t) => {
  await initialise(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id) => ({
    tvdbId: id,
    title: 'Shared Show',
    status: 'Ended',
    episodes: Array.from({ length: 30 }, (_, i) => ({
      seasonNumber: 1,
      episodeNumber: i + 1,
    })),
  }));
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
    getMetadata: async () => ({
      ...metadata,
      year: 1994,
      titleConflicts: [{ title: 'Shared Show', tvdbId: 2, year: 2001 }],
      titles: [{ title: 'Shared Show' }],
    }),
  });
  for (const [mode, title] of [
    ['contains', 'Shared.Show.Extra'],
    ['exact', 'Shaerd.Show'],
  ] as const) {
    const make = (releaseIds?: ParsedStream['releaseIds'], year?: number) => {
      const filename = `${title}${year ? `.${year}` : ''}.S01E10.mkv`;
      return {
        id: title,
        filename,
        type: 'usenet',
        parsedFile: FileParser.parse(filename),
        releaseIds,
        addon: { preset: { id: 'newznab' } },
      } as ParsedStream;
    };
    const options = {
      titleMatching: {
        enabled: true,
        mode,
        similarityThreshold: 0.8,
        ambiguousResults: 'discard',
      },
    } as UserData;
    assert.equal(
      (await new StreamFilterer(options).filter([make()], context)).length,
      0,
      mode
    );
    assert.equal(
      (
        await new StreamFilterer(options).filter(
          [{ ...make(), idMatched: true }],
          context
        )
      ).length,
      1,
      `${mode}: ID search still needs ordinary title matching`
    );
    assert.equal(
      (await new StreamFilterer(options).filter([make({ tvdbId: 1 })], context))
        .length,
      0,
      `${mode}: matching item IDs alone do not bypass the normalized conflict key`
    );
    assert.equal(
      (
        await new StreamFilterer(options).filter(
          [make({ tvdbId: 1 }, 1994)],
          context
        )
      ).length,
      1,
      `${mode}: a distinguishing filename year remains usable`
    );
    assert.equal(
      (
        await new StreamFilterer({
          ...options,
          titleMatching: { ...options.titleMatching, ambiguousResults: 'keep' },
        }).filter([make()], context)
      ).length,
      1,
      mode
    );
  }
});

describe('independent season evidence and resolver cleanup', () => {
  it('preserves TVDB’s validated ongoing status and rejects an older TMDB bound', async (t) => {
    await initialise(t);
    t.mock.method(SkyhookMetadata.prototype, 'getShow', async () => null);
    t.mock.method(TMDBMetadata.prototype, 'getSeasonBound', async () => 1);
    t.mock.method(TVDBMetadata.prototype as any, 'ensureToken', async () => {});
    const client = new TVDBMetadata({ apiKey: 'test' });
    t.mock.method(
      Object.getPrototypeOf((client as any).api),
      'request',
      async (_path: string, options: any) =>
        options.schema.parse({
          status: 'success',
          data: {
            series: {
              id: 98769003,
              name: 'Shared Show',
              status: { name: 'Continuing' },
            },
            episodes: [{ seasonNumber: 1, number: 1 }],
          },
          links: { next: '?page=1', total_items: 2 },
        })
    );
    const result = await resolveConflictEvidence({
      ...args,
      streams: [
        {
          ...stream,
          parsedFile: { title: 'Shared Show' },
          releaseMedium: undefined,
        } as ParsedStream,
      ],
      auth: { tvdbApiKey: 'test', tmdbApiKey: 'test' },
      titleConflicts: new Map([
        [
          'sharedshow',
          [{ title: 'Shared Show', tvdbId: 98769003, tmdbId: 98769003 }],
        ],
      ]),
    });
    assert.equal(result.numberingBounds.size, 0);
  });

  it('retains a cached HTTP season summary when full episode loading consumes the deadline', async (t) => {
    await initialise(t);
    const agent = mockHttp(t);
    const id = 98769004;
    const pool = agent.get('https://api.themoviedb.org');
    pool.intercept({ path: `/3/tv/${id}?api_key=test` }).reply(200, {
      id,
      status: 'Ended',
      number_of_seasons: 1,
      number_of_episodes: 1,
      seasons: [{ season_number: 1, episode_count: 1 }],
    });
    pool
      .intercept({ path: `/3/tv/${id}/season/1?api_key=test` })
      .reply(200, {
        season_number: 1,
        episodes: [{ show_id: id, season_number: 1, episode_number: 1 }],
      })
      .delay(100);
    const result = await resolveConflictEvidence({
      ...args,
      streams: [
        {
          ...stream,
          parsedFile: { title: 'Shared Show' },
          releaseMedium: undefined,
        } as ParsedStream,
      ],
      titleConflicts: new Map([
        ['sharedshow', [{ title: 'Shared Show', tmdbId: id }]],
      ]),
      auth: { tmdbApiKey: 'test' },
      budgetMs: 30,
    });
    assert.deepEqual(result.numberingBounds.get(`tmdb:${id}`), { season: 1 });
    assert.equal(
      await new TMDBMetadata({ apiKey: 'test' }).getSeasonBound(id),
      1
    );
    agent.assertNoPendingInterceptors();
  });

  it('uses only the lightweight summary for a season pack or conclusive high season', async (t) => {
    await initialise(t);
    const agent = mockHttp(t);
    const id = 98769005;
    agent
      .get('https://api.themoviedb.org')
      .intercept({ path: `/3/tv/${id}?api_key=test` })
      .reply(200, {
        id,
        status: 'Ended',
        number_of_seasons: 1,
        seasons: [{ season_number: 1 }],
      });
    const catalog = t.mock.method(
      TMDBMetadata.prototype,
      'getEpisodeCatalog',
      async () => assert.fail('no episode catalog needed')
    );
    for (const episode of [undefined, 10]) {
      const result = await resolveConflictEvidence({
        ...args,
        streams: [
          {
            ...stream,
            parsedFile: { title: 'Shared Show' },
            releaseMedium: undefined,
          } as ParsedStream,
        ],
        releaseEpisode: () => episode,
        releaseSeason: () => 3,
        titleConflicts: new Map([
          ['sharedshow', [{ title: 'Shared Show', tmdbId: id }]],
        ]),
        auth: { tmdbApiKey: 'test' },
        budgetMs: 200,
      });
      assert.deepEqual(result.numberingBounds.get(`tmdb:${id}`), { season: 1 });
    }
    assert.equal(catalog.mock.callCount(), 0);
    agent.assertNoPendingInterceptors();
  });

  it('aborts queued season requests on early completion without cancelling another useful evidence path', async (t) => {
    await initialise(t);
    const agent = mockHttp(t);
    const id = 98769006;
    const pool = agent.get('https://api.themoviedb.org');
    let started = 0;
    pool.intercept({ path: `/3/tv/${id}?api_key=test` }).reply(200, {
      id,
      status: 'Ended',
      original_language: 'ko',
      number_of_seasons: 9,
      number_of_episodes: 9,
      seasons: Array.from({ length: 9 }, (_, i) => ({
        season_number: i + 1,
        episode_count: 1,
      })),
    });
    for (let season = 1; season <= 9; season++)
      pool
        .intercept({ path: `/3/tv/${id}/season/${season}?api_key=test` })
        .reply(() => {
          started++;
          return {
            statusCode: season === 1 ? 404 : 200,
            data: {
              season_number: season,
              episodes: [
                { show_id: id, season_number: season, episode_number: 1 },
              ],
            },
          };
        })
        .delay(season === 1 ? 1 : 80);
    let languageSignal: AbortSignal | undefined;
    t.mock.method(
      TMDBMetadata.prototype,
      'getOriginalLanguage',
      async (_id, signal) => {
        languageSignal = signal;
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(
          signal?.aborted,
          false,
          'a failed catalog must not cancel useful audio evidence'
        );
        return 'ko';
      }
    );
    const result = await resolveConflictEvidence({
      ...args,
      streams: [
        {
          ...stream,
          parsedFile: {
            title: 'Shared Show',
            mediaInfoQuality: 'indexer',
            audioTracks: [{ lang: 'ja', original: true }],
          },
          releaseMedium: undefined,
        } as ParsedStream,
      ],
      titleConflicts: new Map([
        ['sharedshow', [{ title: 'Shared Show', tmdbId: id }]],
      ]),
      auth: { tmdbApiKey: 'test' },
      budgetMs: 40,
    });
    assert.equal(result.originalLanguages.get(`tmdb:${id}`), 'ko');
    assert.ok(
      languageSignal?.aborted,
      'resolver exit cancels the outstanding catalog work'
    );
    const atReturn = started;
    assert.ok(atReturn > 0 && atReturn < 9);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      started,
      atReturn,
      'no queued request starts after the resolver returns'
    );
  });

  it('skips lookups for conclusive uploads while retaining contradiction and age guards', async (t) => {
    await initialise(t);
    const show = t.mock.method(
      SkyhookMetadata.prototype,
      'getShow',
      async (id) => ({
        tvdbId: id,
        title: 'Shared Show',
        status: 'Continuing',
        episodes: [],
      })
    );
    const now = Date.UTC(2026, 0, 1);
    const oldAge = (now - Date.UTC(2010, 0, 1)) / 3600000;
    const base = {
      ...args,
      now,
      metadata: { ...metadata, year: 1998, country: 'US' },
      titleConflicts: new Map([
        [
          'sharedshow',
          [{ title: 'Shared Show', tvdbId: 2, year: 2020, country: 'US' }],
        ],
      ]),
    };
    await resolveConflictEvidence({
      ...base,
      streams: [
        {
          ...stream,
          age: oldAge,
          parsedFile: { ...stream.parsedFile, country: 'US' },
        } as ParsedStream,
      ],
    });
    assert.equal(show.mock.callCount(), 0);
    for (const extra of [
      { age: -1 },
      { age: NaN },
      { age: Infinity },
      { age: 0 },
      { age: oldAge, releaseYear: '2020' },
      { age: oldAge, parsedFile: { ...stream.parsedFile, year: '2020' } },
    ]) {
      const before = show.mock.callCount();
      await resolveConflictEvidence({
        ...base,
        streams: [{ ...stream, ...extra } as ParsedStream],
      });
      assert.ok(show.mock.callCount() > before);
    }
  });
});

it('bounds alias batches and subsequent details with one budget, retaining partial conflicts and unresolved aliases', async (t) => {
  await initialise(t);
  const budget = createConflictLookupBudget(25);
  const unresolved = new Set<string>();
  const titles = [
    'Clear Alias',
    'Shared Alias',
    'Stalled Alias',
    'Second Stalled Alias',
    'Queued Alias',
  ];
  const calls: string[] = [];
  try {
    const conflicts = await getStreamTitleConflicts(
      { ...metadata, titles: titles.map((title) => ({ title })) },
      titles,
      {},
      async (input) => {
        calls.push(input.title);
        if (input.title === titles[0]) return [];
        if (input.title === titles[1])
          input.onProgress?.([{ title: input.title, tvdbId: 2, year: 2020 }]);
        return new Promise<never>(() => {});
      },
      { signal: budget.signal, unresolvedAliases: unresolved }
    );
    assert.deepEqual(calls, titles.slice(0, 4));
    assert.deepEqual(conflicts.get('clearalias'), []);
    assert.equal(conflicts.get('sharedalias')?.[0].tvdbId, 2);
    assert.deepEqual([...unresolved], titles.slice(1).map(titleConflictKey));
    const show = t.mock.method(SkyhookMetadata.prototype, 'getShow', async () =>
      assert.fail('the alias phase consumed the deadline')
    );
    await resolveConflictEvidence({
      ...args,
      signal: budget.signal,
      titleConflicts: conflicts,
      titleKey: () => 'sharedalias',
    });
    assert.equal(show.mock.callCount(), 0);
  } finally {
    budget.finish();
  }
});

it('retains conflicts from a completed provider when another alias search is cancelled', async (t) => {
  await initialise(t);
  const budget = createConflictLookupBudget(25);
  const unresolved = new Set<string>();
  const signals: AbortSignal[] = [];
  t.mock.method(
    TMDBMetadata.prototype,
    'searchSeries',
    async (_title, signal) => {
      signals.push(signal!);
      return [{ tmdbId: 2, name: 'Shared Alias', year: 2020, country: 'US' }];
    }
  );
  t.mock.method(SkyhookMetadata.prototype, 'search', async (_title, signal) => {
    signals.push(signal!);
    return new Promise<never>(() => {});
  });
  try {
    const conflicts = await getStreamTitleConflicts(
      {
        ...metadata,
        year: 1998,
        country: 'US',
        titles: [{ title: 'Shared Alias' }],
      },
      ['Shared Alias'],
      {
        tmdbAuth: { apiKey: 'test' },
      },
      undefined,
      { signal: budget.signal, unresolvedAliases: unresolved }
    );
    assert.equal(conflicts.get('sharedalias')?.[0].tmdbId, 2);
    assert.ok(unresolved.has('sharedalias'));
    assert.equal(signals.length, 2);
    assert.ok(signals.every((signal) => signal.aborted));
  } finally {
    budget.finish();
  }
});

it('keeps completed alias results and primary evidence but rejects unresolved aliases only within discard scope', async (t) => {
  await initialise(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started!: () => void;
  const searchStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  t.mock.method(SkyhookMetadata.prototype, 'search', async (title, signal) => {
    if (title === 'Clear Alias') return [];
    assert.equal(title, 'Shared Alias');
    assert.ok(signal);
    started();
    return new Promise<never>(() => {});
  });
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
    getMetadata: async () => ({
      title: 'Distinct Series',
      year: 1998,
      country: 'US',
      tvdbId: 1,
      titles: ['Distinct Series', 'Shared Alias', 'Clear Alias'].map(
        (title) => ({ title })
      ),
      titleConflicts: [
        { title: 'Distinct Series', year: 2020, country: 'US', tvdbId: 2 },
      ],
    }),
  });
  const makeStreams = () => {
    const releases = [
      'Shared.Alias.1998.S01E10.mkv',
      'Clear.Alias.S01E10.mkv',
      'Distinct.Series.1998.S01E10.mkv',
      'Shared.Alias.S01E10.mkv',
    ].map((filename, i) => ({
      id: String(i),
      type: 'usenet',
      filename,
      parsedFile: FileParser.parse(filename),
      addon: { preset: { id: i === 3 ? 'other-addon' : 'newznab' } },
    })) as ParsedStream[];
    const idSearch = {
      ...releases[3],
      id: '4',
      idMatched: true,
      addon: { preset: { id: 'newznab' } },
    } as ParsedStream;
    return [
      ...releases,
      idSearch,
      { ...idSearch, id: '5', releaseIds: { tvdbId: 3 } },
    ];
  };
  const options = {
    titleMatching: {
      enabled: true,
      mode: 'exact',
      ambiguousResults: 'discard',
      addons: ['newznab'],
    },
  } as UserData;
  const pending = new StreamFilterer(options).filter(makeStreams(), context);
  await searchStarted;
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(5000);
  assert.deepEqual(
    (await pending).map((s) => s.id),
    ['1', '2', '3', '4']
  );
  for (const titleMatching of [
    { ...options.titleMatching, ambiguousResults: 'keep' },
    { ...options.titleMatching, enabled: false },
  ])
    assert.equal(
      (
        await new StreamFilterer({ titleMatching } as UserData).filter(
          makeStreams(),
          context
        )
      ).length,
      6
    );
});

it('still loads episode bounds when any release needs them alongside conclusive season evidence', async (t) => {
  await initialise(t);
  const id = 98769007;
  t.mock.method(TMDBMetadata.prototype, 'getSeasonBound', async () => 1);
  const catalog = t.mock.method(
    TMDBMetadata.prototype,
    'getEpisodeCatalog',
    async () => ({
      tmdbId: id,
      status: 'Ended',
      episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
    })
  );
  const make = (id: string) =>
    ({
      ...stream,
      id,
      parsedFile: { title: 'Shared Show' },
      releaseMedium: undefined,
    }) as ParsedStream;
  const base = {
    ...args,
    titleConflicts: new Map([
      ['sharedshow', [{ title: 'Shared Show', tmdbId: id }]],
    ]),
    auth: { tmdbApiKey: 'test' },
    releaseSeason: (s: ParsedStream) => (s.id === 'season' ? 3 : undefined),
  };
  const seasonOnly = await resolveConflictEvidence({
    ...base,
    streams: [make('season')],
  });
  assert.deepEqual(seasonOnly.numberingBounds.get(`tmdb:${id}`), { season: 1 });
  assert.equal(catalog.mock.callCount(), 0);
  for (const streams of [
    [make('absolute')],
    [make('season'), make('absolute')],
  ]) {
    const result = await resolveConflictEvidence({ ...base, streams });
    assert.deepEqual(result.numberingBounds.get(`tmdb:${id}`), {
      episode: 1,
      season: 1,
    });
  }
  assert.equal(catalog.mock.callCount(), 2);
});

it('resolves primary and completed aliases independently of a stalled alias, sharing competitor reads', async (t) => {
  await initialise(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started!: () => void;
  const searchStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  t.mock.method(SkyhookMetadata.prototype, 'search', async (title) => {
    if (title !== 'Stalled Alias')
      return [
        {
          title,
          tvdbId: title === 'Fast Alias' ? 3 : 2,
          year: 2020,
          country: 'US',
        },
      ];
    started();
    return new Promise<never>(() => {});
  });
  const catalog = t.mock.method(
    SkyhookMetadata.prototype,
    'getShow',
    async (id) => ({
      tvdbId: id,
      title: 'Shared Show',
      status: 'Ended',
      episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
    })
  );
  const context = createTestStreamContext({
    type: 'series',
    id: 'tt0108850:1:20',
    isAnime: false,
    parsedId: {
      type: 'imdbId',
      value: 'tt0108850',
      season: '1',
      episode: '20',
    },
    getMetadata: async () => ({
      title: 'Shared Show',
      year: 1998,
      country: 'US',
      tvdbId: 1,
      titles: [
        'Shared Show',
        'Fast Alias',
        'Repeated Alias',
        'Stalled Alias',
      ].map((title) => ({ title })),
      titleConflicts: [
        { title: 'Shared Show', year: 2020, country: 'US', tvdbId: 2 },
      ],
    }),
  });
  const make = (title: string) => {
    const filename = `${title}.S01E20.mkv`;
    return {
      id: title,
      type: 'usenet',
      filename,
      parsedFile: FileParser.parse(filename),
      addon: { preset: { id: 'newznab' } },
    } as ParsedStream;
  };
  const filter = new StreamFilterer({
    titleMatching: {
      enabled: true,
      mode: 'exact',
      ambiguousResults: 'discard',
    },
  } as UserData);
  assert.deepEqual(
    (await filter.filter([make('Shared.Show')], context)).map((s) => s.id),
    ['Shared.Show']
  );
  const before = catalog.mock.callCount();
  const pending = filter.filter(
    [
      make('Shared.Show'),
      make('Fast.Alias'),
      make('Repeated.Alias'),
      make('Stalled.Alias'),
    ],
    context
  );
  await searchStarted;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(
    catalog.mock.calls
      .slice(before)
      .map(({ arguments: [id] }) => id)
      .sort(),
    [2, 3]
  );
  t.mock.timers.tick(5000);
  assert.deepEqual(
    (await pending).map((s) => s.id),
    ['Shared.Show', 'Fast.Alias', 'Repeated.Alias']
  );
  assert.equal(catalog.mock.callCount() - before, 2);
});

it('retains the TVDB-only catalogue fallback for season packs', async (t) => {
  await initialise(t);
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async () => null);
  t.mock.method(TVDBMetadata.prototype, 'getSeriesStatus', async () => 'Ended');
  const catalog = t.mock.method(
    TVDBMetadata.prototype,
    'getEpisodeCatalog',
    async (id) => ({
      tvdbId: id,
      status: 'Ended',
      episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
    })
  );
  const result = await resolveConflictEvidence({
    ...args,
    streams: [
      {
        ...stream,
        parsedFile: { title: 'Shared Show' },
        releaseMedium: undefined,
      } as ParsedStream,
    ],
    releaseSeason: () => 3,
    releaseEpisode: () => undefined,
    auth: { tvdbApiKey: 'test' },
  });
  assert.equal(result.numberingBounds.get(2)?.season, 1);
  assert.equal(catalog.mock.callCount(), 1);
});

it('starts the TVDB season fallback without waiting for a stalled TMDB summary', async (t) => {
  await initialise(t);
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async () => null);
  t.mock.method(
    TMDBMetadata.prototype,
    'getSeasonBound',
    async () => new Promise<never>(() => {})
  );
  const catalog = t.mock.method(
    TVDBMetadata.prototype,
    'getEpisodeCatalog',
    async (id) => ({
      tvdbId: id,
      status: 'Ended',
      episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
    })
  );
  const result = await resolveConflictEvidence({
    ...args,
    streams: [
      {
        ...stream,
        parsedFile: { title: 'Shared Show' },
        releaseMedium: undefined,
      } as ParsedStream,
    ],
    titleConflicts: new Map([
      ['sharedshow', [{ title: 'Shared Show', tvdbId: 2, tmdbId: 2 }]],
    ]),
    releaseSeason: () => 3,
    releaseEpisode: () => undefined,
    auth: { tvdbApiKey: 'test', tmdbApiKey: 'test' },
  });
  assert.equal(result.numberingBounds.get(2)?.season, 1);
  assert.equal(catalog.mock.callCount(), 1);
});

it('reconciles contradictory provider mappings across completed aliases conservatively', async (t) => {
  await initialise(t);
  const show = t.mock.method(
    SkyhookMetadata.prototype,
    'getShow',
    async (id) => ({ tvdbId: id, title: 'Shared Show', originalLanguage: 'ko' })
  );
  const language = t.mock.method(
    TMDBMetadata.prototype,
    'getOriginalLanguage',
    async (id) => (id === 7 ? 'ko' : 'en')
  );
  const conflicts = new Map([
    ['sharedshow', [{ title: 'Shared Show', tvdbId: 2, tmdbId: 7 }]],
    ['sharedalias', [{ title: 'Shared Alias', tvdbId: 2, tmdbId: 8 }]],
  ]);
  const result = await resolveConflictEvidence({
    ...args,
    streams: ['Shared Show', 'Shared Alias'].map(
      (title) =>
        ({
          ...stream,
          parsedFile: {
            title,
            mediaInfoQuality: 'indexer',
            audioTracks: [{ lang: 'ja', original: true }],
          },
          releaseMedium: undefined,
        }) as ParsedStream
    ),
    titleConflicts: new Map([['sharedshow', conflicts.get('sharedshow')!]]),
    titleKey: (s) => titleConflictKey(s.parsedFile!.title!),
    releaseEpisode: () => undefined,
    releaseSeason: () => undefined,
    auth: { tmdbApiKey: 'test' },
    discoverConflicts: async (resolved) => {
      resolved('sharedalias', conflicts.get('sharedalias')!);
      return conflicts;
    },
  });
  assert.equal(result.originalLanguages.size, 0);
  assert.equal(show.mock.callCount(), 1);
  assert.equal(language.mock.callCount(), 2);
});

for (const [offset, mode] of [
  'resolver',
  'filter',
  'independent-audio',
  'increased-counts',
].entries()) {
  it(`reconciles an earlier season bound with a concurrent validated show refresh: ${mode}`, async (t) => {
    await initialise(t);
    t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
    const agent = mockHttp(t);
    const id = 98769300 + offset;
    const pool = agent.get('https://api.themoviedb.org');
    const path = `/3/tv/${id}?api_key=test`;
    pool.intercept({ path }).reply(200, {
      id,
      status: 'Ended',
      number_of_seasons: 1,
      seasons: [{ season_number: 1 }],
    });
    assert.equal(
      await new TMDBMetadata({ apiKey: 'test' }).getSeasonBound(id),
      1
    );
    pool.intercept({ path }).reply(200, {
      id,
      status: 'Returning Series',
      original_language: mode === 'independent-audio' ? 'ko' : 'ja',
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
    });
    const requested = {
      ...metadata,
      year: 1998,
      country: 'US',
      titles: [{ title: 'Shared Show' }],
      seasons: [{ season_number: 3, episode_count: 5 }],
      titleConflicts: [
        { title: 'Shared Show', tmdbId: id, year: 2020, country: 'US' },
      ],
    };
    const season = mode === 'increased-counts' ? 2 : 3;
    requested.seasons = [{ season_number: season, episode_count: 5 }];
    const filename = `Shared.Show.S0${season}E05.mkv`;
    const release = {
      id: 'release',
      type: 'usenet',
      filename,
      parsedFile: {
        ...FileParser.parse(filename),
        mediaInfoQuality: 'indexer',
        audioTracks: [{ lang: 'ja', original: true }],
      },
      addon: { preset: { id: 'newznab' } },
    } as ParsedStream;
    if (mode === 'resolver') {
      const conflicts = new Map([['sharedshow', requested.titleConflicts]]);
      const result = await resolveConflictEvidence({
        ...args,
        metadata: requested,
        streams: [release],
        titleConflicts: conflicts,
        releaseSeason: () => 3,
        releaseEpisode: () => 5,
        auth: { tmdbApiKey: 'test' },
        budgetMs: 500,
        discoverConflicts: async () => conflicts,
      });
      assert.equal(result.numberingBounds.size, 0);
      assert.equal(result.originalLanguages.get(`tmdb:${id}`), 'ja');
    } else {
      const context = createTestStreamContext({
        type: 'series',
        id: `tt0108850:${season}:5`,
        isAnime: false,
        parsedId: {
          type: 'imdbId',
          value: 'tt0108850',
          season: String(season),
          episode: '5',
        },
        getMetadata: async () => requested,
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
        (await filter.filter([release], context)).length,
        mode === 'independent-audio' ? 1 : 0
      );
    }
    agent.assertNoPendingInterceptors();
  });
}

it('starts a TVDB episode catalogue immediately when a high-season summary stalls', async (t) => {
  await initialise(t);
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async () => null);
  t.mock.method(
    TMDBMetadata.prototype,
    'getSeasonBound',
    async () => new Promise<never>(() => {})
  );
  const catalog = t.mock.method(
    TVDBMetadata.prototype,
    'getEpisodeCatalog',
    async (id) => ({
      tvdbId: id,
      status: 'Ended',
      episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
    })
  );
  const result = await resolveConflictEvidence({
    ...args,
    streams: [
      {
        ...stream,
        parsedFile: { title: 'Shared Show' },
        releaseMedium: undefined,
      } as ParsedStream,
    ],
    titleConflicts: new Map([
      ['sharedshow', [{ title: 'Shared Show', tvdbId: 2, tmdbId: 2 }]],
    ]),
    releaseSeason: () => 3,
    releaseEpisode: () => 5,
    auth: { tvdbApiKey: 'test', tmdbApiKey: 'test' },
  });
  assert.equal(result.numberingBounds.get(2)?.season, 1);
  assert.equal(catalog.mock.callCount(), 1);
});

it('shares the numbering concurrency limit across incremental alias batches', async (t) => {
  await initialise(t);
  let active = 0,
    peak = 0,
    calls = 0;
  const ready: (() => void)[] = [];
  t.mock.method(
    TMDBMetadata.prototype,
    'getSeasonBound',
    async () => undefined as unknown as number
  );
  t.mock.method(TMDBMetadata.prototype, 'getEpisodeCatalog', async (id) => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => ready.push(resolve));
    active--;
    return {
      tmdbId: id,
      status: 'Ended',
      episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
    };
  });
  const conflicts = new Map(
    Array.from({ length: 8 }, (_, i) => [
      `alias${i}`,
      [{ title: `Alias ${i}`, tmdbId: 98769310 + i }],
    ])
  );
  const pending = resolveConflictEvidence({
    ...args,
    metadata: undefined,
    streams: [...conflicts.keys()].map(
      (id) =>
        ({
          ...stream,
          id,
          parsedFile: { title: id },
          releaseMedium: undefined,
        }) as ParsedStream
    ),
    titleConflicts: new Map(),
    titleKey: (s) => s.id,
    releaseSeason: () => undefined,
    auth: { tmdbApiKey: 'test' },
    budgetMs: 500,
    discoverConflicts: async (resolved) => {
      for (const [key, found] of conflicts) resolved(key, found);
      return conflicts;
    },
  });
  for (let i = 0; i < 12; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    ready.splice(0).forEach((resolve) => resolve());
  }
  assert.equal((await pending).numberingBounds.size, 8);
  assert.equal(calls, 8);
  assert.equal(peak, 3);
});

for (const path of ['numbering', 'language', 'animation']) {
  it(`does not let duplicate stalled competitors occupy ${path} slots needed by another alias`, async (t) => {
    await initialise(t);
    const calls: number[] = [];
    t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id) => {
      calls.push(id);
      if (id === 2) return new Promise<never>(() => {});
      return {
        tvdbId: id,
        title: 'Shared Show',
        status: 'Ended',
        originalLanguage: 'ko',
        genres: ['Comedy'],
        episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
      };
    });
    const conflicts = new Map(
      [2, 2, 2, 3].map((tvdbId, i) => [
        `alias${i}`,
        [{ title: `Alias ${i}`, tvdbId }],
      ])
    );
    const controller = new AbortController();
    const result = await resolveConflictEvidence({
      ...args,
      metadata: path === 'numbering' ? undefined : metadata,
      streams: [...conflicts.keys()].map(
        (id) =>
          ({
            ...stream,
            id,
            releaseMedium: path === 'animation' ? 'animation' : undefined,
            parsedFile: {
              title: id,
              ...(path === 'language'
                ? {
                    mediaInfoQuality: 'indexer',
                    audioTracks: [{ lang: 'ja', original: true }],
                  }
                : {}),
            },
          }) as ParsedStream
      ),
      titleConflicts: new Map(),
      titleKey: (s) => s.id,
      releaseEpisode: () => (path === 'numbering' ? 10 : undefined),
      releaseSeason: () => (path === 'numbering' ? 1 : undefined),
      signal: controller.signal,
      discoverConflicts: async (resolved) => {
        for (const [key, found] of conflicts) resolved(key, found);
        for (let i = 0; i < 8; i++)
          await new Promise<void>((resolve) => setImmediate(resolve));
        controller.abort();
        return conflicts;
      },
    });
    assert.deepEqual(calls.sort(), [2, 3]);
    if (path === 'numbering')
      assert.deepEqual(result.numberingBounds.get(3), {
        season: 1,
        episode: 1,
      });
    else if (path === 'language')
      assert.equal(result.originalLanguages.get(3), 'ko');
    else assert.equal(result.animationTypes.get(3), false);
  });
}

it('shares episode-title reads and their concurrency limit across incremental aliases', async (t) => {
  await initialise(t);
  let active = 0,
    peak = 0;
  const calls: number[] = [];
  const ready: (() => void)[] = [];
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id) => {
    calls.push(id);
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => ready.push(resolve));
    active--;
    return {
      tvdbId: id,
      title: 'Shared Show',
      status: 'Ended',
      episodes: [
        {
          seasonNumber: 1,
          episodeNumber: 1,
          title:
            id === 1 ? 'A Distinctive Episode Name' : 'Another Episode Name',
        },
      ],
    };
  });
  const conflicts = new Map(
    Array.from({ length: 8 }, (_, i) => [
      `alias${i}`,
      [{ title: `Alias ${i}`, tvdbId: i + 2 }],
    ])
  );
  const pending = resolveConflictEvidence({
    ...args,
    streams: [...conflicts.keys()].map(
      (id) =>
        ({
          ...stream,
          id,
          parsedFile: { title: id, episodeTitle: 'A Distinctive Episode Name' },
          releaseMedium: undefined,
        }) as ParsedStream
    ),
    titleConflicts: new Map(),
    titleKey: (s) => s.id,
    releaseEpisode: () => undefined,
    releaseSeason: () => undefined,
    budgetMs: 500,
    discoverConflicts: async (resolved) => {
      for (const [key, found] of conflicts) resolved(key, found);
      return conflicts;
    },
  });
  for (let i = 0; i < 12; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    ready.splice(0).forEach((resolve) => resolve());
  }
  const result = await pending;
  assert.equal(result.episodeTitles.size, 8);
  assert.equal(new Set(calls).size, 9);
  assert.equal(calls.length, 9);
  assert.equal(peak, 3);
});

for (const timing of ['pending', 'completed']) {
  it(`upgrades shared season-only work when a later alias needs episode evidence: ${timing}`, async (t) => {
    await initialise(t);
    let readSeason!: () => void;
    const started = new Promise<void>((resolve) => {
      readSeason = resolve;
    });
    let finishSeason!: () => void;
    const ready = new Promise<void>((resolve) => {
      finishSeason = resolve;
    });
    const season = t.mock.method(
      TMDBMetadata.prototype,
      'getSeasonBound',
      async () => {
        readSeason();
        await ready;
        return 1;
      }
    );
    const catalog = t.mock.method(
      TMDBMetadata.prototype,
      'getEpisodeCatalog',
      async (tmdbId) => ({
        tmdbId,
        status: 'Ended',
        episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
      })
    );
    const conflicts = new Map(
      ['pack', 'episode', 'duplicate'].map((alias) => [
        alias,
        [{ title: alias, tmdbId: 98769420 }],
      ])
    );
    const result = await resolveConflictEvidence({
      ...args,
      metadata: undefined,
      streams: [...conflicts.keys()].map(
        (id) => ({ ...stream, id, parsedFile: { title: id } }) as ParsedStream
      ),
      titleConflicts: new Map([['pack', conflicts.get('pack')!]]),
      titleKey: (s) => s.id,
      releaseEpisode: (s) => (s.id === 'pack' ? undefined : 10),
      releaseSeason: (s) => (s.id === 'pack' ? 3 : 1),
      auth: { tmdbApiKey: 'test' },
      budgetMs: 500,
      discoverConflicts: async (resolved) => {
        await started;
        if (timing === 'completed') {
          finishSeason();
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        resolved('episode', conflicts.get('episode')!);
        resolved('duplicate', conflicts.get('duplicate')!);
        finishSeason();
        return conflicts;
      },
    });
    assert.deepEqual(result.numberingBounds.get('tmdb:98769420'), {
      season: 1,
      episode: 1,
    });
    assert.equal(season.mock.callCount(), 1);
    assert.equal(catalog.mock.callCount(), 1);
  });
}
