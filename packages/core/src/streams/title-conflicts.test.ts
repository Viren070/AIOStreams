import './filterer.js';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { partial_ratio } from 'fuzzball';
import type { Metadata, TitleConflict } from '../metadata/utils.js';
import type { UserData } from '../db/schemas.js';
import { SkyhookMetadata } from '../metadata/skyhook.js';
import { RegexAccess } from '../utils/regex-access.js';
import { titleMatchWithLang, normaliseTitle } from '../parser/utils.js';
import FileParser from '../parser/file.js';
import StreamFilterer from './filterer.js';
import {
  confirmsTitleIdentity,
  getStreamTitleConflicts,
  titleConflictKey,
} from './title-conflicts.js';
import {
  conflictEpisodeBound,
  getConflictNumberingBounds,
  matchingReleaseEpisodeFloor,
  matchingReleaseSeason,
} from './title-conflict-episodes.js';
import { initialiseTestSettings } from '../../test/helpers.js';
import {
  release,
  seriesContext,
  catalogue,
} from '../../test/title-fixtures.js';

const requested: Metadata = {
  title: 'Distinct Series',
  titles: [{ title: 'Distinct Series' }, { title: 'Shared Show' }],
  year: 2006,
  releaseYears: [2006],
  country: 'JP',
  tvdbId: 1,
};
const competitor: TitleConflict = {
  title: 'Shared Show',
  tvdbId: 2,
  year: 2025,
  country: 'CN',
};

it('T01: exact, fuzzy and contains matching use the strongest actual alias', () => {
  for (const [title, options, expected] of [
    ['Distinct Series', { threshold: 1 }, 'Distinct Series'],
    ['Distinct Serries', { threshold: 0.8 }, 'Distinct Series'],
    [
      'Shared Show Extended',
      { threshold: 1, scorer: partial_ratio },
      'Shared Show Extended',
    ],
  ] as const) {
    const titles = [
      ...requested.titles!,
      { title: 'Shared Show Extended', language: 'en' },
    ];
    const result = titleMatchWithLang(normaliseTitle(title), titles, options);
    assert.equal(result.matched, true);
    assert.equal(result.matchedTitle, expected);
  }
  assert.equal(titleConflictKey('Shared Show (UK) (2025)'), 'sharedshow');
});

it('T01/T04: discover only matched known aliases; primary, missing and failed discovery stay distinct', async () => {
  const calls: string[] = [];
  const metadata = { ...requested, titleConflicts: [competitor] };
  const detect = async ({ title }: { title: string }) => {
    calls.push(title);
    return [competitor];
  };
  const found = await getStreamTitleConflicts(
    metadata,
    ['Distinct Series', 'Shared Show', 'Unrelated', 'Shared Show'],
    {},
    detect
  );
  assert.deepEqual(calls, ['Shared Show']);
  assert.deepEqual(found.get('distinctseries'), [competitor]);
  assert.deepEqual(found.get('sharedshow'), [competitor]);
  const unresolved = new Set<string>();
  const failed = await getStreamTitleConflicts(
    metadata,
    ['Shared Show'],
    {},
    async () => {
      throw Error('unavailable');
    },
    { unresolvedAliases: unresolved }
  );
  assert.equal(failed.has('sharedshow'), false);
  assert.equal(unresolved.has('sharedshow'), true);
  const empty = await getStreamTitleConflicts(
    metadata,
    ['Shared Show'],
    {},
    async () => [],
    { unresolvedAliases: unresolved }
  );
  assert.deepEqual(empty.get('sharedshow'), []);
  assert.equal(unresolved.has('sharedshow'), false);
  const missing = await getStreamTitleConflicts(
    { ...metadata, title: undefined },
    ['Shared Show'],
    {},
    detect
  );
  assert.deepEqual(missing.get('sharedshow'), [competitor]);
});

