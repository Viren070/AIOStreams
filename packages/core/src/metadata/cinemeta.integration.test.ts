import { before, after, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import '../index.js';
import { initDb, closeDb, getDb } from '../db/db.js';
import { sql } from '../db/sql.js';
import { settingsStore } from '../config/index.js';
import { Cache } from '../utils/cache.js';
import { IMDBMetadata } from './imdb.js';
import { MetadataService } from './service.js';
import { AnimeDatabase } from '../anime-database/index.js';
import { IdParser } from '../utils/id-parser.js';
import type { CinemetaEntry } from './cinemeta-cache.js';
import { SkyhookMetadata } from './skyhook.js';
import goosebumps from './__fixtures__/goosebumps-1995.json' with { type: 'json' };

let directory: string;
let uri: string;
const agent = new MockAgent();
const previousDispatcher = getGlobalDispatcher();
const cache = Cache.getInstance<string, CinemetaEntry>(
  'cinemeta:v2',
  undefined,
  'sql'
);

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'aiostreams-cinemeta-'));
  uri = `sqlite://${join(directory, 'cache.db')}`;
  await initDb(uri);
  await settingsStore.initialise();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});
after(async () => {
  setGlobalDispatcher(previousDispatcher);
  await agent.close();
  await closeDb();
  await rm(directory, { recursive: true, force: true });
});

