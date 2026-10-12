import './filterer.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ParsedFile, ParsedStream, UserData } from '../db/schemas.js';
import { SkyhookMetadata } from '../metadata/skyhook.js';
import { TMDBMetadata } from '../metadata/tmdb.js';
import { TVDBMetadata } from '../metadata/tvdb.js';
import { RegexAccess } from '../utils/regex-access.js';
import { parseNabReleaseMedium } from '../builtins/base/nab/addon.js';
import { parseIndexerAudioTracks } from '../utils/media-info.js';
import {
  animationFromGenres,
  confirmsTitleIdentity,
  getConflictAnimationTypes,
  getConflictOriginalLanguages,
  getOriginalAudioLanguage,
} from './title-conflicts.js';
import StreamFilterer from './filterer.js';
import { initialiseTestSettings, mockHttp } from '../../test/helpers.js';
import { release, seriesContext } from '../../test/title-fixtures.js';

const original = (
  lang = 'ja',
  extra: Partial<ParsedFile> = {}
): ParsedFile => ({
  mediaInfoQuality: 'probe',
  audioTracks: [{ lang, original: true }],
  ...extra,
});

it('T23: only independent, consistent original dialogue roles provide audio identity', () => {
  for (const [input, output] of [
    ['jpn', 'ja'],
    ['English', 'en'],
    ['fre', 'fr'],
    ['es-MX', 'es'],
    ['Portuguese (Brazil)', 'pt'],
    ['German', 'de'],
    ['kor', 'ko'],
  ])
    assert.equal(getOriginalAudioLanguage(original(input)), output, input);
  const files = [
    original('Original'),
    original('und'),
    original('Atlantis'),
    original('ja', { mediaInfoQuality: 'addon' }),
    original('ja', { mediaInfoQuality: undefined }),
  ];
  for (const flag of ['dub', 'commentary', 'visualImpaired'])
    files.push(
      original('ja', {
        audioTracks: [{ lang: 'ja', original: true, [flag]: true }],
      })
    );
  for (const tracks of [
    [{ lang: 'ja' }],
    [{ original: true }],
    [
      { lang: 'ja', original: true },
      { lang: 'en', original: true },
    ],
    [{ lang: 'ja', original: true }, { original: true }],
  ])
    files.push(original('ja', { audioTracks: tracks }));
  files.push(original('ja', { audioTracks: undefined }));
  for (const file of files)
    assert.equal(
      getOriginalAudioLanguage(file),
      undefined,
      JSON.stringify(file)
    );
  assert.equal(getOriginalAudioLanguage(undefined), undefined);
  assert.equal(
    getOriginalAudioLanguage(
      original('ja', {
        audioTracks: [
          { lang: 'ja', original: true },
          { lang: 'en', dub: true },
        ],
      })
    ),
    'ja'
  );
  for (const malformed of [
    '{',
    'x'.repeat(65537),
    Array(129).fill('ja'),
    [],
    42,
    null,
  ])
    assert.equal(parseIndexerAudioTracks(malformed), undefined);
  const parsed = parseIndexerAudioTracks(
    JSON.stringify([
      { language: 'jpn', original: true },
      { lang: 'eng', dub: true },
    ])
  );
  assert.equal(getOriginalAudioLanguage(parsed), 'ja');
  for (const tracks of [
    ['Japanese', 'Original'],
    [{ lang: 'ja', original: 'true' }],
    [{ lang: 'ja', default: true }],
    [{ lang: 'ja', title: 'Original' }],
  ])
    assert.equal(
      getOriginalAudioLanguage(parseIndexerAudioTracks(tracks)),
      undefined
    );
});

it('T24: only per-item animation categories and valid nonempty genres classify medium', () => {
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
  for (const genres of [
    undefined,
    null,
    [],
    [''],
    ['Comedy', null],
    'Animation',
  ])
    assert.equal(animationFromGenres(genres), undefined);
  assert.equal(animationFromGenres([' Comedy ', 'Animation']), true);
  assert.equal(animationFromGenres(['Anime']), true);
  assert.equal(animationFromGenres(['Comedy', 'Drama']), false);
});