it('T05/T10/T22: independent positive clues exclude every competitor, never unknown facts', () => {
  type Evidence = Parameters<typeof confirmsTitleIdentity>[2];
  const cases: [string, Metadata, TitleConflict[], Evidence, boolean][] = [
    ['oldest is still ambiguous', requested, [competitor], {}, false],
    ['no conflicts', requested, [], {}, true],
    ['compatible year', requested, [competitor], { year: 2006 }, true],
    ['wrong year', requested, [competitor], { year: 2025 }, false],
    ['explicit country', requested, [competitor], { country: 'JP' }, true],
    [
      'direct name',
      requested,
      [competitor],
      { episodeTitleMatches: true },
      true,
    ],
    [
      'shared country',
      requested,
      [{ ...competitor, country: 'JP' }],
      { country: 'JP' },
      false,
    ],
    [
      'shared year within tolerance',
      requested,
      [{ ...competitor, year: 2007 }],
      { year: 2006 },
      false,
    ],
    [
      'alternate release year',
      { ...requested, releaseYears: [2009] },
      [competitor],
      { year: 2009 },
      true,
    ],
    ['closed interval', requested, [competitor], { year: '2003-2008' }, true],
    ['spans competitor', requested, [competitor], { year: '2006-2025' }, false],
    [
      'unknown year and country',
      requested,
      [{ title: 'Shared Show' }],
      { year: 2006, country: 'JP' },
      false,
    ],
    [
      'different clues for different competitors',
      requested,
      [
        { ...competitor, country: 'JP' },
        { ...competitor, year: 2006 },
      ],
      { year: 2006, country: 'JP' },
      true,
    ],
    [
      'unknown same-country competitor',
      requested,
      [competitor, { title: 'Shared Show', country: 'JP' }],
      { year: 2006, country: 'JP' },
      false,
    ],
  ];
  for (const year of [
    NaN,
    Infinity,
    2006.5,
    '2008-2006',
    '2006-',
    '2006-2008-2025',
    '2020-2022',
  ])
    cases.push([String(year), requested, [competitor], { year }, false]);
  for (const [label, metadata, conflicts, evidence, expected] of cases)
    assert.equal(
      confirmsTitleIdentity(metadata, conflicts, evidence),
      expected,
      label
    );
});

it('T15: coordinate proof uses the floor of a contiguous request-matching batch', () => {
  const request = {
    season: 11,
    episode: 52,
    absoluteEpisode: 278,
    relativeAbsoluteEpisode: 40,
  };
  type Coordinates = Parameters<typeof matchingReleaseEpisodeFloor>[0];
  const cases: [Coordinates, number | undefined][] = [
    [{ seasons: [11], episodes: [52] }, 52],
    [{ episodes: [278] }, 278],
    [{ seasons: [1], episodes: [278] }, 278],
    [{ episodes: [40] }, 40],
    [{ episodes: [277, 278] }, 277],
    [{ seasons: [11], episodes: [51, 52] }, 51],
  ];
  for (const value of [
    { episodes: [279] },
    { episodes: [52] },
    { seasons: [12], episodes: [52] },
    { seasons: [11], episodes: [278] },
    { seasons: [0], episodes: [278] },
    { seasons: [1, 11], episodes: [278] },
    { seasons: [11] },
    { episodes: [277, 279] },
    { episodes: [278, 277] },
    { episodes: [278, 278] },
    { episodes: [279, 280, 16] },
    { episodes: [0] },
    { episodes: [NaN] },
    { episodes: [Infinity] },
    { episodes: [278.5] },
    { episodes: [278], date: '2006-09-24' },
  ])
    cases.push([value, undefined]);
  for (const [input, expected] of cases)
    assert.equal(
      matchingReleaseEpisodeFloor(input, request),
      expected,
      JSON.stringify(input)
    );
  for (const filename of [
    'Shared Show - 279-280-16.mkv',
    'Shared.Show.S11.279-280-16.1080p.mkv',
  ])
    for (const episode of [16, 279, 280]) {
      assert.equal(
        matchingReleaseEpisodeFloor(
          FileParser.parse(filename),
          { season: 11, episode, absoluteEpisode: episode },
          filename
        ),
        undefined
      );
      assert.equal(
        matchingReleaseEpisodeFloor(
          { episodes: [279, 280] },
          { absoluteEpisode: 279 },
          filename
        ),
        undefined
      );
    }
  assert.equal(matchingReleaseEpisodeFloor({ episodes: [278] }, {}), undefined);
  assert.equal(matchingReleaseSeason({ seasons: [11] }, 11), 11);
  assert.equal(
    matchingReleaseSeason({ seasons: [11], episodes: [52] }, 11, 52),
    11
  );
  for (const input of [
    { seasons: [1] },
    { seasons: [0] },
    { seasons: [10, 11] },
    { seasons: [11], episodes: [52] },
    { seasons: [11], date: '2026-09-14' },
    {},
  ])
    assert.equal(matchingReleaseSeason(input, 11), undefined);
  assert.equal(matchingReleaseSeason({ seasons: [11] }), undefined);
});

