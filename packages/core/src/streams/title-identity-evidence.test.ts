import './filterer.js';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import type { Metadata, TitleConflict } from '../metadata/utils.js';
import type { UserData } from '../db/schemas.js';
import { SkyhookMetadata } from '../metadata/skyhook.js';
import { RegexAccess } from '../utils/regex-access.js';
import { mergeParsedFiles } from '../parser/merge.js';
import FileParser from '../parser/file.js';
import { normaliseTitle } from '../parser/utils.js';
import StreamFilterer from './filterer.js';
import {
  confirmsTitleIdentity,
  analyseShowIdentityEpisodeTitles,
  isDistinctiveEpisodeTitle,
  isGenericEpisodeTitle,
  releaseUploadYear,
  showIdentityEpisodeTitleKey,
} from './title-conflicts.js';
import { initialiseTestSettings } from '../../test/helpers.js';
import {
  namedCatalogue,
  release,
  seriesContext,
} from '../../test/title-fixtures.js';

const requested: Metadata = {
  title: 'Shared Chronicle',
  titles: [{ title: 'Shared Chronicle' }],
  year: 1998,
  country: 'JP',
  tvdbId: 1,
};
const competitor: TitleConflict = {
  title: 'Shared Chronicle',
  tvdbId: 2,
  year: 2021,
  country: 'US',
};

it('T11/T12: numbered presentation labels normalize symmetrically; generic and short names cannot prove catalogue absence', () => {
  for (const title of [
    'Session #2: River of Ash',
    'Episode 2 - River of Ash',
    'Chapter.2.River.of.Ash',
    'Part 2: River of Ash',
    'Chapter IV: River of Ash',
    'Episode One - River of Ash',
    'River of Ash',
  ])
    assert.equal(showIdentityEpisodeTitleKey(title), 'riverofash');
  for (const title of [
    'Session Zero',
    'Chapter Vic - Homecoming',
    'Part Did - Homecoming',
  ])
    assert.equal(showIdentityEpisodeTitleKey(title), normaliseTitle(title));
  for (const title of [
    'Session #2',
    'Episode 2',
    'Chapter Eleven',
    'Part 2',
    'Pilot',
    'Finale',
    'Premiere',
    'TBA',
    'TBD',
    'Untitled',
    'Sub English',
    'English Dub',
  ]) {
    assert.equal(isGenericEpisodeTitle(title), true, title);
    assert.equal(isDistinctiveEpisodeTitle(title), false, title);
  }
  assert.equal(isGenericEpisodeTitle('Echo'), false);
  assert.equal(isDistinctiveEpisodeTitle('Echo'), false);
  assert.equal(isDistinctiveEpisodeTitle('River of Ash'), true);
});

it('T22: uploads must postdate the requested show and leave a full calendar-year margin before every remake', () => {
  for (const year of [1998, 2007, 2019])
    assert.equal(
      confirmsTitleIdentity(requested, [competitor], { uploadYear: year }),
      true
    );
  for (const year of [undefined, NaN, Infinity, 2019.5, 1997, 2020, 2021, 2026])
    assert.equal(
      confirmsTitleIdentity(requested, [competitor], { uploadYear: year }),
      false,
      String(year)
    );
  for (const conflicts of [
    [competitor, { title: 'Unknown' }],
    [competitor, { ...competitor, year: 2000 }],
  ])
    assert.equal(
      confirmsTitleIdentity(requested, conflicts, { uploadYear: 2010 }),
      false
    );
  assert.equal(
    confirmsTitleIdentity(requested, [competitor], {
      uploadYear: 2010,
      year: 2021,
    }),
    true,
    'independent year filter owns mismatch'
  );
  assert.equal(
    confirmsTitleIdentity(requested, [competitor], {
      uploadYear: 2010,
      country: 'US',
    }),
    false
  );
  const now = Date.UTC(2026, 0, 1);
  assert.equal(
    releaseUploadYear((now - Date.UTC(2010, 0, 1)) / 3600000, now),
    2010
  );
  for (const age of [-1, Infinity, NaN, '24', undefined])
    assert.equal(releaseUploadYear(age, now), undefined);
});

