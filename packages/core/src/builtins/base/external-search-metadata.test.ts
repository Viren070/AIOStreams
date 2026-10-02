import assert from 'node:assert/strict';
import { it } from 'node:test';
import { AnimeDatabase, IdParser } from '../../utils/index.js';
import { settingsStore } from '../../config/index.js';
import { SettingsRepository } from '../../db/repositories/settings.js';
import { MetadataService } from '../../metadata/service.js';
import { createLogger } from '../../logging/logger.js';
import { AnimeRepository } from '../../db/repositories/anime.js';
import { AnimeType, type AnimeRecord } from '../../anime-database/types.js';
import {
  getEntryEpisodeTitles,
  getExternalEpisodeTitles,
  isLocalEpisodeWrong,
} from '../../anime-database/episode-titles.js';
import {
  BaseDebridAddon,
  BaseDebridConfigSchema,
  type BaseDebridConfig,
  type SearchMetadata,
} from './debrid.js';

class SearchProbe extends BaseDebridAddon<BaseDebridConfig> {
  readonly id = 'probe';
  readonly name = 'probe';
  readonly version = '1';
  readonly logger = createLogger('test');
  protected async _searchTorrents() {
    return [];
  }
  protected async _searchNzbs() {
    return [];
  }
  metadata(id: string) {
    return this._getSearchMetadata(IdParser.parse(id, 'series')!, 'series');
  }
  queries(id: string, metadata: SearchMetadata, titleLanguages = ['all']) {
    return this.buildQueries(IdParser.parse(id, 'series')!, metadata, {
      titleLanguages,
    });
  }
}

it('uses entry-local episode 8 instead of unrelated episode 373 in builtin search metadata', async (t) => {
  t.mock.method(SettingsRepository, 'getAll', async () => []);
  t.mock.method(SettingsRepository, 'getVersion', async () => 0);
  await settingsStore.initialise();
  t.mock.method(AnimeDatabase, 'getInstance', () => ({
    getEntryById: async () => ({
      title: 'Bleach Part 4',
      localEpisodeTitles: ['Bleach Part 4'],
      animeSeason: { year: 2026 },
      mappings: { imdbId: 'tt0434665' },
      tmdb: { seasonNumber: 2, fromEpisode: 41 },
      tvdb: { seasonNumber: 17, fromEpisode: 41 },
    }),
  }));
  t.mock.method(MetadataService.prototype, 'getMetadata', async () => ({
    title: 'Bleach',
    year: 2004,
    tmdbId: 30984,
    tvdbId: 74796,
    seasons: [
      20, 21, 22, 28, 18, 22, 20, 16, 22, 16, 7, 17, 36, 51, 26, 24,
    ].map((n, i) => ({ season_number: i + 1, episode_count: n })),
  }));
  const probe = new SearchProbe({ services: [] }, BaseDebridConfigSchema);
  const metadata = await probe.metadata('tt0434665:17:48');
  assert.equal(metadata.absoluteEpisode, 414);
  assert.equal(metadata.relativeAbsoluteEpisode, 8);
  assert.equal(metadata.seasonYear, 2026);
  assert.equal(metadata.season, 17);
  assert.equal(metadata.episode, 48);
  assert.deepEqual(metadata.localEpisodeTitles, ['Bleach Part 4']);
});

const partTitle = 'Bleach: Sennen Kessen-hen - Kashin-tan';
const partQuery = 'bleach sennen kessen hen kashin tan';

it('keeps entry-local titles separate from aliases shared by other parts', () => {
  const parent = {
    rid: 1,
    title: 'Bleach',
    synonyms: ['BLEACH TYBW'],
  } as AnimeRecord;
  const previous = {
    rid: 2,
    title: 'Bleach: Sennen Kessen-hen - Soukoku-tan',
    synonyms: ['BLEACH TYBW', 'Bleach: Thousand-Year Blood War'],
  } as AnimeRecord;
  const chosen = {
    rid: 3,
    title: partTitle,
    synonyms: [
      'BLEACH',
      'BLEACH TYBW',
      'Bleach: Thousand-Year Blood War',
      'Bleach: Sennen Kessen Hen - Kashin Tan',
      'Bleach: Thousand-Year Blood War - The Calamity',
    ],
  } as AnimeRecord;
  assert.deepEqual(getEntryEpisodeTitles(chosen, [parent, previous, chosen]), [
    partTitle,
    'Bleach: Thousand-Year Blood War - The Calamity',
  ]);
});