it('T16: final bounds require closed, contiguous, positive regular coordinates', () => {
  const complete = catalogue(2, [8, 8], 'Ended');
  complete.episodes!.push(
    { seasonNumber: 0, episodeNumber: 99 },
    complete.episodes![0]
  );
  assert.equal(conflictEpisodeBound(complete), 16);
  complete.episodes![0].absoluteEpisodeNumber = 30;
  assert.equal(conflictEpisodeBound(complete), 30);
  for (const status of [' Ended ', ' Canceled ', 'cancelled'])
    assert.equal(conflictEpisodeBound(catalogue(2, [8, 8], status)), 16);
  for (const status of [undefined, '', 'Continuing', 'Returning Series'])
    assert.equal(conflictEpisodeBound(catalogue(2, [8, 8], status)), undefined);
  for (const episodes of [
    [],
    [{ seasonNumber: 2, episodeNumber: 1 }],
    [{ seasonNumber: 1, episodeNumber: 2 }],
    [{ seasonNumber: 1, episodeNumber: 0 }],
    [{ seasonNumber: 1, episodeNumber: 1, absoluteEpisodeNumber: 0 }],
    [{ seasonNumber: 1, episodeNumber: 1, absoluteEpisodeNumber: NaN }],
    [{ seasonNumber: 1.5, episodeNumber: 1 }],
  ])
    assert.equal(
      conflictEpisodeBound({ status: 'Ended', episodes }),
      undefined
    );
});

it('T16/T27: bounds validate provider IDs, deduplicate reads and permit only validated fallback', async () => {
  let calls = 0;
  const conflicts = [{ ...competitor }, { ...competitor }];
  const found = await getConflictNumberingBounds(conflicts, async (id) => {
    calls++;
    return catalogue(id, [8, 8], 'Ended');
  });
  assert.equal(calls, 1);
  assert.deepEqual(found.get(2), { episode: 16, season: 2 });
  for (const mode of ['missing', 'wrong-id', 'failed', 'gapped', 'open']) {
    const fallback = async () => {
      if (mode === 'failed') throw Error('failure');
      if (mode === 'missing') return undefined;
      return catalogue(
        mode === 'wrong-id' ? 3 : 2,
        mode === 'gapped' ? [0, 8] : [8, 8],
        mode === 'open' ? 'Continuing' : 'Ended'
      );
    };
    assert.equal(
      (await getConflictNumberingBounds(conflicts, async () => null, fallback))
        .size,
      0,
      mode
    );
  }
  assert.equal(
    (
      await getConflictNumberingBounds(
        conflicts,
        async () => null,
        async (id) => catalogue(id, [8, 8], 'Ended')
      )
    ).get(2)?.episode,
    16
  );
});

it('T02/T05: keep, discard, disabled and scoped title stages retain ordinary title and country checks', async (t) => {
  await initialiseTestSettings(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  t.mock.method(SkyhookMetadata.prototype, 'search', async () => [competitor]);
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async () => null);
  const metadata = { ...requested, titleConflicts: [] };
  const filenames = [
    'Shared.Show.S01E10.mkv',
    'Distinct.Series.S01E10.mkv',
    'Shared.Show.2006.S01E10.mkv',
    'Shared.Show.US.S01E10.mkv',
    'Unrelated.S01E10.mkv',
  ];
  for (const [label, titleMatching, contextOverrides, expected] of [
    ['discard', { enabled: true, ambiguousResults: 'discard' }, {}, [1, 2]],
    ['keep', { enabled: true, ambiguousResults: 'keep' }, {}, [0, 1, 2]],
    ['disabled', { enabled: false }, {}, [0, 1, 2, 3, 4]],
    [
      'addon excluded',
      { enabled: true, ambiguousResults: 'discard', addons: ['other'] },
      {},
      [0, 1, 2, 3, 4],
    ],
    [
      'request excluded',
      { enabled: true, ambiguousResults: 'discard', requestTypes: ['movie'] },
      {},
      [0, 1, 2, 3, 4],
    ],
    [
      'anime title scope',
      { enabled: true, ambiguousResults: 'discard', requestTypes: ['anime'] },
      { isAnime: true },
      [1, 2],
    ],
  ] as const) {
    for (const mode of ['exact', 'contains']) {
      const filter = new StreamFilterer({
        titleMatching: { ...titleMatching, mode, similarityThreshold: 1 },
      } as UserData);
      const result = await filter.filter(
        filenames.map((filename, i) => release(filename, { id: String(i) })),
        seriesContext(metadata, contextOverrides)
      );
      assert.deepEqual(
        result.map((s) => Number(s.id)),
        expected,
        `${label}/${mode}`
      );
    }
  }
});