it('T05/T23/T24: trait proof excludes every known competitor and respects country contradictions', () => {
  const metadata = {
    title: 'Shared Show',
    year: 1994,
    country: 'JP',
    originalLanguage: 'ja',
    genres: ['Animation'],
  };
  const conflicts = [
    { title: 'Shared Show', tvdbId: 7 },
    { title: 'Shared Show', tmdbId: 7 },
  ];
  const languages = new Map<number | string, string>([
    [7, 'ko'],
    ['tmdb:7', 'en'],
  ]);
  const media = new Map<number | string, boolean>([
    [7, false],
    ['tmdb:7', false],
  ]);
  for (const path of ['audio', 'medium']) {
    const evidence =
      path === 'audio'
        ? { originalAudioLanguage: 'ja', conflictOriginalLanguages: languages }
        : {
            releaseMedium: 'animation' as const,
            conflictAnimationTypes: media,
          };
    assert.equal(confirmsTitleIdentity(metadata, conflicts, evidence), true);
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
        country: 'US',
      }),
      false
    );
    assert.equal(
      confirmsTitleIdentity(metadata, conflicts, { ...evidence, year: 2021 }),
      true,
      'Year Matching owns the mismatch'
    );
  }
  assert.equal(
    confirmsTitleIdentity(
      { ...metadata, originalLanguage: 'en-US' },
      conflicts,
      { originalAudioLanguage: 'en', conflictOriginalLanguages: languages }
    ),
    false
  );
  assert.equal(
    confirmsTitleIdentity(metadata, conflicts, {
      releaseMedium: 'animation',
      conflictAnimationTypes: new Map([
        [7, true],
        ['tmdb:7', false],
      ]),
    }),
    false
  );
});

it('T23/T24: provider reads deduplicate within namespaces, use fallback and discard contradictory mappings', async (t) => {
  const calls: string[] = [];
  const conflicts = [
    { title: 'One', tvdbId: 1 },
    { title: 'One', tvdbId: 1 },
    { title: 'Two', tvdbId: 2 },
    { title: 'Three', tmdbId: 3 },
    { title: 'Four', tvdbId: 4, tmdbId: 4 },
    { title: 'Five', tvdbId: 5 },
    { title: 'Unknown' },
  ];
  const languages = await getConflictOriginalLanguages(
    conflicts,
    async (id) => {
      calls.push(`skyhook:${id}`);
      return id === 1 || id === 4 ? 'eng' : undefined;
    },
    async (id) => {
      calls.push(`tvdb:${id}`);
      if (id === 5) throw Error('offline');
      return 'fra';
    },
    async (id) => (id === 4 ? 'German' : 'es')
  );
  assert.deepEqual(
    [...languages].sort(),
    [
      [1, 'en'],
      [2, 'fr'],
      ['tmdb:3', 'es'],
    ].sort()
  );
  assert.equal(calls.filter((x) => x === 'skyhook:1').length, 1);
  assert.equal(calls.includes('tvdb:1'), false);
  const duplicates = [
    { title: 'Shared', tvdbId: 9, tmdbId: 10 },
    { title: 'Shared', tvdbId: 9, tmdbId: 11 },
  ];
  assert.equal(
    (
      await getConflictOriginalLanguages(
        duplicates,
        async () => 'French',
        undefined,
        async (id) => (id === 10 ? 'French' : 'English')
      )
    ).size,
    0
  );
  assert.equal(
    (
      await getConflictAnimationTypes(
        duplicates,
        async () => ['Comedy'],
        async (id) => (id === 10 ? ['Comedy'] : ['Animation'])
      )
    ).size,
    0
  );
  const medium = await getConflictAnimationTypes(
    [
      { title: 'Shared', tvdbId: 7 },
      { title: 'Shared', tmdbId: 7 },
      { title: 'Shared', tvdbId: 7 },
      { title: 'Empty', tvdbId: 8 },
    ],
    async (id) => (id === 8 ? [] : ['Comedy']),
    async () => ['Comedy']
  );
  assert.deepEqual(
    medium,
    new Map<number | string, boolean>([
      [7, false],
      ['tmdb:7', false],
    ])
  );
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async () => ({
    tvdbId: 99,
    title: 'Wrong',
    originalLanguage: 'eng',
    genres: ['Comedy'],
  }));
  assert.equal(
    (await getConflictOriginalLanguages([{ title: 'Shared', tvdbId: 98 }]))
      .size,
    0
  );
  assert.equal(
    (await getConflictAnimationTypes([{ title: 'Shared', tvdbId: 98 }])).size,
    0
  );
});

