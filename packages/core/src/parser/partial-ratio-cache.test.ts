import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extract, partial_ratio } from 'fuzzball';
import {
  normaliseTitle,
  preprocessTitle,
  titleMatchWithLang,
} from './utils.js';

interface Title {
  title: string;
  language?: string;
}

const endgameTitles: Title[] = [
  { title: 'Avengers: Endgame', language: 'en' },
  { title: 'Vingadores: Ultimato', language: 'pt' },
  { title: 'Vengadores: Endgame', language: 'es' },
  { title: 'Avengers: Endgame Extended', language: 'en' },
  // TMDB's alternate title is the source of the known Infinity War false positive.
  { title: 'Avengers: Infinity War Part II', language: 'en' },
  { title: 'Avengers: Infinity War Part 2', language: 'en' },
];

const lastOfUsTitles: Title[] = [
  { title: 'The Last of Us', language: 'en' },
  { title: 'Одни из нас', language: 'ru' },
  { title: 'The Last of Us: Remastered', language: 'en' },
];

interface Fixture {
  name: string;
  query: string;
  names: string[];
  titles: Title[];
  expected: { matched: boolean; language?: string };
  partialRatio?: boolean;
}

const fixtures: Fixture[] = [
  {
    name: 'English movie release',
    query: 'Avengers Endgame',
    names: ['Avengers.Endgame.2019.2160p.WEB-DL.mkv'],
    titles: endgameTitles,
    expected: { matched: true, language: 'en' },
  },
  {
    name: 'Portuguese alternate title',
    query: 'Vingadores Ultimato',
    names: ['Vingadores.Ultimato.2019.1080p.WEB-DL.mkv'],
    titles: endgameTitles,
    expected: { matched: true, language: 'pt' },
  },
  {
    name: 'Spanish alternate title',
    query: 'Vengadores Endgame',
    names: ['Vengadores.Endgame.2019.mkv'],
    titles: endgameTitles,
    expected: { matched: true, language: 'es' },
  },
  {
    name: 'special-edition filename remains matchable',
    query: 'Avengers Endgame',
    names: [
      "Avengers.Endgame.2019.IMAX.ENCORE.Extended.Director's.Cut.2160p.REMUX.mkv",
    ],
    titles: endgameTitles,
    expected: { matched: true, language: 'en' },
  },
  {
    name: 'known Infinity War false positive remains unchanged',
    query: 'Avengers Infinity War',
    names: ['Avengers.Infinity.War.2018.IMAX.mkv'],
    titles: endgameTitles,
    expected: { matched: true, language: 'en' },
  },
  {
    name: 'TV series title: English',
    query: 'The Last of Us',
    names: ['The.Last.of.Us.S01E01.2160p.WEB-DL.mkv'],
    titles: lastOfUsTitles,
    expected: { matched: true, language: 'en' },
  },
  {
    name: 'TV series title: Russian alternate',
    query: 'Одни из нас',
    names: ['Одни.из.нас.S01E01.1080p.WEB-DL.mkv'],
    titles: lastOfUsTitles,
    expected: { matched: true, language: 'ru' },
  },
  {
    name: 'episode title uses default scorer, not partial-ratio path',
    query: 'When You’re Lost in the Darkness',
    names: ['The.Last.of.Us.S01E01.When.Youre.Lost.in.the.Darkness.mkv'],
    titles: [
      { title: "When You're Lost in the Darkness", language: 'en' },
      { title: 'Quand tu es perdu dans les ténèbres', language: 'fr' },
    ],
    expected: { matched: true, language: 'en' },
    partialRatio: false,
  },
];

function prepareQuery(query: string, names: string[], titles: Title[]): string {
  return normaliseTitle(
    preprocessTitle(
      query,
      names,
      titles.map(({ title }) => title)
    )
  );
}

function legacyPartialMatch(
  query: string,
  titles: Title[],
  threshold = 0.75,
  limitTitles = 100
): { matched: boolean; language?: string } {
  const normalized = titles.map(({ title }) => normaliseTitle(title));
  const limited =
    limitTitles && normalized.length > limitTitles
      ? normalized.slice(0, limitTitles)
      : normalized;
  const results = extract(query, limited, {
    scorer: partial_ratio,
    returnObjects: true,
  }) as { score: number; key: number }[];
  let bestScore = 0;
  let bestKey: number | undefined;
  for (const result of results) {
    if (result.score > bestScore) {
      bestScore = result.score;
      bestKey = result.key;
    }
  }
  const matched = bestScore / 100 >= threshold;
  return {
    matched,
    language:
      matched && bestKey !== undefined ? titles[bestKey]?.language : undefined,
  };
}

