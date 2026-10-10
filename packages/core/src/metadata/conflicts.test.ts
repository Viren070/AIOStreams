import {
  regularEpisodes,
  seriesContext,
  release as makeTestRelease,
  catalogue,
} from '../../test/title-fixtures.js';
import '../streams/filterer.js';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { MetadataService } from './service.js';
import { AnimeDatabase, IdParser } from '../utils/index.js';
import { DistributedLock } from '../utils/distributed-lock.js';
import { detectTitleConflicts } from './conflicts.js';
import { SkyhookMetadata } from './skyhook.js';
import { TMDBMetadata } from './tmdb.js';
import { TVDBMetadata } from './tvdb.js';
import { getStreamTitleConflicts } from '../streams/title-conflicts.js';
import StreamFilterer from '../streams/filterer.js';
import { RegexAccess } from '../utils/regex-access.js';
import { initialiseTestSettings, mockHttp } from '../../test/helpers.js';
import type { ParsedStream, UserData } from '../db/schemas.js';

it('keeps same-year/country adaptations with different provider IDs and preserves the ID-search policy', async (t) => {
  await initialiseTestSettings(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  const title = "Komi Can't Communicate";
  t.mock.method(SkyhookMetadata.prototype, 'search', async () => [
    { title, tvdbId: 409718, year: 2021, country: 'JP' },
    { title, tvdbId: 402412, year: 2021, country: 'JP' },
  ]);
  t.mock.method(TMDBMetadata.prototype, 'searchSeries', async () => [
    { name: title, tmdbId: 129637, year: 2021, country: 'JP' },
    { name: title, tmdbId: 123876, year: 2021, country: 'JP' },
  ]);
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async (tvdbId) =>
    catalogue(tvdbId, [12], 'Ended', { title: title })
  );
  t.mock.method(TMDBMetadata.prototype, 'getSeasonBound', async () => 1);
  t.mock.method(
    TMDBMetadata.prototype,
    'getEpisodeCatalog',
    async (tmdbId) => ({
      tmdbId,
      status: 'Ended',
      episodes: regularEpisodes([12]),
    })
  );
  const metadata = {
    title: title + ' (2021)',
    titles: [{ title }, { title: title + ' (2021)' }],
    year: 2021,
    country: 'JP',
    tvdbId: 409718,
    tmdbId: 129637,
    releaseYears: [2021],
    seasons: [{ season_number: 1, episode_count: 8 }],
    titleConflicts: await detectTitleConflicts({
      title,
      year: 2021,
      country: 'JP',
      tvdbId: 409718,
      tmdbId: 129637,
      tmdbAuth: { apiKey: 'test' },
    }),
  };
  const context = seriesContext(metadata, {
    id: 'tt15100806:1:4',
    parsedId: {
      type: 'imdbId',
      value: 'tt15100806',
      season: '1',
      episode: '4',
    },
  });
  const filename = 'Komi.Cant.Communicate.S01E04.1080p.BluRay.X264-iNSPiRE.mkv';
  const release = makeTestRelease(filename, { id: 'one' }) as ParsedStream;
  const filter = new StreamFilterer({
    tmdbApiKey: 'test',
    titleMatching: { enabled: true, ambiguousResults: 'discard' },
    yearMatching: { enabled: true },
    seasonEpisodeMatching: { enabled: true, strict: true },
  } as UserData);
  assert.equal(
    (await filter.filter([release], context)).length,
    0,
    'a text result cannot identify the adaptation with shared tags'
  );
  assert.equal(
    (await filter.filter([{ ...release, idMatched: true }], context)).length,
    1,
    'ID provenance retains ordinary matching'
  );
  assert.deepEqual(
    metadata.titleConflicts.map((c) => c.tvdbId ?? `tmdb:${c.tmdbId}`).sort(),
    [402412, 'tmdb:123876'].sort()
  );
});

it('deduplicates provider identity rather than shared tags, retaining missing tags and all known competitors', async (t) => {
  await initialiseTestSettings(t);
  const candidates = Array.from({ length: 12 }, (_, i) => ({
    name: 'Shared Show',
    tmdbId: 100 + i,
    year: 2021,
    country: 'JP',
  }));
  t.mock.method(TMDBMetadata.prototype, 'searchSeries', async () => [
    ...candidates,
    { ...candidates[0] },
    { name: 'Shared Show', tmdbId: 999 },
  ]);
  t.mock.method(SkyhookMetadata.prototype, 'search', async () => [
    { title: 'Shared Show', tvdbId: 100, year: 2021, country: 'JP' },
  ]);
  const found = await detectTitleConflicts({
    title: 'Shared Show',
    year: 1990,
    country: 'US',
    tmdbId: 1,
    tvdbId: 2,
    tmdbAuth: { apiKey: 'test' },
  });
  assert.equal(found.length, 14);
  assert.equal(found.filter((c) => c.tmdbId === 100).length, 1);
  assert.ok(
    found.some((c) => c.tvdbId === 100),
    'equal numbers in different namespaces are separate identities'
  );
  assert.ok(
    found.some((c) => c.tmdbId === 999),
    'missing year and country must not erase a known identity'
  );
});