it('T02/T23/T24: independent traits recover streams across types without enabling filters or metadata lookups outside scope', async (t) => {
  await initialiseTestSettings(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  const show = t.mock.method(
    SkyhookMetadata.prototype,
    'getShow',
    async (id) => ({
      tvdbId: id,
      title: 'Shared Show',
      status: 'Continuing',
      originalLanguage: 'en',
      genres: ['Drama'],
      episodes: [],
    })
  );
  const metadata = {
    title: 'Shared Show',
    titles: [{ title: 'Shared Show' }],
    year: 1994,
    country: 'JP',
    originalLanguage: 'ja',
    genres: ['Animation'],
    tvdbId: 1,
    seasons: [{ season_number: 1, episode_count: 76 }],
    episodeTitles: [{ title: 'A Real Episode Name', language: 'en' }],
    titleConflicts: [
      { title: 'Shared Show', tvdbId: 2, year: 2001, country: 'US' },
    ],
  };
  const options: UserData = {
    titleMatching: { enabled: true, ambiguousResults: 'discard' },
    yearMatching: { enabled: true },
    seasonEpisodeMatching: { enabled: true, strict: true },
    episodeTitleMatching: { enabled: true, similarityThreshold: 1 },
  } as UserData;
  for (const type of [
    'usenet',
    'stremio-usenet',
    'p2p',
    'http',
    'debrid',
  ] as const) {
    for (const path of ['audio', 'medium']) {
      const make = (suffix = 'S01E10', clue = true): ParsedStream => {
        const item = release(`Shared.Show.${suffix}.mkv`, { type });
        if (path === 'audio')
          item.parsedFile = {
            ...item.parsedFile,
            ...original(
              'ja',
              clue
                ? {}
                : {
                    audioTracks: undefined,
                    languages: ['Japanese', 'Original'],
                  }
            ),
          };
        else if (clue) item.releaseMedium = 'animation';
        return item;
      };
      const filter = new StreamFilterer(options);
      assert.equal(
        (await filter.filter([make()], seriesContext(metadata))).length,
        1,
        `${type}/${path}`
      );
      assert.equal(
        (await filter.filter([make('S01E10', false)], seriesContext(metadata)))
          .length,
        0
      );
      for (const suffix of [
        '2001.S01E10',
        'US.S01E10',
        'S01E11',
        'S01E10.Wrong.Episode.Name',
      ])
        assert.equal(
          (await filter.filter([make(suffix)], seriesContext(metadata))).length,
          0,
          suffix
        );
      const contradiction = make();
      contradiction.releaseIds = { tvdbId: 2 };
      assert.equal(
        (await filter.filter([contradiction], seriesContext(metadata))).length,
        0
      );
      for (const titleMatching of [
        { enabled: false },
        { enabled: true, ambiguousResults: 'keep' },
        { ...options.titleMatching, addons: ['other'] },
        { ...options.titleMatching, requestTypes: ['movie'] },
      ]) {
        const before = show.mock.callCount();
        await new StreamFilterer({
          ...options,
          titleMatching,
        } as UserData).filter([make()], seriesContext(metadata));
        assert.equal(
          show.mock.callCount(),
          before,
          JSON.stringify(titleMatching)
        );
      }
    }
  }
});

describe('ID-validated original language metadata', () => {
  it('validates and caches TMDB identities, retrying failed and missing responses', async (t) => {
    await initialiseTestSettings(t);
    const agent = mockHttp(t);
    const pool = agent.get('https://api.themoviedb.org');
    const client = new TMDBMetadata({ apiKey: 'test' });
    for (const [i, response] of [
      { id: 999, original_language: 'en' },
      { id: 98767502 },
      { id: 98767503, original_language: '' },
    ].entries()) {
      const id = 98767501 + i;
      pool.intercept({ path: `/3/tv/${id}?api_key=test` }).reply(200, response);
      await assert.rejects(client.getOriginalLanguage(id));
      pool
        .intercept({ path: `/3/tv/${id}?api_key=test` })
        .reply(200, { id, original_language: 'fr' });
      assert.equal(await client.getOriginalLanguage(id), 'fr');
      assert.equal(await client.getOriginalLanguage(id), 'fr');
    }
    agent.assertNoPendingInterceptors();
  });
  it('validates TVDB identities and treats missing or failed metadata as unknown', async (t) => {
    const client = new TVDBMetadata({ apiKey: 'test' });
    t.mock.method(client as any, 'ensureToken', async () => {});
    let response: unknown = { data: { id: 9, originalLanguage: 'fra' } };
    t.mock.method((client as any).api, 'getSeries', async () => {
      if (response instanceof Error) throw response;
      return response;
    });
    assert.equal(await client.getOriginalLanguage(9), 'fra');
    for (const data of [
      { data: { id: 10, originalLanguage: 'fra' } },
      { data: { id: 9 } },
      new Error('offline'),
    ]) {
      response = data;
      assert.equal(await client.getOriginalLanguage(9), undefined);
    }
  });
});