describe('Cinemeta HTTP and persistent SQL cache', () => {
  it('preserves Goosebumps (1995) split episodes, season counts, aliases and release dates after a 504', async (t) => {
    // Reduced public Cinemeta snapshot from 2026-10-19; preserves its numbering
    // and dates, without artwork/description payloads. No live HTTP in tests.
    t.after(() => mock.restoreAll());
    const id = goosebumps.id;
    const now = Date.now();
    await cache.set(
      `series:${id}`,
      {
        meta: goosebumps,
        refreshAt: now - 16 * 86_400_000,
        freshUntil: now - 15 * 86_400_000,
        staleUntil: now - 1,
        errorUntil: now + 86_400_000,
        failures: 0,
        retryAt: 0,
      },
      86_400,
      true
    );
    agent
      .get('https://v3-cinemeta.strem.io')
      .intercept({ path: `/meta/series/${id}.json` })
      .reply(504, 'gateway timeout');
    mock.method(AnimeDatabase.getInstance(), 'getEntryById', async () => null);
    mock.method(IMDBMetadata.prototype, 'getImdbSuggestionData', async () => ({
      title: 'Goosebumps (1995)',
      year: 1995,
    }));
    mock.method(SkyhookMetadata.prototype, 'search', async () => []);
    const result = await new MetadataService({}).getMetadata(
      IdParser.parse(`${id}:2:2`, 'series')!,
      'series'
    );
    assert.equal(result.title, 'Goosebumps');
    assert.equal(result.year, 1995);
    assert.equal(result.yearEnd, 1998);
    assert.deepEqual(result.seasons, [
      { season_number: 0, episode_count: 3 },
      { season_number: 1, episode_count: 19 },
      { season_number: 2, episode_count: 25 },
      { season_number: 3, episode_count: 22 },
      { season_number: 4, episode_count: 8 },
    ]);
    const video = goosebumps.videos.find(
      (v) => v.season === 2 && v.episode === 2
    )!;
    assert.equal(result.episodeReleased, video.released);
    assert.equal(result.resolvedSeasonFirstEpisode, 1);
    assert.deepEqual(result.releaseYears, [1995, 1996]);
    assert.ok(result.titles?.some((t) => t.title === 'Goosebumps (1995)'));
    // Undated specials cannot be asserted aired merely because a stale entry
    // contains them; retry fallback must not reinterpret them as another show.
    await assert.rejects(
      new IMDBMetadata().getCinemetaData(id, 'series', {
        season: '0',
        episode: '1',
      }),
      /backoff/
    );
  });
  it('uses the own IMDb episode when the hinted show fails, preserving season counts and dates', async (t) => {
    t.after(() => mock.restoreAll());
    const hint = 'tt9911010';
    const own = 'tt9911011';
    const now = Date.now();
    const meta = {
      id: own,
      type: 'series',
      name: 'Own series',
      releaseInfo: '2010–2012',
      videos: [
        { id: `${own}:1:1`, season: 1, episode: 1, released: '2011-01-01' },
        { id: `${own}:1:2`, season: 1, episode: 2, released: '2011-01-08' },
      ],
    };
    await cache.set(
      `series:${own}`,
      {
        meta,
        refreshAt: now + 1000,
        freshUntil: now + 2000,
        staleUntil: now + 3000,
        errorUntil: now + 4000,
        failures: 0,
        retryAt: 0,
      },
      60,
      true
    );
    agent
      .get('https://v3-cinemeta.strem.io')
      .intercept({ path: `/meta/series/${hint}.json` })
      .reply(504, 'gateway timeout');
    mock.method(
      AnimeDatabase.getInstance(),
      'getEntryById',
      async () => ({ mappings: { imdbId: own } }) as any
    );
    mock.method(IMDBMetadata.prototype, 'getImdbSuggestionData', async () => ({
      title: 'Suggestion',
      year: 2010,
    }));
    mock.method(SkyhookMetadata.prototype, 'search', async () => []);
    const result = await new MetadataService({}).getMetadata(
      IdParser.parse(`${hint}:1:2`, 'series')!,
      'series'
    );
    assert.equal(result.title, 'Own series');
    assert.deepEqual(result.seasons, [{ season_number: 1, episode_count: 2 }]);
    assert.equal(result.episodeReleased, '2011-01-08');
    assert.deepEqual(
      result.titles?.map((title) => title.title),
      ['Own series', 'Suggestion']
    );
  });
  it('deduplicates HTTP across episodes and survives closing/reopening the database', async () => {
    const id = 'tt9911001';
    let requests = 0;
    const meta = {
      id,
      type: 'series',
      name: 'Persisted',
      releaseInfo: '2010–2012',
      videos: [1, 2].map((episode) => ({
        id: `${id}:1:${episode}`,
        season: 1,
        episode,
        released: '2011-01-01',
      })),
    };
    agent
      .get('https://v3-cinemeta.strem.io')
      .intercept({ path: `/meta/series/${id}.json` })
      .reply(() => {
        requests++;
        return { statusCode: 200, data: { meta } };
      })
      .delay(40);
    const [a, b] = await Promise.all(
      [1, 2].map((episode) =>
        new IMDBMetadata().getCinemetaData(id, 'series', {
          season: '1',
          episode: String(episode),
        })
      )
    );
    assert.equal(requests, 1);
    assert.deepEqual(a, b);
    await closeDb();
    await initDb(uri);
    // No interceptor remains: a network call on this read is a test failure.
    assert.deepEqual(
      await new IMDBMetadata().getCinemetaData(id, 'series', {
        season: '1',
        episode: '2',
      }),
      meta
    );
    assert.equal(requests, 1);
    assert.ok((await cache.get(`series:${id}`))!.meta);
    const script = `
      import './src/index.ts';
      import { MockAgent, setGlobalDispatcher } from 'undici';
      import { initDb, closeDb } from './src/db/db.ts';
      import { settingsStore } from './src/config/index.ts';
      import { IMDBMetadata } from './src/metadata/imdb.ts';
      const agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent);
      await initDb(${JSON.stringify(uri)}); await settingsStore.initialise();
      const meta = await new IMDBMetadata().getCinemetaData(${JSON.stringify(id)}, 'series', { season: '1', episode: '2' });
      console.log(JSON.stringify(meta)); await closeDb(); await agent.close(); process.exit(0);
    `;
    const child = await promisify(execFile)(
      process.execPath,
      [
        '--import',
        'tsx',
        '--import',
        './test/setup.ts',
        '--input-type=module',
        '--eval',
        script,
      ],
      { cwd: fileURLToPath(new URL('../../', import.meta.url)), timeout: 15000 }
    );
    assert.deepEqual(JSON.parse(child.stdout.trim().split('\n').at(-1)!), meta);
  });

  it('replaces expired SQL entries without changing other cache namespaces', async () => {
    const id = 'tt9911012';
    const other = Cache.getInstance<string, string>(
      'audit-existing-cache',
      undefined,
      'sql'
    );
    await other.set('keep', 'existing value', 3600, true);
    const now = Date.now();
    await cache.set(
      `series:${id}`,
      {
        meta: { id, type: 'series', name: 'Expired' },
        refreshAt: now + 1000,
        freshUntil: now + 2000,
        staleUntil: now + 3000,
        errorUntil: now + 4000,
        failures: 0,
        retryAt: 0,
      },
      60,
      true
    );
    await getDb().exec(
      sql`UPDATE cache SET expires_at = ${now - 1} WHERE key = ${`cinemeta:v2:series:${id}`}`
    );
    agent
      .get('https://v3-cinemeta.strem.io')
      .intercept({ path: `/meta/series/${id}.json` })
      .reply(200, { meta: { id, type: 'series', name: 'Replaced' } });
    assert.equal(
      (await new IMDBMetadata().getCinemetaData(id, 'series')).name,
      'Replaced'
    );
    assert.equal(await other.get('keep'), 'existing value');
    assert.ok((await cache.getTTL(`series:${id}`)) > 6 * 86_400);
  });

  it('rejects HTTP 504 and merges sufficient alternative metadata on a cold start', async (t) => {
    t.after(() => mock.restoreAll());
    const id = 'tt9911002';
    agent
      .get('https://v3-cinemeta.strem.io')
      .intercept({ path: `/meta/movie/${id}.json` })
      .reply(504, 'gateway timeout');
    mock.method(AnimeDatabase.getInstance(), 'getEntryById', async () => null);
    mock.method(IMDBMetadata.prototype, 'getImdbSuggestionData', async () => ({
      title: 'Fallback',
      year: 2020,
    }));
    const result = await new MetadataService({}).getMetadata(
      IdParser.parse(id, 'movie')!,
      'movie'
    );
    assert.equal(result.title, 'Fallback');
    assert.equal(result.year, 2020);
    const entry = await cache.get(`movie:${id}`);
    assert.equal(entry!.meta, undefined);
    assert.equal(entry!.failures, 1);
  });

  it('does not cache titleless or mismatched HTTP 200 metadata as a successful response', async () => {
    for (const [id, meta, error] of [
      ['tt9911013', { id: 'tt9911013', type: 'movie' }, /without a title/],
      [
        'tt9911014',
        { id: 'tt9999999', type: 'movie', name: 'Wrong show' },
        /mismatched/,
      ],
    ] as const) {
      agent
        .get('https://v3-cinemeta.strem.io')
        .intercept({ path: `/meta/movie/${id}.json` })
        .reply(200, { meta });
      await assert.rejects(
        new IMDBMetadata().getCinemetaData(id, 'movie'),
        error
      );
      assert.equal((await cache.get(`movie:${id}`))!.meta, undefined);
    }
  });

  it('survives a cold Cinemeta response slower than its five-second transport budget', async (t) => {
    t.after(() => mock.restoreAll());
    const id = 'tt9911004';
    agent
      .get('https://v3-cinemeta.strem.io')
      .intercept({ path: `/meta/movie/${id}.json` })
      .reply(200, {
        meta: { id, type: 'movie', name: 'Late', releaseInfo: '2020' },
      })
      .delay(5200);
    mock.method(AnimeDatabase.getInstance(), 'getEntryById', async () => null);
    mock.method(IMDBMetadata.prototype, 'getImdbSuggestionData', async () => ({
      title: 'Ready',
      year: 2020,
    }));
    const result = await new MetadataService({}).getMetadata(
      IdParser.parse(id, 'movie')!,
      'movie'
    );
    assert.equal(result.title, 'Ready');
    assert.equal((await cache.get(`movie:${id}`))!.failures, 1);
  });

  it('keeps exact episode data on stale-if-error and persists retry backoff', async () => {
    const id = 'tt9911003';
    const now = Date.now();
    const meta = {
      id,
      type: 'series',
      name: 'Known episode',
      videos: [
        {
          id: `${id}:2020:200`,
          season: 2020,
          episode: 200,
          released: '2020-10-01',
        },
      ],
    };
    await cache.set(
      `series:${id}`,
      {
        meta,
        refreshAt: now - 2,
        freshUntil: now - 2,
        staleUntil: now - 1,
        errorUntil: now + 86_400_000,
        failures: 0,
        retryAt: 0,
      },
      86_400,
      true
    );
    agent
      .get('https://v3-cinemeta.strem.io')
      .intercept({ path: `/meta/series/${id}.json` })
      .reply(504, 'gateway timeout');
    assert.deepEqual(
      await new IMDBMetadata().getCinemetaData(id, 'series', {
        season: '2020',
        episode: '200',
      }),
      meta
    );
    await closeDb();
    await initDb(uri);
    assert.deepEqual(
      await new IMDBMetadata().getCinemetaData(id, 'series', {
        season: '2020',
        episode: '200',
      }),
      meta
    );
    await assert.rejects(
      new IMDBMetadata().getCinemetaData(id, 'series', {
        season: '2020',
        episode: '201',
      }),
      /backoff/
    );
  });
});