it('keeps failed alias searches unresolved, preserves partial conflicts and distinguishes successful empty searches', async (t) => {
  await initialiseTestSettings(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  let mode: 'failed' | 'partial' | 'empty' = 'failed';
  t.mock.method(
    TMDBMetadata.prototype,
    'getSeasonBound',
    async () => undefined
  );
  t.mock.method(
    TMDBMetadata.prototype,
    'getEpisodeCatalog',
    async () => undefined
  );
  t.mock.method(TMDBMetadata.prototype, 'searchSeries', async () => {
    if (mode === 'empty') return [];
    if (mode === 'partial')
      return [{ name: 'Shared Alias', tmdbId: 2, year: 2020, country: 'US' }];
    throw new Error('offline');
  });
  t.mock.method(TVDBMetadata.prototype, 'searchSeries', async () => {
    throw new Error('offline');
  });
  t.mock.method(SkyhookMetadata.prototype, 'search', async () => {
    if (mode === 'empty') return [];
    throw new Error('offline');
  });
  const metadata = {
    title: 'Distinct Show',
    titles: [{ title: 'Distinct Show' }, { title: 'Shared Alias' }],
    tvdbId: 1,
    tmdbId: 1,
    year: 1998,
    country: 'US',
  };
  const auth = { tmdbAuth: { apiKey: 'test' }, tvdbApiKey: 'test' };
  for (const next of ['failed', 'partial', 'empty'] as const) {
    mode = next;
    const unresolved = new Set<string>();
    const found = await getStreamTitleConflicts(
      metadata,
      ['Shared Alias'],
      auth,
      undefined,
      { unresolvedAliases: unresolved }
    );
    assert.equal(unresolved.has('sharedalias'), mode !== 'empty');
    if (mode === 'partial')
      assert.equal(found.get('sharedalias')?.[0].tmdbId, 2);
    const filename = 'Shared.Alias.S01E10.mkv';
    const release = makeTestRelease(filename, { id: 'one' }) as ParsedStream;
    const context = seriesContext(metadata, {
      id: 'tt0108850:1:10',
      parsedId: {
        type: 'imdbId',
        value: 'tt0108850',
        season: '1',
        episode: '10',
      },
    });
    const filter = new StreamFilterer({
      yearMatching: { enabled: true },
      tvdbApiKey: 'test',
      tmdbApiKey: 'test',
      titleMatching: { enabled: true, ambiguousResults: 'discard' },
    } as UserData);
    assert.equal(
      (await filter.filter([release], context)).length,
      mode === 'empty' ? 1 : 0
    );
    assert.equal(
      (await filter.filter([{ ...release, idMatched: true }], context)).length,
      1
    );
  }
});

it('propagates Skyhook transport failures and retains normal successful search caching', async (t) => {
  await initialiseTestSettings(t);
  const agent = mockHttp(t);
  let available = false;
  let calls = 0;
  agent
    .get('https://skyhook.sonarr.tv')
    .intercept({ path: /^\/v1\/tvdb\/search\/en\/\?term=DiscoveryFailure/ })
    .reply(() => {
      calls++;
      return {
        statusCode: available ? 200 : 500,
        data: available
          ? '[{"tvdbId":98766001,"title":"DiscoveryFailure regression"}]'
          : '{}',
        responseOptions: { headers: { 'content-type': 'application/json' } },
      };
    })
    .persist();
  const client = new SkyhookMetadata();
  await assert.rejects(client.search('DiscoveryFailure regression'));
  available = true;
  assert.equal(
    (await client.search('DiscoveryFailure regression'))[0].tvdbId,
    98766001
  );
  const after = calls;
  assert.equal(
    (await client.search('DiscoveryFailure regression'))[0].tvdbId,
    98766001
  );
  assert.equal(calls, after, 'successful nonempty searches retain their cache');
  agent.assertNoPendingInterceptors();
});

it('carries primary discovery failure through metadata and the filter without blocking ID results', async (t) => {
  await initialiseTestSettings(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  t.mock.method(
    AnimeDatabase.getInstance(),
    'getEntryById',
    async () => undefined
  );
  t.mock.method(
    DistributedLock.getInstance(),
    'withLock',
    async (_key, fn) => ({ result: await fn() })
  );
  t.mock.method(SkyhookMetadata.prototype, 'getMetadata', async (tvdbId) => ({
    title: 'Distinct Show',
    titles: [{ title: 'Distinct Show' }],
    tvdbId,
    year: 1998,
    country: 'US',
  }));
  let available = false;
  t.mock.method(SkyhookMetadata.prototype, 'search', async () => {
    if (available) return [];
    throw new Error('offline');
  });
  t.mock.method(TMDBMetadata.prototype, 'searchSeries', async () => {
    if (available) return [];
    throw new Error('offline');
  });
  for (const success of [false, true]) {
    available = success;
    const requested = IdParser.parse('tvdb:98766701', 'series');
    const metadata = await new MetadataService({}).getMetadata(
      requested,
      'series'
    );
    assert.equal(
      metadata.titleConflictsUnavailable,
      success ? undefined : true
    );
    const context = seriesContext(metadata, {
      id: 'tvdb:98766701:1:10',
      parsedId: {
        type: 'thetvdbId',
        value: '98766701',
        season: '1',
        episode: '10',
      },
    });
    const filename = 'Distinct.Show.S01E10.mkv';
    const release = makeTestRelease(filename, { id: 'one' }) as ParsedStream;
    const filter = new StreamFilterer({
      yearMatching: { enabled: true },
      titleMatching: { enabled: true, ambiguousResults: 'discard' },
    } as UserData);
    assert.equal(
      (await filter.filter([release], context)).length,
      success ? 1 : 0
    );
    assert.equal(
      (await filter.filter([{ ...release, idMatched: true }], context)).length,
      1
    );
  }
});