it('T12/T13: regular catalogue names require complete competitor absence; known names survive incomplete, ongoing and ambiguous mappings', async () => {
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
    'requested-missing',
    'special',
    'generic',
    'short',
  ]) {
    const names =
      scenario === 'special'
        ? ['River of Ash']
        : scenario === 'generic'
          ? ['Pilot']
          : scenario === 'short'
            ? ['Echo']
            : ['River of Ash', 'Shared Episode Name'];
    const own = namedCatalogue(1, names, 'Continuing', {
      tmdbId: scenario === 'requested-mapping' ? 20 : undefined,
    });
    if (scenario === 'special') own.episodes![0].seasonNumber = 0;
    const other = namedCatalogue(
      scenario === 'wrong-tvdb' ? 99 : 2,
      [
        scenario === 'shared'
          ? 'Session #2: River of Ash'
          : 'Other Episode Name',
        'Shared Episode Name',
      ],
      scenario === 'ongoing' ? 'Continuing' : 'Ended',
      { tmdbId: scenario === 'unmapped' ? 21 : 20 }
    );
    if (scenario === 'partial') other.episodes![0].title = null;
    const third = namedCatalogue(3, ['Third Episode Name'], 'Ended', {
      tmdbId: 20,
    });
    const conflicts = [
      { ...competitor, tmdbId: scenario === 'wrong-tmdb' ? 99 : undefined },
      { title: 'Shared Chronicle', tmdbId: 20 },
      ...(scenario === 'contradictory'
        ? [{ title: 'Shared Chronicle', tvdbId: 3 }]
        : []),
    ];
    const evidence = analyseShowIdentityEpisodeTitles(
      requested,
      new Map([['sharedchronicle', conflicts]]),
      new Map([
        [1, scenario === 'requested-missing' ? null : own],
        [2, other],
        [3, third],
      ])
    );
    assert.equal(
      evidence.episodeTitles.get('sharedchronicle')?.has('riverofash') ?? false,
      scenario === 'mapped',
      scenario
    );
    if (scenario !== 'wrong-tvdb')
      assert.ok(
        evidence.conflictEpisodeTitles.get(2)?.includes('sharedepisodename'),
        scenario
      );
    if (['mapped', 'shared', 'partial', 'ongoing'].includes(scenario))
      assert.deepEqual(
        evidence.conflictEpisodeTitles.get(2),
        evidence.conflictEpisodeTitles.get('tmdb:20'),
        scenario
      );
  }
  const evidence = await analyseShowIdentityEpisodeTitles(
    requested,
    new Map([
      ['differentalias', [competitor]],
      ['sharedchronicle', [{ title: 'Shared Chronicle', tmdbId: 20 }]],
    ]),
    new Map(
      [1, 2].map((id) => [
        id,
        namedCatalogue(
          id,
          [id === 1 ? 'River of Ash' : 'Other Episode Name'],
          'Ended',
          { tmdbId: id === 2 ? 20 : undefined }
        ),
      ])
    )
  );
  assert.equal(
    evidence.episodeTitles.get('sharedchronicle')?.has('riverofash'),
    true
  );
});

it('T05/T11/T12: direct matching names need no complete catalogue, but known overlap and generic metadata cannot provide identity', async (t) => {
  await initialiseTestSettings(t);
  let otherName = 'A Different Journey';
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id) =>
    namedCatalogue(id, [id === 1 ? 'River of Ash' : otherName], 'Continuing')
  );
  for (const [title, other, prefix, expected, threshold, matched] of [
    ['Pilot', 'Other', '', false, 1, 'Pilot'],
    ['Finale', 'Other', '', false, 1, 'Finale'],
    ['Chapter Eleven', 'Other', '', false, 1, 'Chapter Eleven'],
    ['Pilot', 'Other', '1998.', true, 1, 'Pilot'],
    ['Echo', 'Other', '', true, 1, 'Echo'],
    ['Echo', 'Echo', '', false, 1, 'Echo'],
    ['Homecoming', 'Homecoming', '', false, 1, 'Homecoming'],
    ['Homecoming', 'Homecoming', '1998.', true, 1, 'Homecoming'],
    ['Chapter IV - Homecoming', 'Homecoming', '', false, 1, 'Homecoming'],
    ['Pilott', 'Other', '', false, 0.8, 'Pilot'],
    ['Pilott', 'Other', '1998.', true, 0.8, 'Pilot'],
    ['Homecomming', 'Homecoming', '', false, 0.8, 'Homecoming'],
    ['River of Ashe', 'Other', '', true, 0.8, 'River of Ash'],
    ['River of Ash', 'Other', '2021.', false, 1, 'River of Ash'],
  ] as const) {
    otherName = other;
    const metadata = {
      ...requested,
      releaseYears: [1998],
      episodeTitles: [{ title: matched, language: 'en' }],
      seasons: [{ season_number: 1, episode_count: 30 }],
      titleConflicts: [competitor],
    };
    const filter = new StreamFilterer({
      titleMatching: {
        enabled: true,
        ambiguousResults: 'discard',
        similarityThreshold: 1,
      },
      yearMatching: { enabled: true },
      seasonEpisodeMatching: { enabled: true, strict: true },
      episodeTitleMatching: { enabled: true, similarityThreshold: threshold },
    } as UserData);
    const filename = `Shared.Chronicle.${prefix}S01E10.${title.replaceAll(' ', '.')}.mkv`;
    assert.equal(
      (
        await filter.filter(
          [
            release(filename, {
              parsedFile: {
                ...FileParser.parse(filename),
                languages: ['English'],
              },
            }),
          ],
          seriesContext(metadata)
        )
      ).length,
      Number(expected),
      filename
    );
  }
});

