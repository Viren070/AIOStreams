import '../streams/filterer.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  confirmsTitleIdentity,
  getShowIdentityEpisodeTitles,
  showIdentityEpisodeTitleKey,
  isDistinctiveEpisodeTitle,
} from './title-conflicts.js';
import { getConflictNumberingBounds } from './title-conflict-episodes.js';
import { normaliseTitle } from '../parser/utils.js';
import FileParser from '../parser/file.js';
import { mergeParsedFiles } from '../parser/merge.js';
import StreamFilterer from './filterer.js';
import { SkyhookMetadata, type SkyhookShow } from '../metadata/skyhook.js';
import { RegexAccess } from '../utils/regex-access.js';
import type { UserData, ParsedStream } from '../db/schemas.js';
import type { StreamContext } from './context.js';
import {
  initialiseTestSettings,
  createTestStreamContext,
} from '../../test/helpers.js';

const anime = {
  title: 'Cowboy Bebop',
  titles: [{ title: 'Cowboy Bebop' }],
  year: 1998,
  country: 'JP',
  tvdbId: 76885,
};
const remake = {
  title: 'Cowboy Bebop',
  year: 2021,
  country: 'US',
  tvdbId: 367234,
};
const catalog = (id: number, titles: string[]): SkyhookShow => ({
  tvdbId: id,
  title: 'Cowboy Bebop',
  status: 'Ended',
  episodes: titles.map((title, i) => ({
    seasonNumber: 1,
    episodeNumber: i + 1,
    title,
  })),
});

