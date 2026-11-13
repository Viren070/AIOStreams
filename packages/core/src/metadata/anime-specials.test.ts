import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { AnimeDatabase, IdParser } from '../utils/index.js';
import { AnimeType, type AnimeEntry } from '../anime-database/types.js';
import { isExplicitAnimeParentTitle } from '../anime-database/sibling-titles.js';
import { settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';
import { ReleaseBlocklistRepository } from '../db/repositories/release-blocklist.js';
import { DistributedLock } from '../utils/distributed-lock.js';
import { IdMappingDataset } from './id-mappings.js';
import {
  resolveCrossProviderIds,
  scopeAnimeEpisodeMappings,
} from './id-resolution.js';
import { MetadataService } from './service.js';
import { TMDBMetadata } from './tmdb.js';
import { TVDBMetadata } from './tvdb.js';
import { SkyhookMetadata } from './skyhook.js';
import { IMDBMetadata } from './imdb.js';
import StreamFilterer from '../streams/filterer.js';
import FileParser from '../parser/file.js';
import { StreamContext } from '../streams/context.js';
import type { ParsedStream, UserData } from '../db/schemas.js';

const title = 'Rurouni Kenshin: Reflection';
const requestedId = 'tt0294885:1:2';
const makeEntry = (): AnimeEntry => ({
  type: AnimeType.OVA,
  title: 'Rurouni Kenshin: Meiji Kenkaku Romantan - Seisou-hen',
  synonyms: [title, 'Samurai X: Reflection'],
  siblingTitles: ['Rurouni Kenshin'],
  mappings: { imdbId: 'tt0294885', themoviedbId: 28136, thetvdbId: 70863 },
  imdb: { title: 'Samurai X: Reflection' },
  tmdb: { seasonNumber: 0, seasonId: null, fromEpisode: 6 },
  tvdb: { seasonNumber: 0, seasonId: null, fromEpisode: 6 },
});
const episodes = [1, 2].map((number) => ({
  number,
  season: 1,
  episode: number,
  name: `After So Many Years Have Passed Part ${number}`,
  released: '2001-12-12T00:00:00.000Z',
  aired: '2001-12-12',
}));

async function setup(t: TestContext) {
  t.mock.method(SettingsRepository, 'getAll', async () => []);
  t.mock.method(SettingsRepository, 'getVersion', async () => 0);
  t.mock.method(ReleaseBlocklistRepository, 'hasEntries', async () => false);
  await settingsStore.initialise();
  const entry = makeEntry();
  t.mock.method(AnimeDatabase, 'getInstance', () => ({
    getEntryById: async () => entry,
    hasSiblingRecords: async () => false,
  }));
  // The cross-provider CSV has no Reflection row. Provider IMDb lookups must
  // work without a dataset correction or title-specific override.
  t.mock.method(IdMappingDataset, 'getInstance', () => ({
    resolve: () => ({}),
  }));
  t.mock.method(DistributedLock, 'getInstance', () => ({
    withLock: async (_key: string, fn: () => Promise<unknown>) => ({
      result: await fn(),
    }),
  }));
  const lookupIds: string[] = [];
  const episodeLookups: number[][] = [];
  t.mock.method(TMDBMetadata.prototype, 'getMetadata', async (id) => {
    lookupIds.push(id.fullId);
    return id.type === 'imdbId'
      ? {
          title,
          year: 2001,
          tmdbId: 240853,
          originalLanguage: 'ja',
          genres: ['Animation'],
          seasons: [{ season_number: 1, episode_count: 2 }],
        }
      : { title: 'Rurouni Kenshin', year: 1996, tmdbId: 28136 };
  });
  t.mock.method(TVDBMetadata.prototype, 'getMetadata', async (id) => {
    lookupIds.push(id.fullId);
    return id.type === 'imdbId'
      ? { title, year: 2001, tvdbId: 395150, runtime: 45 }
      : { title: 'Rurouni Kenshin', year: 1996, tvdbId: 70863 };
  });
  t.mock.method(IMDBMetadata.prototype, 'getCinemetaData', async () => ({
    name: title,
    releaseInfo: '2001-2002',
    videos: episodes,
  }));
  t.mock.method(IMDBMetadata.prototype, 'getImdbSuggestionData', async () => ({
    title,
    year: 2001,
  }));
  t.mock.method(
    TMDBMetadata.prototype,
    'getNextEpisodeAirDate',
    async () => undefined
  );
  t.mock.method(
    TMDBMetadata.prototype,
    'getEpisodeDetails',
    async (id, season, episode) => {
      episodeLookups.push([id, season, episode]);
      return {
        airDate: '2001-12-12',
        runtime: 45,
        titles: [{ title: episodes[1].name, language: 'en' }],
      };
    }
  );
  t.mock.method(
    TVDBMetadata.prototype,
    'getSeasonEpisodes',
    async () => episodes
  );
  t.mock.method(TMDBMetadata.prototype, 'searchSeries', async () => [
    { tmdbId: 240853, name: title, year: 2001, country: 'JP' },
  ]);
  t.mock.method(TVDBMetadata.prototype, 'searchSeries', async () => [
    { tvdbId: 395150, name: title, year: 2001, country: 'JP' },
  ]);
  t.mock.method(SkyhookMetadata.prototype, 'search', async () => []);
  t.mock.method(SkyhookMetadata.prototype, 'getMetadata', async () => {
    throw new Error('Parent metadata must not be requested');
  });
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async (id) => ({
    tvdbId: id,
    title,
    status: 'Ended',
    episodes: episodes.map((ep) => ({
      seasonNumber: 1,
      episodeNumber: ep.number,
      airDate: ep.aired,
      title: ep.name,
    })),
  }));
  return { entry, lookupIds, episodeLookups };
}

