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
import { settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';
import { RegexAccess } from '../utils/regex-access.js';
import type { UserData, ParsedStream } from '../db/schemas.js';
import type { StreamContext } from './context.js';

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
  episodes: titles.map((title, i) => ({
    seasonNumber: 1,
    episodeNumber: i + 1,
    title,
  })),
});

describe('additional conservative title identity evidence', () => {
  it('normalizes numbered presentation prefixes symmetrically without accepting generic labels', () => {
    for (const title of [
      'Session #2: Stray Dog Strut',
      'Episode 2 - Stray Dog Strut',
      'Chapter.2.Stray.Dog.Strut',
      'Part 2: Stray Dog Strut',
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
  });

  it('also excludes a competitor name hidden behind a numbered prefix', async () => {
    const names = await getShowIdentityEpisodeTitles(
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
    const result = await getShowIdentityEpisodeTitles(
      anime,
      new Map([['cowboybebop', [remake]]]),
      async (id) => shows.get(id)!
    );
    assert.deepEqual(
      [...result.get('cowboybebop')!],
      ['asteroidblus', 'straydogstrut']
    );
    shows.get(367234)!.episodes![1].title = null;
    assert.equal(
      (
        await getShowIdentityEpisodeTitles(
          anime,
          new Map([['cowboybebop', [remake]]]),
          async (id) => shows.get(id)!
        )
      ).size,
      0
    );
    assert.equal(
      (
        await getShowIdentityEpisodeTitles(
          anime,
          new Map([['cowboybebop', [{ title: 'Unknown', tmdbId: 1 }]]]),
          async (id) => shows.get(id)!
        )
      ).size,
      0
    );
    assert.equal(
      (
        await getShowIdentityEpisodeTitles(
          anime,
          new Map([['cowboybebop', [remake]]]),
          async () => null
        )
      ).size,
      0
    );
  });

  it('recovers logged anime episode names and old uploads in Usenet, P2P, HTTP and debrid, while keeping remake and unknown results out', async (t) => {
    t.mock.method(SettingsRepository, 'getAll', async () => []);
    t.mock.method(SettingsRepository, 'getVersion', async () => 0);
    await settingsStore.initialise();
    t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
    t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id) =>
      id === 76885
        ? catalog(id, [
            'Session #1: Asteroid Blues',
            'Session #2: Stray Dog Strut',
          ])
        : catalog(id, ['Cowboy Gospel', 'Venus Pop'])
    );
    const context = {
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
      getReleaseDates: async () => undefined,
      getEpisodeAirDate: async () => undefined,
      getEpisodeRuntime: async () => undefined,
      getPermittedPatterns: async () => ({
        permitted: new Set<string>(),
        unrestricted: true,
      }),
      toExpressionContext: () => ({}),
    } as unknown as StreamContext;
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