describe('combined evidence with the ordinary matching filters active', () => {
  it('keeps consistent shared tags from suppressing stronger release evidence', async (t) => {
    await initialiseTestSettings(t);
    let closed = true;
    let available = true;
    t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id: number) =>
      !available || id > 2
        ? null
        : {
            tvdbId: id,
            title: 'Shared Chronicle',
            status: closed ? 'Ended' : 'Continuing',
            episodes: Array.from({ length: id === 1 ? 30 : 10 }, (_, i) => ({
              seasonNumber: 1,
              episodeNumber: i + 1,
              title:
                i === 0 && id === 1
                  ? 'River of Ash'
                  : `Catalog ${id} name ${i + 1}`,
            })),
          }
    );
    const competitor = {
      title: 'Shared Chronicle',
      year: 2021,
      country: 'US',
      tvdbId: 2,
    };
    const metadata = {
      title: 'Shared Chronicle',
      titles: [{ title: 'Shared Chronicle' }],
      year: 1998,
      releaseYears: [1998],
      country: 'US',
      tvdbId: 1,
      seasons: [{ season_number: 1, episode_count: 30 }],
      titleConflicts: [competitor],
    };
    const context = (episode: number, extra = {}) =>
      createTestStreamContext({
        type: 'series',
        id: `tt1234567:1:${episode}`,
        isAnime: false,
        parsedId: {
          type: 'imdbId',
          value: 'tt1234567',
          season: '1',
          episode: String(episode),
        },
        getMetadata: async () => ({ ...metadata, ...extra }),
      });
    const filter = new StreamFilterer({
      titleMatching: {
        enabled: true,
        ambiguousResults: 'discard',
        similarityThreshold: 1,
      },
      yearMatching: { enabled: true, strict: false, tolerance: 1 },
      seasonEpisodeMatching: { enabled: true, strict: true },
    } as UserData);
    const cases = [
      { suffix: 'US.S01E20', episode: 20, keep: true },
      {
        suffix: 'US.S01E01',
        episode: 1,
        keep: true,
        extra: { age: (Date.now() - Date.UTC(2010, 0, 1)) / 3600000 },
      },
      { suffix: 'US.S01E01.River.of.Ash', episode: 1, keep: true },
      {
        suffix: '1998.S01E20',
        episode: 20,
        keep: true,
        metadata: { titleConflicts: [{ ...competitor, year: 1999 }] },
      },
      {
        suffix: 'US.S01E20',
        episode: 20,
        keep: true,
        metadata: {
          titleConflicts: [
            competitor,
            { ...competitor, country: 'CA', tvdbId: 3 },
          ],
        },
      },
      // A matching item year must remain neutral, including when catalog
      // ordering differs and the separate episode-title filter is disabled.
      {
        suffix: 'US.S01E20.River.of.Ash',
        episode: 20,
        keep: true,
        extra: { releaseYear: '1998' },
        metadata: {
          episodeTitles: [
            { title: 'Another Catalog Ordering', language: 'en' },
          ],
        },
      },
      { suffix: 'US.S01E05', episode: 5, keep: false },
      { suffix: '2021.S01E20', episode: 20, keep: false },
      { suffix: 'CA.S01E20', episode: 20, keep: false },
      {
        suffix: 'US.S01E20',
        episode: 20,
        keep: false,
        extra: { releaseIds: { tvdbId: 2 } },
      },
      {
        suffix: 'US.S01E20',
        episode: 20,
        keep: false,
        extra: { releaseYear: '2021' },
      },
      {
        suffix: 'S01E01',
        episode: 1,
        keep: false,
        extra: { releaseIds: { tvdbId: 1 }, releaseYear: '1998' },
      },
      { suffix: 'US.S01E21', episode: 20, keep: false },
    ];
    for (const item of cases) {
      const filename = `Shared.Chronicle.${item.suffix}.mkv`;
      const stream = {
        id: filename,
        type: 'usenet',
        filename,
        parsedFile: FileParser.parse(filename),
        addon: { preset: { id: 'test' } },
        ...item.extra,
      } as ParsedStream;
      assert.equal(
        (await filter.filter([stream], context(item.episode, item.metadata)))
          .length,
        item.keep ? 1 : 0,
        filename
      );
    }
    for (const state of ['ongoing', 'unavailable']) {
      closed = state !== 'ongoing';
      available = state !== 'unavailable';
      const filename = 'Shared.Chronicle.US.S01E20.mkv';
      assert.equal(
        (
          await filter.filter(
            [
              {
                id: state,
                type: 'usenet',
                filename,
                parsedFile: FileParser.parse(filename),
                addon: { preset: { id: 'test' } },
              } as ParsedStream,
            ],
            context(20)
          )
        ).length,
        0,
        state
      );
    }
  });

  it('does not mistake generic or known shared episode names for show identity', async (t) => {
    await initialiseTestSettings(t);
    let otherTitle = 'A Different Journey';
    let otherCountry = 'US';
    let ongoing = false;
    t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id: number) => ({
      tvdbId: id,
      title: 'Shared Chronicle',
      status: ongoing ? 'Continuing' : 'Ended',
      originalLanguage: id === 1 ? 'es' : 'en',
      genres: id === 1 ? ['Animation'] : ['Drama'],
      episodes: [
        {
          seasonNumber: 1,
          episodeNumber: 1,
          title:
            id === 1
              ? 'River of Ash'
              : id === 2
                ? otherTitle
                : 'Another Journey',
        },
      ],
    }));
    const metadata = (title: string) => ({
      title: 'Shared Chronicle',
      titles: [{ title: 'Shared Chronicle' }],
      year: 1998,
      releaseYears: [1998],
      country: 'US',
      tvdbId: 1,
      episodeTitles: [{ title, language: 'en' }],
      seasons: [{ season_number: 1, episode_count: 30 }],
      titleConflicts: [
        {
          title: 'Shared Chronicle',
          year: 2021,
          country: otherCountry,
          tvdbId: 2,
        },
      ],
    });
    const options = {
      titleMatching: {
        enabled: true,
        ambiguousResults: 'discard',
        similarityThreshold: 1,
      },
      yearMatching: { enabled: true, strict: false, tolerance: 1 },
      seasonEpisodeMatching: { enabled: true, strict: true },
      episodeTitleMatching: { enabled: true, similarityThreshold: 1 },
    } as UserData;
    const check = async (
      title: string,
      keep: boolean,
      prefix = '',
      extraMetadata = {},
      extraFile = {}
    ) => {
      const filename = `Shared.Chronicle.${prefix}S01E01.${title.replaceAll(' ', '.')}.mkv`;
      const stream = {
        id: filename,
        type: 'usenet',
        filename,
        parsedFile: { ...FileParser.parse(filename), ...extraFile },
        addon: { preset: { id: 'test' } },
      } as ParsedStream;
      const context = createTestStreamContext({
        type: 'series',
        id: 'tt1234567:1:1',
        isAnime: false,
        parsedId: {
          type: 'imdbId',
          value: 'tt1234567',
          season: '1',
          episode: '1',
        },
        getMetadata: async () => ({ ...metadata(title), ...extraMetadata }),
      });
      assert.equal(
        (await new StreamFilterer(options).filter([stream], context)).length,
        keep ? 1 : 0,
        filename
      );
    };
    for (const title of ['Pilot', 'Finale', 'Episode 1', 'Chapter Eleven'])
      await check(title, false);
    await check('Pilot', true, '1998.');
    await check(
      'Pilot',
      true,
      '',
      { originalLanguage: 'es' },
      {
        mediaInfoQuality: 'probe',
        audioTracks: [{ lang: 'es', original: true }],
      }
    );
    await check(
      'Pilot',
      false,
      '',
      { originalLanguage: 'es' },
      {
        languages: ['Spanish', 'English'],
        audioTags: ['Dual Audio'],
      }
    );
    await check('River of Ash', true);
    await check('Echo', true); // Short real names already matched by metadata remain usable.
    otherTitle = 'Echo';
    await check('Echo', false);
    otherTitle = 'Homecoming';
    await check('Homecoming', false);
    ongoing = true;
    await check('Homecoming', false); // Presence is useful even in an incomplete catalog.
    ongoing = false;
    await check('Homecoming', true, '1998.'); // A shared name does not veto a distinguishing year.
    await check('River of Ash', false, '2021.'); // Year Matching still owns this rejection.
    for (const title of [
      'Chapter IV - Homecoming',
      'Episode One - Homecoming',
      'Session #1 Homecoming',
    ])
      await check(title, false, '', {
        episodeTitles: [{ title: 'Homecoming', language: 'en' }],
      });
    options.episodeTitleMatching!.similarityThreshold = 0.8;
    for (const prefix of ['', '1998.'])
      await check('Pilott', !!prefix, prefix, {
        episodeTitles: [{ title: 'Pilot', language: 'en' }],
      });
    await check('Homecomming', false, '', {
      episodeTitles: [{ title: 'Homecoming', language: 'en' }],
    });
    await check('River of Ashe', true, '', {
      episodeTitles: [{ title: 'River of Ash', language: 'en' }],
    });
    options.episodeTitleMatching!.similarityThreshold = 1;
    otherCountry = 'CA';
    await check('Homecoming', true, 'US.', {
      titleConflicts: [
        metadata('Homecoming').titleConflicts[0],
        { title: 'Shared Chronicle', year: 2021, country: 'US', tvdbId: 3 },
      ],
    }); // Different evidence may exclude different competitors.
  });
});