it('resolves a standalone IMDb OVA without inheriting parent-specials IDs', async (t) => {
  const { entry } = await setup(t);
  const parsed = IdParser.parse(requestedId, 'series')!;
  assert.deepEqual(resolveCrossProviderIds(parsed, entry, 'series'), {
    imdbId: 'tt0294885',
    tmdbId: undefined,
    tvdbId: undefined,
  });
  for (const id of [
    'tt0294885:0:2',
    'kitsu:368:2',
    'tvdb:70863:0:7',
    'tmdb:28136:0:7',
  ]) {
    const resolved = resolveCrossProviderIds(
      IdParser.parse(id, 'series')!,
      entry,
      'series'
    );
    assert.equal(resolved.tmdbId, 28136);
    assert.equal(resolved.tvdbId, 70863);
  }
  const regular = {
    ...entry,
    tmdb: { ...entry.tmdb, seasonNumber: 1 },
    tvdb: { ...entry.tvdb, seasonNumber: 1 },
  };
  assert.equal(
    resolveCrossProviderIds(parsed, regular, 'series').tmdbId,
    28136
  );
  assert.equal(
    resolveCrossProviderIds(parsed, regular, 'series').tvdbId,
    70863
  );
});

it('keeps the unaffected provider mapping when only one points at specials', async (t) => {
  const { entry } = await setup(t);
  const parsed = IdParser.parse(requestedId, 'series')!;
  const mixed = { ...entry, tvdb: { ...entry.tvdb, seasonNumber: 1 } };
  assert.deepEqual(resolveCrossProviderIds(parsed, mixed, 'series'), {
    imdbId: 'tt0294885',
    tmdbId: undefined,
    tvdbId: 70863,
  });
  assert.equal(resolveCrossProviderIds(parsed, entry, 'movie').tmdbId, 28136);
});

it('retains provider IDs when a partial entry has no explicit specials hints', async (t) => {
  await setup(t);
  const partial = { mappings: makeEntry().mappings } as AnimeEntry;
  assert.deepEqual(
    resolveCrossProviderIds(
      IdParser.parse(requestedId, 'series')!,
      partial,
      'series'
    ),
    { imdbId: 'tt0294885', tmdbId: 28136, tvdbId: 70863 }
  );
});

it('resets only hints whose provider identity changed without mutating the entry', () => {
  const entry = makeEntry();
  const original = structuredClone(entry);
  const scoped = scopeAnimeEpisodeMappings(entry, {
    tmdbId: 240853,
    tvdbId: 395150,
  })!;
  assert.equal(scoped.tmdb.seasonNumber, null);
  assert.equal(scoped.tvdb.seasonNumber, null);
  assert.equal(scoped.tmdb.fromEpisode, undefined);
  assert.deepEqual(entry, original);
  assert.equal(
    scopeAnimeEpisodeMappings(entry, { tmdbId: 28136, tvdbId: 70863 }),
    entry
  );
  assert.equal(scopeAnimeEpisodeMappings(entry, {}), entry);
  assert.equal(
    scopeAnimeEpisodeMappings(entry, { tmdbId: 240853 })!.tvdb,
    entry.tvdb
  );
});