it('T02: anime movies never acquire series competitor searches', async (t) => {
  await initialiseTestSettings(t);
  t.mock.method(SkyhookMetadata.prototype, 'search', async () =>
    assert.fail('series search for movie')
  );
  const metadata = {
    title: 'Feature Film',
    titles: [{ title: 'Feature Film' }],
    year: 2000,
  };
  const filter = new StreamFilterer({
    titleMatching: { enabled: true, ambiguousResults: 'discard' },
  } as UserData);
  assert.equal(
    (
      await filter.filter(
        [release('Feature.Film.2000.mkv')],
        seriesContext(metadata, { type: 'movie', isAnime: true })
      )
    ).length,
    1
  );
});

it('T15: high absolute and verified relative episodes recover identity without accepting overlapping/wrong coordinates', async (t) => {
  await initialiseTestSettings(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id) =>
    catalogue(id, [8, 8], 'Ended')
  );
  const metadata = {
    ...requested,
    title: 'Shared Show',
    titles: [{ title: 'Shared Show' }],
    titleConflicts: [competitor],
    absoluteEpisode: 278,
    relativeAbsoluteEpisode: 40,
    seasons: [{ season_number: 11, episode_count: 60 }],
  };
  const context = seriesContext(metadata, {
    isAnime: true,
    parsedId: { type: 'imdbId', season: '11', episode: '52' },
  });
  const filter = new StreamFilterer({
    titleMatching: { enabled: true, ambiguousResults: 'discard' },
    yearMatching: { enabled: true },
    seasonEpisodeMatching: { enabled: true, strict: true },
  } as UserData);
  const names = [
    'S11E52',
    'S01E278',
    '278',
    '40',
    'S11E16',
    'S11E278',
    '279-280-16',
  ];
  const streams = names.map((coordinate, i) => {
    const item = release(`Shared.Show.${coordinate}.mkv`, { id: String(i) });
    // Addons can supply absolute coordinates without this PR changing parsing.
    if (i === 2 || i === 3)
      item.parsedFile = {
        ...item.parsedFile,
        title: 'Shared Show',
        episodes: [Number(coordinate)],
      };
    return item;
  });
  assert.deepEqual(
    (await filter.filter(streams, context)).map((s) => s.id),
    ['0', '1', '2', '3']
  );
});

it('T01/T06: fuzzy and contains aliases retain strict identity and ID provenance boundaries', async (t) => {
  await initialiseTestSettings(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id) =>
    catalogue(id, [30], 'Ended')
  );
  const metadata = {
    title: 'Shared Show',
    titles: [{ title: 'Shared Show' }],
    year: 1994,
    tvdbId: 1,
    titleConflicts: [{ title: 'Shared Show', tvdbId: 2, year: 2001 }],
  };
  for (const [mode, title] of [
    ['contains', 'Shared.Show.Extra'],
    ['exact', 'Shaerd.Show'],
  ] as const) {
    const options = {
      yearMatching: { enabled: true },
      titleMatching: {
        enabled: true,
        mode,
        similarityThreshold: 0.8,
        ambiguousResults: 'discard',
      },
    } as UserData;
    for (const [year, idMatched, releaseIds, expected] of [
      [undefined, undefined, undefined, 0],
      [undefined, true, undefined, 1],
      [undefined, undefined, { tvdbId: 1 }, 0],
      [1994, undefined, { tvdbId: 1 }, 1],
    ] as const) {
      const item = release(`${title}${year ? `.${year}` : ''}.S01E10.mkv`, {
        idMatched,
        releaseIds,
      });
      assert.equal(
        (
          await new StreamFilterer(options).filter(
            [item],
            seriesContext(metadata)
          )
        ).length,
        expected,
        `${mode}/${year}/${idMatched}`
      );
    }
    assert.equal(
      (
        await new StreamFilterer({
          ...options,
          titleMatching: { ...options.titleMatching, ambiguousResults: 'keep' },
        }).filter([release(`${title}.S01E10.mkv`)], seriesContext(metadata))
      ).length,
      1
    );
  }
});
