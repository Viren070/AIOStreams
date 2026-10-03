import './filterer.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getOriginalAudioLanguage,
  getConflictOriginalLanguages,
  confirmsTitleIdentity,
} from './title-conflicts.js';
import StreamFilterer from './filterer.js';
import FileParser from '../parser/file.js';
import { SkyhookMetadata } from '../metadata/skyhook.js';
import { TMDBMetadata } from '../metadata/tmdb.js';
import { TVDBMetadata } from '../metadata/tvdb.js';
import { RegexAccess } from '../utils/regex-access.js';
import { normaliseParsedMediaInfo } from '../utils/media-info.js';
import type { ParsedFile, ParsedStream, UserData } from '../db/schemas.js';
import type { StreamContext } from './context.js';
import {
  initialiseTestSettings,
  mockHttp,
  createTestStreamContext,
} from '../../test/helpers.js';

const file = (
  language: string,
  quality: ParsedFile['mediaInfoQuality'] = 'probe'
): ParsedFile => ({
  ...FileParser.parse('Shared.Show.S01E10.mkv'),
  languages: [language, 'Original'],
  mediaInfoQuality: quality,
  audioTracks: [{ lang: language, original: true }],
});

describe('independent original audio for title identity', () => {
  it('uses supported languages generically and treats regional variants as one language', () => {
    for (const [input, output] of [
      ['jpn', 'ja'],
      ['English', 'en'],
      ['fre', 'fr'],
      ['es-MX', 'es'],
      ['Portuguese (Brazil)', 'pt'],
      ['German', 'de'],
      ['kor', 'ko'],
    ])
      assert.equal(getOriginalAudioLanguage(file(input)), output, input);
  });

  it('rejects unconfirmed, dub, commentary, missing, conflicting and inferred evidence', () => {
    const cases: ParsedFile[] = [
      file('Original'),
      file('und'),
      file('Atlantis'),
      file('Japanese', 'addon'),
    ];
    cases.push({ ...file('Japanese'), mediaInfoQuality: undefined });
    for (const flag of ['dub', 'commentary', 'visualImpaired'])
      cases.push({
        ...file('Japanese'),
        audioTracks: [{ lang: 'Japanese', original: true, [flag]: true }],
      });
    cases.push({ ...file('Japanese'), audioTracks: [{ lang: 'Japanese' }] });
    cases.push({ ...file('Japanese'), audioTracks: undefined });
    cases.push({ ...file('Japanese'), audioTracks: [{ original: true }] });
    cases.push({
      ...file('Japanese'),
      audioTracks: [
        { lang: 'Japanese', original: true },
        { lang: 'English', original: true },
      ],
    });
    cases.push({
      ...file('Japanese'),
      audioTracks: [{ lang: 'Japanese', original: true }, { original: true }],
    });
    for (const candidate of cases)
      assert.equal(getOriginalAudioLanguage(candidate), undefined);
    assert.equal(getOriginalAudioLanguage(undefined), undefined);
    assert.equal(
      getOriginalAudioLanguage({
        ...file('Japanese'),
        audioTracks: [
          { lang: 'Japanese', original: true },
          { lang: 'English', dub: true },
        ],
      }),
      'ja'
    );
  });

  it('requires every competitor to be distinguished and preserves explicit contradictions', () => {
    const metadata = {
      title: 'Shared Show',
      originalLanguage: 'fr',
      year: 1994,
      country: 'FR',
    };
    const competitors = [
      { title: 'Shared Show', tvdbId: 2 },
      { title: 'Shared Show', tmdbId: 3 },
    ];
    const evidence = {
      originalAudioLanguage: 'French',
      conflictOriginalLanguages: new Map<number | string, string>([
        [2, 'English'],
        ['tmdb:3', 'German'],
      ]),
    };
    assert.equal(confirmsTitleIdentity(metadata, competitors, evidence), true);
    for (const override of [
      { year: 2021 },
      { year: 'unknown' },
      { country: 'US' },
      { originalAudioLanguage: 'English' },
    ])
      assert.equal(
        confirmsTitleIdentity(metadata, competitors, {
          ...evidence,
          ...override,
        }),
        false
      );
    assert.equal(
      confirmsTitleIdentity(
        { ...metadata, originalLanguage: undefined },
        competitors,
        evidence
      ),
      false
    );
    for (const other of ['fr', 'fr-CA', 'und']) {
      evidence.conflictOriginalLanguages.set('tmdb:3', other);
      assert.equal(
        confirmsTitleIdentity(metadata, competitors, evidence),
        false,
        other
      );
    }
    evidence.conflictOriginalLanguages.delete('tmdb:3');
    assert.equal(confirmsTitleIdentity(metadata, competitors, evidence), false);
    assert.equal(
      confirmsTitleIdentity(metadata, [{ title: 'Unknown' }], evidence),
      false
    );
    // Same-language versions can still be separated by another discriminator.
    assert.equal(
      confirmsTitleIdentity(
        metadata,
        [{ title: 'Shared Show', tvdbId: 2, year: 2021 }],
        {
          year: 1994,
          originalAudioLanguage: 'French',
          conflictOriginalLanguages: new Map([[2, 'French']]),
        }
      ),
      true
    );
  });

  it('deduplicates provider lookups, uses validated fallbacks and rejects source disagreement', async () => {
    const calls: string[] = [];
    const languages = await getConflictOriginalLanguages(
      [
        { title: 'One', tvdbId: 1 },
        { title: 'One', tvdbId: 1 },
        { title: 'Two', tvdbId: 2 },
        { title: 'Three', tmdbId: 3 },
        { title: 'Four', tvdbId: 4, tmdbId: 4 },
        { title: 'Five', tvdbId: 5 },
        { title: 'Unknown' },
      ],
      async (id) => {
        calls.push(`skyhook:${id}`);
        return id === 1 || id === 4 ? 'eng' : undefined;
      },
      async (id) => {
        calls.push(`tvdb:${id}`);
        if (id === 5) throw Error('offline');
        return 'fra';
      },
      async (id) => {
        calls.push(`tmdb:${id}`);
        return id === 4 ? 'German' : 'es';
      }
    );
    assert.deepEqual(
      [...languages].sort(),
      [
        [1, 'en'],
        [2, 'fr'],
        ['tmdb:3', 'es'],
      ].sort()
    );
    assert.equal(calls.filter((c) => c === 'skyhook:1').length, 1);
    assert.equal(calls.includes('tvdb:1'), false);
    const conflictingDuplicates = await getConflictOriginalLanguages(
      [
        { title: 'Shared', tvdbId: 9, tmdbId: 10 },
        { title: 'Shared', tvdbId: 9, tmdbId: 11 },
      ],
      async () => 'French',
      undefined,
      async (id) => (id === 10 ? 'French' : 'English')
    );
    assert.equal(conflictingDuplicates.size, 0);
  });

  it('never accepts a wrong-ID Skyhook response as original language evidence', async (t) => {
    t.mock.method(SkyhookMetadata.prototype, 'getShow', async () => ({
      tvdbId: 999,
      title: 'Wrong',
      originalLanguage: 'eng',
    }));
    assert.equal(
      (await getConflictOriginalLanguages([{ title: 'Shared', tvdbId: 42 }]))
        .size,
      0
    );
  });

  it('does not invent original-track roles for the logged Easynews releases', async (t) => {
    await initialiseTestSettings(t);
    t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
    t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id) => ({
      tvdbId: id,
      title: 'Marmalade Boy',
      originalLanguage: 'kor',
      episodes: Array.from({ length: 30 }, (_, i) => ({
        seasonNumber: 1,
        episodeNumber: i + 1,
      })),
    }));
    t.mock.method(
      TMDBMetadata.prototype,
      'getOriginalLanguage',
      async () => 'zh'
    );
    const metadata = {
      title: 'Marmalade Boy',
      titles: [{ title: 'Marmalade Boy' }],
      year: 1994,
      originalLanguage: 'ja',
      country: 'JP',
      titleConflicts: [
        { title: 'Marmalade Boy', tmdbId: 96475, year: 2001, country: 'TW' },
        { title: 'Marmalade Boy', tvdbId: 455890, year: 2001, country: 'KR' },
      ],
      seasons: [{ season_number: 1, episode_count: 76 }],
    };
    const context = createTestStreamContext({
      type: 'series',
      id: 'tt0108850:1:10',
      isAnime: true,
      parsedId: { type: 'imdbId', season: '1', episode: '10' },
      getMetadata: async () => metadata,
    });
    const filter = new StreamFilterer({
      tmdbApiKey: 'test',
      titleMatching: { enabled: true, ambiguousResults: 'discard' },
      seasonEpisodeMatching: { enabled: true, strict: true },
    } as UserData);
    for (const [name, languages] of [
      [
        '[Xanth]_Marmalade_Boy_10_DVDrip_dual_x264_10b_[A44BF6C9].mkv',
        ['Japanese', 'English'],
      ],
      [
        '[xPearse].Marmalade.Boy.-.Episode.10.[English].[Dual-Audio].[480p].mkv',
        ['Japanese', 'English'],
      ],
      ['[zimabdk]Marmalade.Boy.EP10.mp4', ['English']],
    ] as const) {
      const stream = {
        id: name,
        type: 'usenet',
        filename: name,
        parsedFile: {
          ...FileParser.parse(name),
          ...normaliseParsedMediaInfo({
            mediaInfoQuality: 'indexer',
            languages: [...languages],
          }),
        },
        addon: { preset: { id: 'test' } },
      } as ParsedStream;
      assert.equal((await filter.filter([stream], context)).length, 0, name);
      // A real provider/probe role could recover these, but a plain list cannot.
      stream.parsedFile!.audioTracks = [{ lang: 'Japanese', original: true }];
      assert.equal((await filter.filter([stream], context)).length, 1, name);
    }
  });

  it('recovers independent originals across stream types without admitting ordinary dubs or bypassing filters', async (t) => {
    await initialiseTestSettings(t);
    t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
    let lookups = 0;
    t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id) => {
      lookups++;
      return {
        tvdbId: id,
        title: 'Shared Show',
        originalLanguage: id === 12 ? 'spa' : 'eng',
        episodes: Array.from({ length: 30 }, (_, i) => ({
          seasonNumber: 1,
          episodeNumber: i + 1,
          title: `Episode ${i + 1}`,
        })),
      };
    });
    const metadata = {
      title: 'Shared Show',
      titles: [{ title: 'Shared Show' }],
      originalLanguage: 'es',
      country: 'ES',
      year: 1994,
      tvdbId: 12,
      titleConflicts: [
        { title: 'Shared Show', tvdbId: 13, year: 2001, country: 'US' },
      ],
      seasons: [{ season_number: 1, episode_count: 76 }],
      episodeTitles: [{ title: 'A Real Episode Name', language: 'es' }],
    };
    const context = createTestStreamContext({
      type: 'series',
      id: 'tt0108850:1:10',
      isAnime: false,
      parsedId: { type: 'imdbId', season: '1', episode: '10' },
      getMetadata: async () => metadata,
    });
    const makeStream = (
      type: ParsedStream['type'],
      name = 'Shared.Show.S01E10.mkv',
      original = true
    ): ParsedStream =>
      ({
        id: name,
        type,
        filename: name,
        parsedFile: {
          ...FileParser.parse(name),
          languages: ['Spanish', 'Original'],
          mediaInfoQuality: 'indexer',
          audioTracks: [{ lang: 'Spanish', original }],
        },
        addon: { preset: { id: 'test' } },
      }) as ParsedStream;
    const filter = new StreamFilterer({
      titleMatching: { enabled: true, ambiguousResults: 'discard' },
      yearMatching: { enabled: true },
      seasonEpisodeMatching: { enabled: true, strict: true },
      episodeTitleMatching: { enabled: true, similarityThreshold: 1 },
    } as UserData);
    for (const type of [
      'usenet',
      'stremio-usenet',
      'p2p',
      'http',
      'debrid',
    ] as const) {
      assert.equal(
        (await filter.filter([makeStream(type)], context)).length,
        1,
        type
      );
      for (const name of [
        'Shared.Show.2001.S01E10.mkv',
        'Shared.Show.S01E11.mkv',
        'Other.Show.S01E10.mkv',
        'Shared.Show.S01E10.A.Wrong.Episode.Name.mkv',
      ])
        assert.equal(
          (await filter.filter([makeStream(type, name)], context)).length,
          0,
          `${type}: ${name}`
        );
      assert.equal(
        (
          await filter.filter(
            [makeStream(type, 'Shared.Show.S01E10.mkv', false)],
            context
          )
        ).length,
        0,
        `${type}: dub/unmarked`
      );
      const dubbedRelease = makeStream(
        type,
        'Shared.Show.1994.S01E10.mkv',
        false
      );
      dubbedRelease.parsedFile!.audioTracks = [{ lang: 'English', dub: true }];
      assert.equal(
        (await filter.filter([dubbedRelease], context)).length,
        1,
        `${type}: a correct dub identified by year`
      );
      // A competitor dubbed into the requested language can omit its original
      // language entirely. That absence is not evidence excluding the competitor.
      for (const mediaInfoQuality of ['probe', 'indexer'] as const) {
        const dubWithoutOriginal = makeStream(
          type,
          'Shared.Show.S01E10.mkv',
          false
        );
        dubWithoutOriginal.parsedFile!.mediaInfoQuality = mediaInfoQuality;
        dubWithoutOriginal.parsedFile!.languages = ['Spanish'];
        dubWithoutOriginal.parsedFile!.audioTracks = [
          { lang: 'Spanish', dub: true },
        ];
        assert.equal(
          (await filter.filter([dubWithoutOriginal], context)).length,
          0,
          `${type}: ${mediaInfoQuality} audio list without the competitor's language cannot exclude a dub`
        );
      }
      const languageTag = makeStream(type, 'Shared.Show.S01E10.SUBSPANISH.mkv');
      assert.equal(
        (await filter.filter([languageTag], context)).length,
        1,
        `${type}: subtitle label`
      );
      assert.equal(
        (
          await filter.filter(
            [makeStream(type, 'Shared.Show.S01E10.SUBSPANISH.mkv', false)],
            context
          )
        ).length,
        0,
        `${type}: a subtitle label alone cannot identify the show`
      );
      const reverse = {
        ...context,
        getMetadata: async () => ({
          ...metadata,
          originalLanguage: 'en',
          country: 'US',
          year: 2001,
          tvdbId: 13,
          titleConflicts: [
            { title: 'Shared Show', tvdbId: 12, year: 1994, country: 'ES' },
          ],
        }),
      } as unknown as StreamContext;
      assert.equal(
        (await filter.filter([makeStream(type)], reverse)).length,
        0,
        `${type}: reverse request`
      );
      const noLanguageContext = {
        ...context,
        getMetadata: async () => ({ ...metadata, originalLanguage: undefined }),
      } as unknown as StreamContext;
      assert.equal(
        (await filter.filter([makeStream(type)], noLanguageContext)).length,
        0,
        `${type}: missing requested language`
      );
    }
    const ordinaryDub = makeStream('http', 'Shared.Show.S01E10.mkv', false);
    ordinaryDub.parsedFile!.episodes = [1];
    ordinaryDub.filename = 'Shared.Show.S01E01.mkv';
    const episodeOneContext = {
      ...context,
      parsedId: { type: 'imdbId', season: '1', episode: '1' },
      id: 'tt0108850:1:1',
    } as unknown as StreamContext;
    const before = lookups;
    assert.equal(
      (await filter.filter([ordinaryDub], episodeOneContext)).length,
      0
    );
    assert.equal(
      lookups,
      before,
      'unmarked audio must not trigger competitor lookups'
    );

    const titleOnlyFilter = new StreamFilterer({
      titleMatching: { enabled: true, ambiguousResults: 'discard' },
      episodeTitleMatching: { enabled: false, similarityThreshold: 1 },
    } as UserData);
    assert.equal(
      (
        await titleOnlyFilter.filter(
          [makeStream('http', 'Shared.Show.S01E10.A.Wrong.Episode.Name.mkv')],
          context
        )
      ).length,
      0,
      'original audio cannot override a known wrong episode name even with the separate episode filter disabled'
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
      const scopedFilter = new StreamFilterer({ titleMatching } as UserData);
      const before = lookups;
      assert.equal(
        (await scopedFilter.filter([makeStream('http')], context)).length,
        1
      );
      assert.equal(lookups, before, 'no lookups outside discard scope');
    }
  });
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