it('preserves native parent numbering but rejects standalone IMDb S01 aliases', () => {
  const entry = makeEntry();
  assert.equal(
    isExplicitAnimeParentTitle('Rurouni Kenshin', entry, [1], 1, 'imdbId'),
    false
  );
  assert.equal(
    isExplicitAnimeParentTitle('Rurouni Kenshin', entry, [1], 1, 'thetvdbId'),
    true
  );
  assert.equal(
    isExplicitAnimeParentTitle('Rurouni Kenshin', entry, [0], 0, 'imdbId'),
    true
  );
});

it('uses the standalone identity for metadata, matching and episode runtime', async (t) => {
  const { entry, lookupIds, episodeLookups } = await setup(t);
  const original = structuredClone(entry);
  const metadata = await new MetadataService({
    tmdbApiKey: 'test',
    tvdbApiKey: 'test',
  }).getMetadata(IdParser.parse(requestedId, 'series')!, 'series');
  assert.equal(metadata.title, title);
  assert.equal(metadata.year, 2001);
  assert.equal(Number(metadata.tmdbId), 240853);
  assert.equal(metadata.tvdbId, 395150);
  assert.equal(metadata.titleConflicts, undefined);
  assert.deepEqual(lookupIds, ['tt0294885', 'tt0294885']);
  assert.ok(episodeLookups.length > 0);
  assert.ok(
    episodeLookups.every(
      ([id, season, episode]) =>
        Number(id) === 240853 && season === 1 && episode === 2
    ),
    JSON.stringify(episodeLookups)
  );
  assert.deepEqual(entry, original);
  const context = {
    type: 'series',
    id: requestedId,
    parsedId: IdParser.parse(requestedId, 'series'),
    isAnime: true,
    animeEntry: entry,
    getMetadata: async () => ({ ...metadata, absoluteEpisode: 2 }),
    getEpisodeRuntime: async () => undefined,
    getReleaseDates: async () => undefined,
    getEpisodeAirDate: async () => undefined,
    getPermittedPatterns: async () => ({
      permitted: new Set(),
      unrestricted: true,
    }),
    toExpressionContext: () => ({}),
  } as unknown as StreamContext;
  const names = [
    'Rurouni.Kenshin.Reflection.S01E02.1080p.BluRay.mkv',
    'Rurouni.Kenshin.S01E02.1080p.WEB.mkv',
    'Rurouni.Kenshin.Reflection.S01E01.1080p.BluRay.mkv',
  ];
  const streams = names.map(
    (filename) =>
      ({
        id: filename,
        type: 'usenet',
        filename,
        parsedFile: FileParser.parse(filename),
        idMatched: true,
        addon: { name: 'Test', preset: { id: 'test' } },
      }) as ParsedStream
  );
  const filtered = await new StreamFilterer({
    titleMatching: {
      enabled: true,
      mode: 'exact',
      similarityThreshold: 0.96,
      ambiguousResults: 'discard',
    },
    seasonEpisodeMatching: { enabled: true, strict: true },
  } as UserData).filter(streams, context);
  assert.deepEqual(
    filtered.map((stream) => stream.filename),
    [names[0]]
  );
  const realContext = await StreamContext.create('series', requestedId, {
    tmdbApiKey: 'test',
    tvdbApiKey: 'test',
  } as UserData);
  assert.equal(await realContext.getEpisodeRuntime(), 45);
  assert.ok(
    episodeLookups.every(
      ([id, season, episode]) =>
        Number(id) === 240853 && season === 1 && episode === 2
    ),
    JSON.stringify(episodeLookups)
  );
});

it('falls back to the requested IMDb metadata when providers fail', async (t) => {
  await setup(t);
  t.mock.method(TMDBMetadata.prototype, 'getMetadata', async () => {
    throw new Error('unavailable');
  });
  t.mock.method(TVDBMetadata.prototype, 'getMetadata', async () => {
    throw new Error('unavailable');
  });
  const metadata = await new MetadataService({
    tmdbApiKey: 'test',
    tvdbApiKey: 'test',
  }).getMetadata(IdParser.parse(requestedId, 'series')!, 'series');
  assert.equal(metadata.title, title);
  assert.equal(metadata.year, 2001);
  assert.equal(metadata.tmdbId, null);
  assert.equal(metadata.tvdbId, null);
});
