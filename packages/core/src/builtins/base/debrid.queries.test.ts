import { before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
// Initialize the addon registry before importing its shared base class.
import '../index.js';
import { BaseDebridAddon, type SearchMetadata } from './debrid.js';
import { IdParser, type ParsedId } from '../../utils/id-parser.js';
import { settingsStore } from '../../config/index.js';
import { SettingsRepository } from '../../db/repositories/settings.js';

// Exercise the shared query builder without constructing an addon or making
// indexer/provider requests. This method does not read instance state.
const build = (
  BaseDebridAddon.prototype as unknown as {
    buildQueries: (
      id: ParsedId,
      metadata: SearchMetadata,
      options?: {
        useAllTitles?: boolean;
        titleLanguages?: string[];
      }
    ) => string[];
  }
).buildQueries;
const id = IdParser.parse('tt37793706:1:5', 'series');
const metadata: SearchMetadata = {
  primaryTitle: 'reborn 2025',
  year: 2025,
  titles: ['Reborn (2025)', 'Reborn', 'Çarpıntı'],
  titlesWithLang: [
    { title: 'Reborn (2025)' },
    { title: 'Reborn', language: 'en' },
    { title: 'Çarpıntı', language: 'tr' },
  ],
  originalLanguage: 'tr',
  sceneTitles: ['Carpinti', 'Çarpıntı 2025'],
  country: 'TR',
  isDateBased: true,
  episodeAirDate: '2025-10-12',
  titleConflicts: [
    { title: 'Reborn', year: 2006, country: 'JP' },
    { title: 'Reborn', year: 2025, country: 'CN' },
  ],
};

/** Initialize query settings without a database, restoring repository mocks. */
async function initialiseTitleLimit(
  titleLimit: number,
  latinQueriesOnly = true
) {
  const rows = mock.method(SettingsRepository, 'getAll', async () => [
    {
      key: 'builtins.scrape.titleLimit',
      value: String(titleLimit),
      updated_at: '',
      updated_by: null,
    },
    {
      key: 'builtins.scrape.latinQueriesOnly',
      value: String(latinQueriesOnly),
      updated_at: '',
      updated_by: null,
    },
  ]);
  const version = mock.method(SettingsRepository, 'getVersion', async () => 0);
  try {
    await settingsStore.initialise();
  } finally {
    rows.mock.restore();
    version.mock.restore();
  }
}

before(() => initialiseTitleLimit(3));

describe('queries for conflicting series names', () => {
  it('searches Carpinti using both episode numbering and air date, without repeated years or duplicate queries', () => {
    const queries = build(id, metadata, { useAllTitles: true });
    assert.ok(queries.includes('carpinti S01E05'));
    assert.ok(queries.includes('carpinti 2025 10 12'));
    assert.ok(
      queries.includes('reborn S01E05'),
      'retain the broad alias for recall'
    );
    assert.ok(queries.every((query) => !query.includes('2025 2025')));
    assert.equal(new Set(queries).size, queries.length);
  });

  it('prioritizes an original-language alias outside the first three titles when the display name conflicts', () => {
    const queries = build(
      id,
      {
        ...metadata,
        isDateBased: false,
        sceneTitles: undefined,
        titlesWithLang: [
          ...metadata.titlesWithLang!.slice(0, 2),
          { title: 'Reborn 2025' },
          { title: 'Çarpıntı', language: 'tr' },
        ],
      },
      { useAllTitles: true }
    );
    assert.equal(queries[0], 'carpinti S01');
    assert.ok(queries.includes('carpinti S01E05'));
  });

  it('uses the date-search scene alias for episode searches even without known conflicts', () => {
    const queries = build(
      id,
      { ...metadata, titleConflicts: undefined },
      { titleLanguages: ['default'] }
    );
    assert.ok(queries.includes('carpinti S01E05'));
    assert.ok(queries.includes('carpinti 2025 10 12'));
  });

  it('uses a later romanized original alias when the first original alias is excluded by Latin-only queries', () => {
    const queries = build(IdParser.parse('tt29274749:1:3', 'series'), {
      ...metadata,
      primaryTitle: 'reborn',
      originalLanguage: 'zh',
      country: 'CN',
      titles: ['Reborn', '焕羽', 'Huan Yu'],
      titlesWithLang: [
        { title: 'Reborn' },
        { title: '焕羽', language: 'zh' },
        { title: 'Huan Yu', language: 'zh' },
      ],
      sceneTitles: undefined,
      isDateBased: false,
      titleConflicts: [{ title: 'Reborn', year: 2025, country: 'TR' }],
    });
    assert.ok(queries.includes('huan yu S01E03'));
    assert.ok(queries.includes('reborn S01E03'));
    assert.ok(queries.every((query) => !query.includes('焕羽')));
  });

  it('preserves language-specific spelling when prioritizing an original alias', () => {
    for (const [language, title, expected] of [
      ['de', 'Mädchen', 'maedchen'],
      ['da', 'Året', 'aaret'],
    ]) {
      const queries = build(id, {
        ...metadata,
        originalLanguage: language,
        titlesWithLang: [{ title, language }],
        sceneTitles: undefined,
        isDateBased: false,
      });
      assert.equal(queries[0], `${expected} S01`);
      assert.ok(queries.includes(`${expected} S01E05`));
    }
  });

  it('respects explicit languages for both numbered and air-date searches', () => {
    for (const titleConflicts of [undefined, metadata.titleConflicts]) {
      for (const [selection, expected] of [
        ['en', 'reborn'],
        ['tr', 'carpinti'],
        ['original', 'carpinti'],
      ]) {
        const queries = build(
          id,
          { ...metadata, titleConflicts, sceneTitles: ['Scene Alias'] },
          { titleLanguages: [selection] }
        );
        assert.ok(queries.includes(`${expected} S01E05`));
        assert.ok(queries.includes(`${expected} 2025 10 12`));
        assert.ok(queries.every((query) => !query.startsWith('scene alias')));
      }
    }
  });

  it('retains implicit date-based scene searches when the title selection permits them', () => {
    for (const titleLanguages of [undefined, ['default'], ['all'], ['scene']]) {
      const queries = build(
        id,
        { ...metadata, sceneTitles: ['Scene Alias'] },
        { titleLanguages }
      );
      assert.ok(queries.includes('scene alias S01E05'));
      assert.ok(queries.includes('scene alias 2025 10 12'));
    }
  });

  it('selects a date-based scene alias using the configured script restriction', async () => {
    try {
      for (const latinOnly of [true, false]) {
        await initialiseTitleLimit(3, latinOnly);
        const queries = build(
          id,
          {
            ...metadata,
            titleConflicts: undefined,
            sceneTitles: ['焕羽', 'Huan Yu'],
          },
          { titleLanguages: ['default'] }
        );
        const expected = latinOnly ? 'huan yu' : '焕羽';
        assert.ok(queries.includes(`${expected} S01E05`));
        assert.ok(queries.includes(`${expected} 2025 10 12`));
        if (latinOnly) {
          assert.ok(queries.every((query) => !query.includes('焕羽')));
        }
      }
    } finally {
      await initialiseTitleLimit(3);
    }
  });

  it('does not inject an unusable scene alias when Latin-only queries are enabled', () => {
    const queries = build(
      id,
      {
        ...metadata,
        titleConflicts: undefined,
        sceneTitles: ['焕羽', '---'],
      },
      { titleLanguages: ['default'] }
    );
    assert.ok(queries.includes('reborn 2025 S01E05'));
    assert.ok(queries.includes('reborn 2025 10 12'));
    assert.ok(queries.every((query) => query.startsWith('reborn')));
  });

  it('keeps the primary query alongside an original alias when only two titles fit', async () => {
    await initialiseTitleLimit(2);
    try {
      const queries = build(id, {
        ...metadata,
        primaryTitle: 'example series',
        titles: ['Example Series'],
        titlesWithLang: [
          { title: 'Example Series', language: 'en' },
          { title: 'Original Series Name', language: 'en' },
        ],
        originalLanguage: 'en',
        sceneTitles: ['Short Name'],
        isDateBased: false,
      });
      assert.ok(queries.includes('original series name S01E05'));
      assert.ok(queries.includes('example series S01E05'));
    } finally {
      await initialiseTitleLimit(3);
    }
  });

  it('respects an explicit language selection for a non-date-based series', () => {
    const queries = build(
      id,
      { ...metadata, isDateBased: false },
      { titleLanguages: ['en'] }
    );
    assert.ok(queries.every((query) => !query.startsWith('carpinti')));
  });

  it('does not truncate a larger explicit language selection to the general title limit when prioritizing an alias', () => {
    const queries = build(
      id,
      {
        ...metadata,
        primaryTitle: 'display title',
        titles: ['Display Title'],
        titlesWithLang: [
          { title: 'Original Title', language: 'tr' },
          { title: 'English Title', language: 'en' },
          { title: 'French Title', language: 'fr' },
        ],
        sceneTitles: undefined,
        isDateBased: false,
      },
      { titleLanguages: ['default', 'tr', 'en', 'fr'] }
    );
    assert.equal(queries[0], 'original title S01');
    for (const title of [
      'original title',
      'display title',
      'english title',
      'french title',
    ]) {
      assert.ok(queries.includes(`${title} S01E05`), title);
    }
  });

  it('falls back to the primary title when alternative titles are missing or empty', () => {
    for (const titles of [undefined, []]) {
      const incomplete = {
        ...metadata,
        primaryTitle: 'example show',
        titles,
        titlesWithLang: undefined,
        sceneTitles: undefined,
      } as unknown as SearchMetadata;
      for (const options of [
        { useAllTitles: true },
        { titleLanguages: ['all'] },
        { titleLanguages: ['default'] },
      ]) {
        const queries = build(id, incomplete, options);
        assert.ok(queries.includes('example show S01E05'));
        assert.ok(queries.includes('example show 2025 10 12'));
      }
    }
  });

  it('preserves ordinary unambiguous series and movie query generation', () => {
    const ordinary = {
      ...metadata,
      primaryTitle: 'example show',
      titles: ['Example Show'],
      titleConflicts: undefined,
      isDateBased: false,
    };
    assert.deepEqual(build(id, ordinary), [
      'example show S01',
      'example show S01E05',
    ]);
    assert.deepEqual(
      build(IdParser.parse('tt43625959', 'movie'), {
        ...ordinary,
        primaryTitle: 'example movie',
        titles: ['Example Movie'],
      }),
      ['example movie 2025']
    );
  });

  it('does not strip a year that is part of a title without a known untagged alias', () => {
    const queries = build(id, {
      ...metadata,
      primaryTitle: 'class of 2025',
      titles: ['Class of 2025'],
      sceneTitles: undefined,
      titleConflicts: undefined,
    });
    assert.ok(queries.includes('class of 2025 2025 10 12'));
  });

  it('does not add season-relative searches to continuous absolute numbering', () => {
    const queries = build(id, {
      ...metadata,
      isDateBased: false,
      resolvedSeasonFirstEpisode: 100,
      absoluteEpisode: 104,
    });
    assert.ok(queries.every((query) => !query.includes('S01')));
    assert.ok(queries.some((query) => query.endsWith('E104')));
  });
});
