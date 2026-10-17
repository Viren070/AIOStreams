import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectEpisodeTitles } from './episode-title-ordering.js';

const episode = (title: string, airDate?: string, language?: string) => ({
  airDate,
  titles: [{ title, language }],
});
const zaria = episode("Zaria's in Charge", '2007-10-13', 'en');
const gratch = episode(
  'The Littlest Gratch/Lok, the Offender',
  '2008-01-12',
  'en'
);

describe('episode ordering evidence', () => {
  it('withholds generic and empty titles for dated and undated sources', () => {
    for (const provider of [
      'imdbId',
      'thetvdbId',
      'themoviedbId',
      'malId',
      'kitsuId',
    ]) {
      for (const airDate of ['2005-03-29', undefined]) {
        assert.deepEqual(
          selectEpisodeTitles(provider, '2005-03-29', [
            {
              airDate,
              titles: ['Episode 9', 'EP.09', 'Chapter 9', '...', ''].map(
                (title) => ({ title, language: 'en' })
              ),
            },
          ]),
          { titles: [], orderingConflict: false }
        );
      }
    }
  });
  it('retains meaningful language-tagged titles alongside placeholders', () => {
    const titles = [
      { title: 'Diversity Day', language: 'en' },
      { title: 'Tag der Vielfalt', language: 'de' },
    ];
    assert.deepEqual(
      selectEpisodeTitles('imdbId', '2005-03-29', [
        {
          airDate: '2005-03-29',
          titles: [{ title: 'Episode 2' }, ...titles],
        },
      ]).titles,
      titles
    );
  });
  it('does not salvage a tagged placeholder as an outlier translation', () => {
    assert.deepEqual(
      selectEpisodeTitles(
        'imdbId',
        '2005-03-29',
        [
          {
            airDate: '2005-04-03',
            titles: [
              { title: 'Diversity Day', language: 'en' },
              { title: 'Episode 2', language: 'de' },
            ],
          },
        ],
        episode('Diversity Day', '2005-03-29', 'en')
      ).titles,
      [{ title: 'Diversity Day', language: 'en' }]
    );
  });
  it('makes Tak IMDb ordering inconclusive instead of choosing or combining titles', () => {
    assert.deepEqual(
      selectEpisodeTitles('imdbId', '2007-10-13T00:00:00.000Z', [
        zaria,
        gratch,
        gratch,
      ]),
      {
        titles: [],
        orderingConflict: true,
      }
    );
  });
  it('detects a conflict between Cinemeta and TVDB even without TMDB', () => {
    assert.equal(
      selectEpisodeTitles('imdbId', '2007-10-13', [undefined, gratch], zaria)
        .orderingConflict,
      true
    );
  });
  it('detects conflicting provider dates even without a Cinemeta date', () => {
    assert.equal(
      selectEpisodeTitles('imdbId', undefined, [zaria, gratch])
        .orderingConflict,
      true
    );
  });
  it('preserves Adventure Time expected titles and does not add Do No Harm', () => {
    const expected = episode("Don't Look", '2016-04-02', 'en');
    const result = selectEpisodeTitles('imdbId', '2016-04-02T11:00:00.000Z', [
      expected,
      expected,
      episode("Don't Look", '2016-04-02'),
    ]);
    assert.deepEqual(result, {
      titles: expected.titles,
      orderingConflict: false,
    });
  });
  it('honors an explicit TVDB or TMDB reference instead of declaring an IMDb conflict', () => {
    assert.deepEqual(
      selectEpisodeTitles('thetvdbId', gratch.airDate, [zaria, gratch]).titles,
      gratch.titles
    );
    assert.deepEqual(
      selectEpisodeTitles('themoviedbId', zaria.airDate, [zaria, gratch])
        .titles,
      zaria.titles
    );
  });
  it('does not change mapped MAL and Kitsu request behavior', () => {
    for (const provider of ['malId', 'kitsuId']) {
      assert.deepEqual(
        selectEpisodeTitles(provider, zaria.airDate, [zaria, gratch]),
        { titles: zaria.titles, orderingConflict: false }
      );
    }
  });
  it('retains date tolerance and translations from agreeing sources', () => {
    const translated = episode('Ne regarde pas', '2016-04-04', 'fr');
    const expected = episode("Don't Look", '2016-04-02', 'en');
    assert.deepEqual(
      selectEpisodeTitles('imdbId', expected.airDate, [expected, translated])
        .titles,
      [...expected.titles, ...translated.titles]
    );
  });
  it('does not mistake unavailable, undated or invalid source dates for conflicts', () => {
    for (const airDate of [undefined, 'invalid']) {
      const source = episode("Don't Look", airDate, 'en');
      assert.deepEqual(
        selectEpisodeTitles('imdbId', '2016-04-02', [undefined, source]),
        { titles: source.titles, orderingConflict: false }
      );
    }
  });
  it('does not use a source with no title to invalidate title evidence', () => {
    assert.deepEqual(
      selectEpisodeTitles('imdbId', zaria.airDate, [
        zaria,
        { airDate: gratch.airDate, titles: [] },
      ]).titles,
      zaria.titles
    );
  });
  it('returns no title evidence when no episode sources are available', () => {
    assert.deepEqual(selectEpisodeTitles('imdbId', undefined, [undefined]), {
      titles: [],
      orderingConflict: false,
    });
  });
});