test('partial-ratio cache path preserves title decisions and language selection', () => {
  for (const fixture of fixtures) {
    const query = prepareQuery(fixture.query, fixture.names, fixture.titles);
    if (fixture.partialRatio === false) {
      const actual = titleMatchWithLang(query, fixture.titles, {
        threshold: 0.75,
      });
      assert.deepEqual(actual, fixture.expected, fixture.name);
      continue;
    }
    const baseline = legacyPartialMatch(query, fixture.titles);
    const actual = titleMatchWithLang(query, fixture.titles, {
      threshold: 0.75,
      scorer: partial_ratio,
      limitTitles: 100,
    });
    assert.deepEqual(baseline, fixture.expected, `${fixture.name} baseline`);
    assert.deepEqual(actual, baseline, fixture.name);
  }
});

test('partial-ratio preserves the first matching title when scores tie', () => {
  const titles: Title[] = [
    { title: 'Avengers: Endgame', language: 'en' },
    { title: 'Avengers Endgame: Encore', language: 'en' },
    { title: 'Vengadores: Endgame', language: 'es' },
  ];
  const query = prepareQuery('Avengers Endgame', [], titles);
  const baseline = legacyPartialMatch(query, titles);
  const actual = titleMatchWithLang(query, titles, {
    threshold: 0.75,
    scorer: partial_ratio,
    limitTitles: 100,
  });
  assert.deepEqual(actual, baseline);
  assert.equal(actual.language, 'en');
});

test('partial-ratio retains the 100-title cap and original matched index', () => {
  const titles: Title[] = Array.from({ length: 100 }, (_, index) => ({
    title: `Unrelated film title ${index}`,
    language: 'xx',
  }));
  titles[99] = { title: 'Avengers Endgame', language: 'en' };
  titles.push({ title: 'Avengers Infinity War Part II', language: 'en' });
  const query = prepareQuery('Avengers Endgame', [], titles);
  const baseline = legacyPartialMatch(query, titles, 0.75, 100);
  const actual = titleMatchWithLang(query, titles, {
    threshold: 0.75,
    scorer: partial_ratio,
    limitTitles: 100,
  });
  assert.deepEqual(actual, baseline);
  assert.deepEqual(actual, { matched: true, language: 'en' });
});

test('partial-ratio cache preserves empty, Unicode and threshold edge cases', () => {
  const lists: Title[][] = [
    [],
    [{ title: '', language: 'empty' }],
    [
      { title: '你好世界', language: 'zh' },
      { title: 'Одни из нас', language: 'ru' },
    ],
    [
      { title: 'Dune + Part Two', language: 'en' },
      { title: 'Dune Part 2', language: 'en' },
    ],
  ];
  for (const titles of lists) {
    for (const query of [
      '',
      '你好',
      'Одни из нас',
      'Dune + Part',
      'not this film',
    ]) {
      for (const threshold of [0, 0.75, 0.99, 1]) {
        const normalized = normaliseTitle(query);
        assert.deepEqual(
          titleMatchWithLang(normalized, titles, {
            threshold,
            scorer: partial_ratio,
          }),
          legacyPartialMatch(normalized, titles, threshold)
        );
      }
    }
  }
});

test('partial-ratio does not match a title excluded by the title cap', () => {
  const titles: Title[] = [
    { title: 'Dune', language: 'en' },
    { title: 'Completely Different Movie', language: 'fr' },
  ];
  const query = normaliseTitle('Completely Different Movie');
  assert.deepEqual(
    titleMatchWithLang(query, titles, {
      threshold: 1,
      scorer: partial_ratio,
      limitTitles: 1,
    }),
    { matched: false, language: undefined }
  );
  assert.deepEqual(
    titleMatchWithLang(query, titles, {
      threshold: 1,
      scorer: partial_ratio,
      limitTitles: 2,
    }),
    { matched: true, language: 'fr' }
  );
});

test('additional scorer options retain extract behavior', () => {
  const titles: Title[] = [
    { title: 'Dune + Part Two', language: 'en' },
    { title: 'Одни из нас', language: 'ru' },
  ];
  const choices = titles.map((x) => normaliseTitle(x.title));
  for (const extra of [
    { full_process: false },
    { force_ascii: true },
    { collapseWhitespace: false },
    { cutoff: 99 },
    { limit: 1 },
  ]) {
    for (const query of [
      'DUNE+PARTTWO',
      normaliseTitle('Одни из нас'),
      'different',
    ]) {
      const options = { scorer: partial_ratio, ...extra };
      const results = extract(query, choices, {
        ...options,
        returnObjects: true,
      }) as { score: number; key: number }[];
      let score = 0;
      let key: number | undefined;
      for (const result of results)
        if (result.score > score) {
          score = result.score;
          key = result.key;
        }
      const matched = score / 100 >= 0.75;
      const expected = {
        matched,
        language:
          matched && key !== undefined ? titles[key].language : undefined,
      };
      assert.deepEqual(
        titleMatchWithLang(query, titles, { threshold: 0.75, ...options }),
        expected
      );
    }
  }
});