it('T12/T14: catalogue recovery identifies the show across ordering differences without enabling episode filters', async (t) => {
  await initialiseTestSettings(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id) =>
    namedCatalogue(
      id,
      id === 1
        ? ['Session #1: Asteroid Blues', 'Session #2: Stray Dog Strut']
        : ['Cowboy Gospel', 'Venus Pop']
    )
  );
  const metadata = {
    ...requested,
    year: 1998,
    titleConflicts: [competitor],
    seasons: [{ season_number: 1, episode_count: 26 }],
  };
  const context = seriesContext(metadata, {
    isAnime: true,
    parsedId: { type: 'imdbId', season: '1', episode: '2' },
  });
  const cases: [string, string | undefined, boolean][] = [
    ['S01E02 - Stray Dog Strut.mkv', 'Shared Chronicle S01', true],
    ['02 - Stray Dog Strut.mkv', 'Shared Chronicle S01', true],
    ['Ep-02 Stray Dog Strut.mkv', 'Shared Chronicle S01', true],
    [
      '[Group]_Shared_Chronicle_-_Session_02_-_Stray_Dog_Strut_[720p].mkv',
      undefined,
      true,
    ],
    ['S01E02 - Stray Dog Strut.mkv', undefined, false],
    ['S01E02 - Stray Dog Strut.mkv', 'Other Show S01', false],
    ['S01E02 - Venus Pop.mkv', 'Shared Chronicle S01', false],
    ['S01E02 - Stray Dog Strut.mkv', 'Shared Chronicle 2021 S01', false],
    ['S01E03 - Stray Dog Strut.mkv', 'Shared Chronicle S01', false],
    [
      'Other Show - Session 02 - Stray Dog Strut.mkv',
      'Shared Chronicle S01',
      false,
    ],
    [
      'Shared Chronicle - Session 02 - Stray Dog Strut.mkv',
      'Shared Chronicle 1-26 Complete',
      true,
    ],
    [
      'Shared Chronicle - Session 23 - Brain Scratch.mkv',
      'Shared Chronicle 1-26 Complete',
      false,
    ],
    [
      'Shared Chronicle - Session 02-03 - Stray Dog Strut.mkv',
      'Shared Chronicle 1-26 Complete',
      false,
    ],
  ];
  for (const type of ['usenet', 'p2p', 'http', 'debrid'] as const) {
    const filter = new StreamFilterer({
      titleMatching: { enabled: true, ambiguousResults: 'discard' },
      yearMatching: { enabled: true },
      seasonEpisodeMatching: { enabled: true, strict: true },
    } as UserData);
    for (const [filename, folderName, expected] of cases) {
      const stream = release(filename, {
        type,
        folderName,
        parsedFile: mergeParsedFiles(
          FileParser.parse(filename),
          folderName ? FileParser.parse(folderName) : undefined
        ),
      });
      assert.equal(
        (await filter.filter([stream], context)).length,
        Number(expected),
        `${type}/${filename}/${folderName}`
      );
    }
    const incorrectEpisode = release(
      'Shared.Chronicle.S01E02.Stray.Dog.Strut.mkv',
      { type }
    );
    const nameFilter = new StreamFilterer({
      titleMatching: { enabled: true, ambiguousResults: 'discard' },
      episodeTitleMatching: { enabled: true, similarityThreshold: 1 },
    } as UserData);
    assert.equal(
      (
        await nameFilter.filter(
          [incorrectEpisode],
          seriesContext(
            {
              ...metadata,
              episodeTitles: [{ title: 'Different Ordering', language: 'en' }],
            },
            { parsedId: { season: '1', episode: '2' } }
          )
        )
      ).length,
      0
    );
  }
});