describe('preserving reliable evidence despite source date differences', () => {
  it('retains the title when sources name the same episode three days apart', () => {
    const expected = episode("Don't Look", '2016-04-02', 'en');
    assert.deepEqual(
      selectEpisodeTitles('imdbId', expected.airDate, [
        expected,
        episode('Don’t Look!', '2016-04-05', 'en'),
      ]),
      {
        titles: [...expected.titles, { title: 'Don’t Look!', language: 'en' }],
        orderingConflict: false,
      }
    );
  });
  it('preserves both sources within two days of the reference', () => {
    const left = episode('Title A', '2016-03-31', 'en');
    const right = episode('Titre A', '2016-04-04', 'fr');
    assert.deepEqual(
      selectEpisodeTitles('imdbId', '2016-04-02', [left, right]),
      {
        titles: [...left.titles, ...right.titles],
        orderingConflict: false,
      }
    );
  });
  it('does not treat a bare Cinemeta date as a competing episode identity', () => {
    assert.equal(
      selectEpisodeTitles('imdbId', '2007-10-13', [gratch]).orderingConflict,
      false
    );
  });
  it('uses Cinemeta title agreement even when TMDB is unavailable', () => {
    const expected = episode('Diversity Day', '2005-03-29', 'en');
    assert.deepEqual(
      selectEpisodeTitles(
        'imdbId',
        expected.airDate,
        [expected],
        episode('Diversity Day', '2005-04-02')
      ),
      { titles: expected.titles, orderingConflict: false }
    );
  });
  it('does not use generic episode labels as conflicting identity evidence', () => {
    assert.deepEqual(
      selectEpisodeTitles(
        'imdbId',
        gratch.airDate,
        [gratch],
        episode('Episode 9', zaria.airDate)
      ),
      { titles: gratch.titles, orderingConflict: false }
    );
  });
  it('does not let an intermediate alias source hide genuinely conflicting titles', () => {
    const bridge = {
      airDate: zaria.airDate,
      titles: [...zaria.titles, ...gratch.titles],
    };
    assert.equal(
      selectEpisodeTitles('imdbId', zaria.airDate, [zaria, bridge, gratch])
        .orderingConflict,
      true
    );
  });
});

describe('corroborated names from a date outlier', () => {
  it('retains a provider title corroborated by Cinemeta despite a different date', () => {
    const expected = episode('Diversity Day', '2005-04-02', 'en');
    assert.deepEqual(
      selectEpisodeTitles(
        'imdbId',
        '2005-03-29',
        [expected],
        episode('Diversity Day', '2005-03-29')
      ),
      { titles: expected.titles, orderingConflict: false }
    );
  });
  it('does not import uncorroborated aliases from the outlier', () => {
    const expected = episode('Diversity Day', '2005-03-29', 'en');
    const outlier = {
      airDate: '2005-04-02',
      titles: [
        ...expected.titles,
        { title: 'Work Experience', language: 'en' },
      ],
    };
    assert.deepEqual(
      selectEpisodeTitles('imdbId', expected.airDate, [expected, outlier]),
      { titles: expected.titles, orderingConflict: false }
    );
  });
});

describe('translations of corroborated episode records', () => {
  const referenceDate = '2001-01-31T22:00:00.000Z';
  const tmdb = {
    airDate: '2005-03-29',
    titles: [
      { title: 'Diversity Day' },
      { title: 'Tag der Vielfalt', language: 'de' },
      { title: 'La journée de la diversité', language: 'fr' },
    ],
  };
  const skyhook = episode('Diversity Day', '2005-03-29', 'en');
  const cinemeta = episode('Diversity Day', referenceDate);
  it('retains Office translations and recovers the English language tag', () => {
    const result = selectEpisodeTitles(
      'imdbId',
      referenceDate,
      [tmdb, skyhook],
      cinemeta
    );
    assert.deepEqual(result, {
      titles: [
        { title: 'Diversity Day', language: 'en' },
        { title: 'Tag der Vielfalt', language: 'de' },
        { title: 'La journée de la diversité', language: 'fr' },
      ],
      orderingConflict: false,
    });
    assert.equal(
      tmdb.titles[0].language,
      undefined,
      'do not mutate cached source titles'
    );
  });
  it('does not assume English when corroborating a non-English title', () => {
    const reference = episode('Tag der Vielfalt', referenceDate, 'de');
    const translated = {
      airDate: '2005-03-29',
      titles: [
        { title: 'Tag der Vielfalt', language: 'de' },
        { title: 'Diversity Day', language: 'en' },
        { title: 'Unrelated German alias', language: 'de' },
      ],
    };
    assert.deepEqual(
      selectEpisodeTitles('imdbId', referenceDate, [translated], reference)
        .titles,
      translated.titles.slice(0, 2)
    );
  });
  it('does not rescue translations from a genuinely conflicting episode', () => {
    const wrong = {
      airDate: '2008-01-12',
      titles: [
        { title: 'The Littlest Gratch/Lok, the Offender', language: 'en' },
        { title: 'Another translation', language: 'de' },
      ],
    };
    assert.deepEqual(
      selectEpisodeTitles('imdbId', zaria.airDate, [zaria, wrong], zaria),
      { titles: [], orderingConflict: true }
    );
  });
  it('does not infer a translation relationship with unknown anchor language', () => {
    assert.deepEqual(
      selectEpisodeTitles('imdbId', referenceDate, [tmdb], cinemeta).titles,
      [{ title: 'Diversity Day' }]
    );
  });
});