describe('additional conservative title identity evidence', () => {
  it('normalizes numbered presentation prefixes symmetrically without accepting generic labels', () => {
    for (const title of [
      'Session #2: Stray Dog Strut',
      'Episode 2 - Stray Dog Strut',
      'Chapter.2.Stray.Dog.Strut',
      'Part 2: Stray Dog Strut',
      'Chapter IV: Stray Dog Strut',
      'Episode One - Stray Dog Strut',
      'Stray Dog Strut',
    ]) {
      assert.equal(showIdentityEpisodeTitleKey(title), 'straydogstrut');
    }
    for (const title of ['Session #2', 'Episode 2', 'Chapter 2', 'Part 2']) {
      assert.equal(isDistinctiveEpisodeTitle(title), false);
    }
    assert.equal(
      showIdentityEpisodeTitleKey('Session Zero'),
      normaliseTitle('Session Zero')
    );
    for (const title of ['Chapter Vic - Homecoming', 'Part Did - Homecoming'])
      assert.equal(showIdentityEpisodeTitleKey(title), normaliseTitle(title));
  });

  it('also excludes a competitor name hidden behind a numbered prefix', async () => {
    const { episodeTitles: names } = await getShowIdentityEpisodeTitles(
      anime,
      new Map([['cowboybebop', [remake]]]),
      async (id) =>
        catalog(id, [
          id === anime.tvdbId
            ? 'Stray Dog Strut'
            : 'Session #2: Stray Dog Strut',
        ])
    );
    assert.equal(names.get('cowboybebop')?.size, 0);
  });

  it('uses old upload dates without admitting modern, invalid or explicitly conflicting releases', () => {
    for (const year of [1998, 2007, 2019])
      assert.equal(
        confirmsTitleIdentity(anime, [remake], { uploadYear: year }),
        true
      );
    for (const year of [
      undefined,
      NaN,
      Infinity,
      2019.5,
      1997,
      2020,
      2021,
      2026,
    ])
      assert.equal(
        confirmsTitleIdentity(anime, [remake], { uploadYear: year }),
        false
      );
    assert.equal(
      confirmsTitleIdentity(anime, [remake], { uploadYear: 2010, year: 2021 }),
      false
    );
    assert.equal(
      confirmsTitleIdentity(anime, [remake], {
        uploadYear: 2010,
        country: 'US',
      }),
      false
    );
    assert.equal(
      confirmsTitleIdentity(anime, [remake, { title: 'Unknown' }], {
        uploadYear: 2010,
      }),
      false
    );
    assert.equal(
      confirmsTitleIdentity(anime, [remake, { ...remake, year: 2000 }], {
        uploadYear: 2010,
      }),
      false
    );
  });

  it('uses verified season-only evidence for every competitor, never as episode-count evidence', async () => {
    const conflicts = [
      { title: 'Love Island', tmdbId: 90522 },
      { title: 'Love Island', tvdbId: 9, tmdbId: 10 },
    ];
    const bounds = await getConflictNumberingBounds(
      conflicts,
      async () => null,
      undefined,
      async () => {
        throw Error('incomplete episode list');
      },
      async () => 3
    );
    assert.deepEqual([...bounds.values()], [{ season: 3 }, { season: 3 }]);
    const show = { title: 'Love Island', titles: [] };
    assert.equal(
      confirmsTitleIdentity(show, conflicts, {
        season: 12,
        conflictNumberingBounds: bounds,
      }),
      true
    );
    assert.equal(
      confirmsTitleIdentity(show, conflicts, {
        episode: 99,
        conflictNumberingBounds: bounds,
      }),
      false
    );
    assert.equal(
      confirmsTitleIdentity(show, conflicts, {
        season: 2,
        conflictNumberingBounds: bounds,
      }),
      false
    );
    bounds.delete('tmdb:90522');
    assert.equal(
      confirmsTitleIdentity(show, conflicts, {
        season: 12,
        conflictNumberingBounds: bounds,
      }),
      false
    );
  });

  it('distinguishes show identity despite ordering differences and excludes shared/generic episode names', async () => {
    const shows = new Map([
      [
        76885,
        catalog(76885, [
          'Asteroid Blues',
          'Stray Dog Strut',
          'Episode 3',
          'Shared Episode Name',
        ]),
      ],
      [
        367234,
        catalog(367234, ['Cowboy Gospel', 'Venus Pop', 'Shared Episode Name']),
      ],
    ]);
    const { episodeTitles: result } = await getShowIdentityEpisodeTitles(
      anime,
      new Map([['cowboybebop', [remake]]]),
      async (id) => shows.get(id)!
    );
    assert.deepEqual(
      [...result.get('cowboybebop')!],
      ['asteroidblus', 'straydogstrut']
    );
    shows.get(367234)!.episodes![1].title = null;
    const partial = await getShowIdentityEpisodeTitles(
      anime,
      new Map([['cowboybebop', [remake]]]),
      async (id) => shows.get(id)!
    );
    assert.equal(partial.episodeTitles.size, 0);
    assert.ok(
      partial.conflictEpisodeTitles
        .get(remake.tvdbId)
        ?.includes('sharedepisodename')
    );
    assert.equal(
      (
        await getShowIdentityEpisodeTitles(
          anime,
          new Map([['cowboybebop', [remake]]]),
          async (id) =>
            id === anime.tvdbId
              ? shows.get(id)!
              : catalog(123, ['Shared Episode Name'])
        )
      ).conflictEpisodeTitles.size,
      0
    );
    assert.equal(
      (
        await getShowIdentityEpisodeTitles(
          anime,
          new Map([['cowboybebop', [{ title: 'Unknown', tmdbId: 1 }]]]),
          async (id) => shows.get(id)!
        )
      ).episodeTitles.size,
      0
    );
    assert.equal(
      (
        await getShowIdentityEpisodeTitles(
          anime,
          new Map([['cowboybebop', [remake]]]),
          async () => null
        )
      ).episodeTitles.size,
      0
    );
  });

  it('recovers episode names across explicit provider mappings without guessing missing or contradictory identities', async (t) => {
    await initialiseTestSettings(t);
    t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
    const requested = {
      title: 'Shared Chronicle',
      titles: [{ title: 'Shared Chronicle' }],
      year: 2004,
      tvdbId: 1,
    };
    const tvdbCompetitor = { title: 'Shared Chronicle', tvdbId: 2 };
    const tmdbCompetitor = { title: 'Shared Chronicle', tmdbId: 20 };
    let other = { ...catalog(2, ['Other Episode Name']), tmdbId: 20 };
    let third = { ...catalog(3, ['Third Episode Name']), tmdbId: 30 };
    let requestedTmdb: number | undefined;
    const calls: number[] = [];
    const getShow = async (id: number) => {
      calls.push(id);
      return id === 1
        ? { ...catalog(1, ['River of Ash']), tmdbId: requestedTmdb }
        : id === 2
          ? other
          : third;
    };
    t.mock.method(SkyhookMetadata.prototype, 'getShow', getShow);
    for (const scenario of [
      'mapped',
      'unmapped',
      'contradictory',
      'partial',
      'ongoing',
      'shared',
      'wrong-tvdb',
      'wrong-tmdb',
      'requested-mapping',
    ]) {
      other = { ...catalog(2, ['Other Episode Name']), tmdbId: 20 };
      third = { ...catalog(3, ['Third Episode Name']), tmdbId: 30 };
      requestedTmdb = scenario === 'requested-mapping' ? 20 : undefined;
      if (scenario === 'unmapped') other.tmdbId = 21;
      if (scenario === 'contradictory') third.tmdbId = 20;
      if (scenario === 'partial')
        other.episodes!.push({
          seasonNumber: 1,
          episodeNumber: 2,
          title: null,
        });
      if (scenario === 'ongoing') other.status = 'Continuing';
      if (scenario === 'shared') other.episodes![0].title = 'River of Ash';
      if (scenario === 'wrong-tvdb') other.tvdbId = 99;
      const competitors = [
        scenario === 'wrong-tmdb'
          ? { ...tvdbCompetitor, tmdbId: 99 }
          : tvdbCompetitor,
        tmdbCompetitor,
        ...(scenario === 'contradictory'
          ? [{ title: 'Shared Chronicle', tvdbId: 3 }]
          : []),
      ];
      calls.length = 0;
      const evidence = await getShowIdentityEpisodeTitles(
        requested,
        new Map([['sharedchronicle', competitors]]),
        getShow
      );
      assert.equal(
        evidence.episodeTitles.get('sharedchronicle')?.has('riverofash') ??
          false,
        scenario === 'mapped',
        scenario
      );
      assert.equal(
        calls.length,
        scenario === 'contradictory' ? 3 : 2,
        'reuse catalogues without an extra mapping lookup'
      );
      if (
        scenario === 'mapped' ||
        scenario === 'shared' ||
        scenario === 'partial'
      ) {
        assert.deepEqual(
          evidence.conflictEpisodeTitles.get(2),
          evidence.conflictEpisodeTitles.get('tmdb:20'),
          'keep competitor names under both provider keys'
        );
      }
      if (scenario === 'mapped') {
        const acrossAliases = await getShowIdentityEpisodeTitles(
          requested,
          new Map([
            ['anotheralias', [tvdbCompetitor]],
            ['sharedchronicle', [tmdbCompetitor]],
          ]),
          getShow
        );
        assert.equal(
          acrossAliases.episodeTitles.get('sharedchronicle')?.has('riverofash'),
          true
        );
      }
      const filename = 'Shared.Chronicle.S01E01.River.of.Ash.1080p.mkv';
      const release = {
        id: 'one',
        type: 'usenet',
        filename,
        parsedFile: FileParser.parse(filename),
        addon: { preset: { id: 'newznab' } },
      } as ParsedStream;
      const context = createTestStreamContext({
        type: 'series',
        id: 'tt1234567:1:1',
        isAnime: false,
        parsedId: {
          type: 'imdbId',
          value: 'tt1234567',
          season: '1',
          episode: '1',
        },
        getMetadata: async () => ({
          ...requested,
          titleConflicts: competitors,
        }),
      });
      const filter = new StreamFilterer({
        titleMatching: { enabled: true, ambiguousResults: 'discard' },
      } as UserData);
      assert.equal(
        (await filter.filter([release], context)).length,
        scenario === 'mapped' ? 1 : 0,
        `filter ${scenario}`
      );
    }
  });

  it('recovers logged anime episode names and old uploads in Usenet, P2P, HTTP and debrid, while keeping remake and unknown results out', async (t) => {
    await initialiseTestSettings(t);
    t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
    t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id) =>
      id === 76885
        ? catalog(id, [
            'Session #1: Asteroid Blues',
            'Session #2: Stray Dog Strut',
          ])
        : catalog(id, ['Cowboy Gospel', 'Venus Pop'])
    );
    const context = createTestStreamContext({
      type: 'series',
      id: 'tt0213338:1:2',
      isAnime: true,
      parsedId: { type: 'imdbId', season: '1', episode: '2' },
      getMetadata: async () => ({
        ...anime,
        titleConflicts: [remake],
        absoluteEpisode: 2,
        seasons: [{ season_number: 1, episode_count: 26 }],
      }),
    });
    const names = [
      'Cowboy.Bebop.S01E02.Stray.Dog.Strut.1080p.BluRay.Opus.5.1.x265-Kitsune.mkv',
      'Cowboy.Bebop.S01E02.Venus.Pop.1080p.NF.WEB-DL.mkv',
      '[Moozzi2] Cowboy Bebop - 02 (BD 1448x1080 x265-10Bit 2Audio)',
      'Cowboy.Bebop.S01E02.1080p.WEB-DL.mkv',
      'Cowboy.Bebop.2021.S01E02.1080p.WEB-DL.mkv',
    ];
    assert.equal(
      normaliseTitle(FileParser.parse(names[0]).episodeTitle!),
      'straydogstrut'
    );
    for (const type of ['usenet', 'p2p', 'http', 'debrid']) {
      const streams = names.map((filename, i) => ({
        id: String(i),
        type,
        filename,
        parsedFile: FileParser.parse(filename),
        addon: { preset: { id: 'newznab' } },
        ...(i === 2 || i === 4
          ? { age: (Date.now() - Date.UTC(2010, 0, 1)) / 3600000 }
          : {}),
      })) as ParsedStream[];
      const filter = new StreamFilterer({
        titleMatching: { enabled: true, ambiguousResults: 'discard' },
      } as UserData);
      assert.deepEqual(
        (await filter.filter(streams, context)).map((s) => s.id),
        ['0', '2']
      );
      const recoveredCases = [
        ['S01E02 - Stray Dog Strut.mkv', 'Cowboy Bebop S01', true],
        ['02 - Stray Dog Strut.mkv', 'Cowboy Bebop S01', true],
        ['Ep-02 Stray Dog Strut.mkv', 'Cowboy Bebop S01', true],
        [
          '[CBM]_Cowboy_Bebop_-_Session_02_-_Stray_Dog_Strut_[720p]_[84AE25B6].mkv',
          undefined,
          true,
        ],
        ['S01E02 - Stray Dog Strut.mkv', undefined, false],
        ['S01E02 - Stray Dog Strut.mkv', 'Other Show S01', false],
        ['S01E02 - Venus Pop.mkv', 'Cowboy Bebop S01', false],
        ['S01E02 - Stray Dog Strut.mkv', 'Cowboy Bebop 2021 S01', false],
        ['S01E03 - Stray Dog Strut.mkv', 'Cowboy Bebop S01', false],
        [
          'Other Show - Session 02 - Stray Dog Strut.mkv',
          'Cowboy Bebop S01',
          false,
        ],
        [
          'Cowboy Bebop - Session 02 - Stray Dog Strut.mkv',
          'Cowboy Bebop 1-26 Complete',
          true,
        ],
        [
          'Cowboy Bebop - Session 23 - Brain Scratch.mkv',
          'Cowboy Bebop 1-26 Complete',
          false,
        ],
        [
          'Cowboy Bebop - Session 02 - Venus Pop.mkv',
          'Cowboy Bebop 1-26 Complete',
          false,
        ],
        [
          'Cowboy Bebop - Session 02-03 - Stray Dog Strut.mkv',
          'Cowboy Bebop 1-26 Complete',
          false,
        ],
      ] as const;
      const recoveryFilter = new StreamFilterer({
        titleMatching: { enabled: true, ambiguousResults: 'discard' },
        yearMatching: { enabled: true },
        seasonEpisodeMatching: { enabled: true, strict: true },
      } as UserData);
      for (const [filename, folderName, keep] of recoveredCases) {
        const stream = {
          id: 'recovered',
          type,
          filename,
          folderName,
          parsedFile: mergeParsedFiles(
            FileParser.parse(filename),
            folderName ? FileParser.parse(folderName) : undefined
          ),
          addon: { preset: { id: 'test' } },
        } as ParsedStream;
        assert.equal(
          (await recoveryFilter.filter([stream], context)).length,
          keep ? 1 : 0,
          `${type}: ${filename} / ${folderName}`
        );
      }
      const remakeContext = {
        ...context,
        isAnime: false,
        getMetadata: async () => ({
          ...remake,
          titles: [{ title: 'Cowboy Bebop' }],
          titleConflicts: [anime],
          seasons: [{ season_number: 1, episode_count: 10 }],
        }),
      } as unknown as StreamContext;
      for (const [suffix, keep] of [
        ['Session 02 - Venus Pop', true],
        ['Session 02 - Stray Dog Strut', false],
        ['S01E02.1080p.WEB-DL', false],
      ] as const) {
        const filename = `Cowboy Bebop - ${suffix}.mkv`;
        const stream = {
          id: 'reverse',
          type,
          filename,
          parsedFile: FileParser.parse(filename),
          addon: { preset: { id: 'test' } },
        } as ParsedStream;
        assert.equal(
          (await recoveryFilter.filter([stream], remakeContext)).length,
          keep ? 1 : 0,
          `${type}: remake request: ${filename}`
        );
      }
      const strict = new StreamFilterer({
        titleMatching: { enabled: true, ambiguousResults: 'discard' },
        seasonEpisodeMatching: { enabled: true, strict: true },
        episodeTitleMatching: { enabled: true, similarityThreshold: 1 },
      } as UserData);
      const orderedContext = {
        ...context,
        getMetadata: async () => ({
          ...(await context.getMetadata()),
          episodeTitles: [{ title: 'Asteroid Blues', language: 'en' }],
        }),
      } as unknown as StreamContext;
      assert.deepEqual(
        (await strict.filter([streams[0]], orderedContext)).map((s) => s.id),
        [],
        'show identity must not bypass an active episode-title rejection'
      );
      const wrongNumber = {
        ...streams[0],
        filename: names[0].replace('S01E02', 'S01E03'),
        parsedFile: FileParser.parse(names[0].replace('S01E02', 'S01E03')),
      };
      assert.deepEqual(
        (await strict.filter([wrongNumber], context)).map((s) => s.id),
        [],
        'show identity must not bypass episode-number matching'
      );
    }
  });
});