for (const [episode, local, absolute] of [
  [48, 8, 414],
  [47, 7, 413],
  [45, 5, 411],
]) {
  it(`uses the real database lookup to scope Bleach E${episode} queries without age filters`, async (t) => {
    t.mock.method(SettingsRepository, 'getAll', async () => []);
    t.mock.method(SettingsRepository, 'getVersion', async () => 0);
    await settingsStore.initialise();
    const parent = {
      rid: 101,
      type: AnimeType.TV,
      title: 'Bleach',
      ids: { imdbId: 'tt0434665', thetvdbId: 74796, themoviedbId: 30984 },
      imdb: { fromSeason: 1, fromEpisode: 1, title: 'Bleach' },
    } as AnimeRecord;
    const part = {
      rid: 102,
      type: AnimeType.TV,
      title: partTitle,
      ids: { imdbId: 'tt0434665', thetvdbId: 74796, themoviedbId: 30984 },
      tvdb: { seasonNumber: 17, fromEpisode: 41 },
      tmdb: { seasonNumber: 2, fromEpisode: 41 },
      synonyms: ['Bleach', partTitle],
    } as AnimeRecord;
    // Exercise selection + title provenance through the production lookup.
    t.mock.method(AnimeRepository, 'findCandidates', async () => [
      parent,
      part,
    ]);
    t.mock.method(MetadataService.prototype, 'getMetadata', async () => ({
      title: 'Bleach',
      titles: [{ title: 'Bleach' }, { title: partTitle }],
      seasons: [
        20, 21, 22, 28, 18, 22, 20, 16, 22, 16, 7, 17, 36, 51, 26, 24,
      ].map((n, i) => ({ season_number: i + 1, episode_count: n })),
    }));
    const probe = new SearchProbe({ services: [] }, BaseDebridConfigSchema);
    const id = `tt0434665:17:${episode}`;
    const metadata = await probe.metadata(id);
    const expected = [
      'bleach S17',
      `bleach ${absolute}`,
      `${partQuery} ${String(local).padStart(2, '0')}`,
      `bleach S17E${episode}`,
    ];
    assert.deepEqual(probe.queries(id, metadata), expected);
    // Default-title-only configurations still get one verified part query.
    metadata.primaryTitle = 'bleach';
    assert.deepEqual(probe.queries(id, metadata, ['default']), expected);
  });
}

it('scopes another split anime and keeps the user-selected language title', () => {
  const probe = new SearchProbe({ services: [] }, BaseDebridConfigSchema);
  const metadata: SearchMetadata = {
    primaryTitle: 'attack on titan',
    titles: [],
    isAnime: true,
    titlesWithLang: [
      { title: 'Attack on Titan', language: 'en' },
      { title: 'Shingeki no Kyojin: The Final Season Part 2', language: 'ja' },
    ],
    absoluteEpisode: 83,
    relativeAbsoluteEpisode: 8,
    localEpisodeTitles: ['Shingeki no Kyojin: The Final Season Part 2'],
  };
  assert.deepEqual(probe.queries('tt2560140:4:24', metadata, ['en', 'ja']), [
    'attack on titan S04',
    'attack on titan 83',
    'shingeki no kyojin the final season part 2 08',
    'attack on titan S04E24',
  ]);
});

it('does not fall back to a broad title if entry-specific titles are unavailable', () => {
  const probe = new SearchProbe({ services: [] }, BaseDebridConfigSchema);
  assert.deepEqual(
    probe.queries('tt0434665:17:48', {
      primaryTitle: 'bleach',
      titles: [],
      isAnime: true,
      absoluteEpisode: 414,
      relativeAbsoluteEpisode: 8,
      localEpisodeTitles: [],
    }),
    ['bleach S17', 'bleach 414', 'bleach S17E48']
  );
});

it('leaves ordinary series query formats intact', () => {
  const probe = new SearchProbe({ services: [] }, BaseDebridConfigSchema);
  assert.deepEqual(
    probe.queries('tt0903747:2:8', {
      primaryTitle: 'breaking bad',
      titles: [],
    }),
    ['breaking bad S02', 'breaking bad S02E08']
  );
});

it('requires the part title even when the local and external episode numbers coincide', () => {
  const metadata = {
    season: 2,
    episode: 8,
    absoluteEpisode: 33,
    relativeAbsoluteEpisode: 8,
    localEpisodeTitles: ['Shingeki no Kyojin Season 2'],
  };
  assert.equal(
    isLocalEpisodeWrong(
      { title: 'Shingeki no Kyojin', episodes: [8] },
      metadata
    ),
    true
  );
  assert.equal(
    isLocalEpisodeWrong(
      { title: 'Shingeki no Kyojin Season 2', episodes: [8] },
      metadata
    ),
    false
  );
  assert.equal(
    isLocalEpisodeWrong(
      { title: 'Shingeki no Kyojin', seasons: [2], episodes: [8] },
      metadata
    ),
    false
  );
  assert.equal(
    isLocalEpisodeWrong(
      { title: 'Shingeki no Kyojin', episodes: [33] },
      metadata
    ),
    false
  );
});

it('excludes shared aliases when other parts retain separate IMDb IDs after a rebuild', async (t) => {
  const shared = 'Shared Anime Alias';
  const part = {
    rid: 201,
    type: AnimeType.TV,
    title: 'Example Anime Final Part',
    synonyms: [shared],
    ids: { imdbId: 'tt09999991', thetvdbId: 999991 },
    tvdb: { seasonNumber: 3, fromEpisode: 13 },
  } as AnimeRecord;
  const other = {
    rid: 202,
    type: AnimeType.TV,
    title: 'Example Anime Part One',
    synonyms: [shared],
    ids: { imdbId: 'tt09999992', thetvdbId: 999991 },
  } as AnimeRecord;
  const lookup = t.mock.method(
    AnimeRepository,
    'findCandidates',
    async (type: string) => (type === 'imdbId' ? [part] : [part, other])
  );
  const result = await AnimeDatabase.getInstance().getEntryById(
    'imdbId',
    'tt09999991',
    3,
    20
  );
  assert.deepEqual(result?.localEpisodeTitles, ['Example Anime Final Part']);
  assert.ok(
    lookup.mock.calls.some((call) => call.arguments[0] === 'thetvdbId')
  );
});

it('handles a partial database record with no ID map', async (t) => {
  const partial = {
    rid: 301,
    type: AnimeType.TV,
    title: 'Partial Anime',
    tvdb: { seasonNumber: 2 },
  } as AnimeRecord;
  t.mock.method(AnimeRepository, 'findCandidates', async () => [partial]);
  const entry = await AnimeDatabase.getInstance().getEntryById(
    'imdbId',
    'tt09999993',
    2,
    1
  );
  assert.deepEqual(entry?.mappings, { imdbId: 'tt09999993' });
});

it('keeps sequel local queries scoped when absolute episode metadata is missing', () => {
  const id = IdParser.parse('tt09999994:2:1', 'series')!;
  const entry = {
    tvdb: { seasonNumber: 2, fromEpisode: 1 },
    localEpisodeTitles: ['Example Anime: Return'],
  } as Parameters<typeof getExternalEpisodeTitles>[1];
  const titles = getExternalEpisodeTitles(id, entry);
  assert.deepEqual(titles, ['Example Anime: Return']);
  const probe = new SearchProbe({ services: [] }, BaseDebridConfigSchema);
  assert.deepEqual(
    probe.queries(id.fullId, {
      primaryTitle: 'example anime',
      titles: [],
      isAnime: true,
      relativeAbsoluteEpisode: 1,
      localEpisodeTitles: titles,
    }),
    ['example anime S02', 'example anime return 01', 'example anime S02E01']
  );
});

it('includes distinct selected-provider titles while excluding shared provider aliases', () => {
  for (const source of ['imdb', 'trakt'] as const) {
    const providerTitle = 'Example Anime The Return';
    const chosen = {
      rid: 401,
      title: 'Example Anime Part Two',
      synonyms: ['Example Anime'],
      [source]: { title: providerTitle },
    } as AnimeRecord;
    const parent = { rid: 402, title: 'Example Anime' } as AnimeRecord;
    const titles = getEntryEpisodeTitles(chosen, [chosen, parent]);
    assert.deepEqual(titles, ['Example Anime Part Two', providerTitle]);
    const metadata: SearchMetadata = {
      primaryTitle: 'example anime',
      titles: [],
      isAnime: true,
      season: 2,
      episode: 20,
      absoluteEpisode: 44,
      relativeAbsoluteEpisode: 8,
      localEpisodeTitles: titles,
      titlesWithLang: [{ title: 'Example Anime' }, { title: providerTitle }],
    };
    const probe = new SearchProbe({ services: [] }, BaseDebridConfigSchema);
    assert.ok(
      probe
        .queries('tt09999990:2:20', metadata)
        .includes('example anime the return 08')
    );
    assert.equal(
      isLocalEpisodeWrong({ title: providerTitle, episodes: [8] }, metadata),
      false
    );
    const shared = {
      ...parent,
      [source]: { title: providerTitle },
    } as AnimeRecord;
    assert.deepEqual(getEntryEpisodeTitles(chosen, [chosen, shared]), [
      'Example Anime Part Two',
    ]);
  }
});
