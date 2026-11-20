import { before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import '../index.js';
import { MetadataService } from './service.js';
import { prepareBuiltinStream } from './preparation.js';
import { Wrapper } from '../main/wrapper.js';
import { AnimeDatabase } from '../anime-database/index.js';
import { IdParser } from '../utils/id-parser.js';
import { enrichParsedIdWithAnimeEntry } from '../anime-database/enrich.js';
import { config, settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';
import type { Addon } from '../db/schemas.js';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import StreamFetcher from '../streams/fetcher.js';

const metadata = {
  title: 'Example',
  titles: [{ title: 'Example' }],
  year: 2020,
};
const manifest = (name = 'newznab', settings = {}) =>
  `${config.bootstrap.internalUrl}/builtins/${name}/${Buffer.from(JSON.stringify(settings)).toString('base64url')}/manifest.json`;

before(async () => {
  const rows = mock.method(SettingsRepository, 'getAll', async () => []);
  const version = mock.method(SettingsRepository, 'getVersion', async () => 0);
  await settingsStore.initialise();
  rows.mock.restore();
  version.mock.restore();
});

describe('required metadata preparation', () => {
  it('starts TorBox HTTP immediately and does not abort its 5-second metadata wait at 4 seconds', async (t) => {
    t.after(() => mock.restoreAll());
    const agent = new MockAgent();
    agent.disableNetConnect();
    const previous = getGlobalDispatcher();
    setGlobalDispatcher(agent);
    t.after(async () => {
      setGlobalDispatcher(previous);
      await agent.close();
    });
    let resolutions = 0;
    mock.method(AnimeDatabase.getInstance(), 'getEntryById', async () => null);
    mock.method(
      MetadataService.prototype as any,
      'resolveMetadata',
      async () => {
        resolutions++;
        await delay(5000);
        return metadata;
      }
    );
    const started = Date.now();
    const sent = Promise.withResolvers<void>();
    const id = 'tt0000008:1:1';
    const url = new URL(manifest('torbox-search'));
    agent
      .get(url.origin)
      .intercept({
        path: url.pathname.replace(
          'manifest.json',
          `stream/series/${encodeURIComponent(id)}.json`
        ),
      })
      .reply(() => {
        sent.resolve();
        return { statusCode: 200, data: { streams: [] } };
      })
      .delay(5100);
    const wrapper = new Wrapper({
      name: 'TorBox Search',
      enabled: true,
      timeout: 4000,
      manifestUrl: url.toString(),
      preset: { type: 'torbox-search', options: {} },
    } as Addon);
    const operation = Promise.all([
      wrapper.getStreams('series', id),
      wrapper.getStreams('series', id),
    ]);
    await sent.promise;
    assert.ok(Date.now() - started < 1000);
    assert.deepEqual(await operation, [[], []]);
    assert.equal(resolutions, 1);
    await new MetadataService({}).getMetadata(
      IdParser.parse(id, 'series')!,
      'series'
    );
    assert.equal(resolutions, 2); // execution released its preparation lease
  });

  it('enforces the execution deadline after concurrent preparation and cleans up', async () => {
    let released = false;
    const wrapper = new Wrapper({
      manifestUrl: manifest(),
      preset: { type: 'newznab' },
    } as Addon) as any;
    await assert.rejects(
      wrapper._request({
        requestFn: (signal: AbortSignal) => delay(1000, undefined, { signal }),
        prepare: async () => {
          await delay(20);
          return () => {
            released = true;
          };
        },
        concurrentPreparation: true,
        timeout: 10,
        resourceName: 'stream',
        cacheKey: 'concurrent-deadline',
        cacheTtl: 0,
      }),
      /aborted/
    );
    assert.equal(released, true);
  });

  it('times out a coalesced waiter without cancelling the shared owner', async () => {
    const wrapper = new Wrapper({
      manifestUrl: manifest(),
      preset: { type: 'newznab' },
    } as Addon) as any;
    const common = {
      prepare: async () => () => {},
      concurrentPreparation: true,
      resourceName: 'stream',
      cacheKey: 'waiter-deadline',
      cacheTtl: 0,
    };
    const owner = wrapper._request({
      ...common,
      timeout: 200,
      requestFn: async () => {
        await delay(100);
        return 'owner';
      },
    });
    await assert.rejects(
      wrapper._request({
        ...common,
        timeout: 10,
        requestFn: () => assert.fail('waiter must coalesce with owner'),
      }),
      /timeout/
    );
    assert.equal(await owner, 'owner');
  });
  for (const behaviour of ['parallel', 'sequential'] as const)
    it(`preserves ${behaviour} grouping through the real HTTP wrapper`, async (t) => {
      t.after(() => mock.restoreAll());
      const agent = new MockAgent();
      agent.disableNetConnect();
      const previous = getGlobalDispatcher();
      setGlobalDispatcher(agent);
      t.after(async () => {
        setGlobalDispatcher(previous);
        await agent.close();
      });
      const prepared = Promise.withResolvers<typeof metadata>();
      const externalStarted = Promise.withResolvers<void>();
      let preparations = 0;
      mock.method(
        AnimeDatabase.getInstance(),
        'getEntryById',
        async () => null
      );
      mock.method(MetadataService.prototype as any, 'resolveMetadata', () => {
        preparations++;
        return prepared.promise;
      });
      const id = `tt000000${behaviour === 'parallel' ? '6' : '7'}:1:1`;
      const external = {
        name: 'External',
        enabled: true,
        timeout: 4000,
        instanceId: 'external',
        manifestUrl: 'https://independent.example/manifest.json',
        preset: { type: 'custom', id: 'external', options: {} },
      } as Addon;
      const builtin = {
        name: 'Newznab',
        enabled: true,
        timeout: 4000,
        instanceId: 'builtin',
        manifestUrl: manifest(),
        preset: { type: 'newznab', id: 'builtin', options: {} },
      } as Addon;
      agent
        .get('https://independent.example')
        .intercept({ path: `/stream/series/${encodeURIComponent(id)}.json` })
        .reply(() => {
          externalStarted.resolve();
          return { statusCode: 200, data: { streams: [] } };
        });
      if (behaviour === 'parallel') {
        const url = new URL(manifest());
        agent
          .get(url.origin)
          .intercept({
            path: url.pathname.replace(
              'manifest.json',
              `stream/series/${encodeURIComponent(id)}.json`
            ),
          })
          .reply(200, { streams: [] });
      }
      const fetcher = new StreamFetcher(
        {
          remuxDb: { enabled: false },
          groups: {
            enabled: true,
            behaviour,
            groupings: [
              { addons: ['external'], condition: 'true' },
              {
                addons: ['builtin'],
                condition: behaviour === 'parallel' ? 'true' : 'false',
              },
            ],
          },
        } as any,
        {
          filter: async (streams: unknown) => streams,
          filterBlocklisted: async (streams: unknown) => streams,
        } as any,
        {
          precomputeSeaDexOnly: async () => {},
          precomputePreferred: async () => {},
        } as any
      );
      const operation = fetcher.fetch([external, builtin], {
        type: 'series',
        id,
        queryType: 'series',
        startAllFetches() {},
      } as any);
      await externalStarted.promise;
      if (behaviour === 'parallel') {
        prepared.resolve(metadata);
      }
      const result = await operation;
      assert.deepEqual(result.errors, []);
      assert.equal(preparations, behaviour === 'parallel' ? 1 : 0);
      agent.assertNoPendingInterceptors();
    });
  for (const background of [false, true])
    it(`keeps 5-second preparation outside a 4-second ${background ? 'background-enabled' : 'foreground'} execution deadline`, async (t) => {
      let resolutions = 0;
      t.after(() => mock.restoreAll());
      mock.method(
        AnimeDatabase.getInstance(),
        'getEntryById',
        async () => null
      );
      mock.method(
        MetadataService.prototype as any,
        'resolveMetadata',
        async () => {
          resolutions++;
          await delay(5000);
          return metadata;
        }
      );
      const wrapper = new Wrapper({
        manifestUrl: manifest(),
        preset: { type: 'newznab' },
      } as Addon) as any;
      const started = Date.now();
      let independentStarted = false;
      const operation = wrapper._request({
        requestFn: async () => {
          const deadline = AbortSignal.timeout(4000);
          // This is the handler's own metadata lookup after the internal HTTP hop.
          const reused = await new MetadataService({}).getMetadata(
            IdParser.parse('tt0000001:1:1', 'series')!,
            'series'
          );
          assert.equal(reused.title, 'Example');
          await delay(30, undefined, { signal: deadline });
          return 'streams';
        },
        prepare: () =>
          prepareBuiltinStream(manifest(), 'series', 'tt0000001:1:1'),
        timeout: 4000,
        resourceName: 'stream',
        cacheKey: 'test',
        cacheTtl: 0,
        cacher: background
          ? { get: async () => undefined, set: async () => {} }
          : undefined,
      });
      await wrapper._request({
        requestFn: async () => {
          independentStarted = true;
          return [];
        },
        timeout: 100,
        resourceName: 'stream',
        cacheKey: 'independent',
        cacheTtl: 0,
      });
      assert.equal(independentStarted, true);
      assert.ok(Date.now() - started < 1000);
      assert.equal(await operation, 'streams');
      assert.equal(resolutions, 1);
    });

  it('allows near-budget HTTP execution after five seconds of Newznab metadata preparation', async (t) => {
    t.after(() => mock.restoreAll());
    const agent = new MockAgent();
    agent.disableNetConnect();
    const previous = getGlobalDispatcher();
    setGlobalDispatcher(agent);
    t.after(async () => {
      setGlobalDispatcher(previous);
      await agent.close();
    });
    mock.method(AnimeDatabase.getInstance(), 'getEntryById', async () => null);
    let resolutions = 0;
    mock.method(
      MetadataService.prototype as any,
      'resolveMetadata',
      async () => {
        resolutions++;
        await delay(5000);
        return metadata;
      }
    );
    const id = 'tt0000018:1:1';
    const url = new URL(manifest());
    agent
      .get(url.origin)
      .intercept({
        path: url.pathname.replace(
          'manifest.json',
          `stream/series/${encodeURIComponent(id)}.json`
        ),
      })
      .reply(200, { streams: [] })
      .delay(3800);
    const wrapper = new Wrapper({
      name: 'Newznab',
      enabled: true,
      timeout: 4000,
      manifestUrl: url.toString(),
      preset: { type: 'newznab', options: {} },
    } as Addon);
    const started = Date.now();
    assert.deepEqual(await wrapper.getStreams('series', id), []);
    assert.ok(Date.now() - started >= 8500);
    assert.equal(resolutions, 1);
    agent.assertNoPendingInterceptors();
  });

  it('releases failed/timed-out preparation and does not cancel another waiter', async (t) => {
    t.after(() => mock.restoreAll());
    const pending = Promise.withResolvers<typeof metadata>();
    let calls = 0;
    mock.method(MetadataService.prototype as any, 'resolveMetadata', () =>
      ++calls === 1 ? pending.promise : Promise.resolve(metadata)
    );
    const id = IdParser.parse('tt0000004:1:1', 'series')!;
    const service = new MetadataService({});
    mock.timers.enable({ apis: ['setTimeout'] });
    const first = service.prepare(id, 'series');
    const failed = assert.rejects(first, /preparation timed out/);
    mock.timers.tick(config.userLimits.timeouts.maxTimeout - 10);
    const second = service.prepare(id, 'series');
    mock.timers.tick(10);
    await failed;
    pending.resolve(metadata);
    const release = await second;
    assert.equal(calls, 1);
    release();
    const releaseNext = await service.prepare(id, 'series');
    assert.equal(calls, 2);
    releaseNext();
    mock.timers.reset();
  });

  it('includes the initial anime lookup in the preparation ceiling and skips work after it expires', async (t) => {
    t.after(() => mock.restoreAll());
    const anime = Promise.withResolvers<null>();
    mock.method(
      AnimeDatabase.getInstance(),
      'getEntryById',
      () => anime.promise
    );
    mock.method(MetadataService.prototype, 'prepare', () =>
      assert.fail('expired preparation must not start providers')
    );
    mock.timers.enable({ apis: ['setTimeout'] });
    const operation = prepareBuiltinStream(
      manifest(),
      'series',
      'tt0000015:1:1'
    );
    const failed = assert.rejects(operation, /preparation timed out/);
    mock.timers.tick(config.userLimits.timeouts.maxTimeout);
    await failed;
    anime.resolve(null);
    await Promise.resolve();
    mock.timers.reset();
  });

  it('lets the route handle invalid configuration without starting providers', async (t) => {
    t.after(() => mock.restoreAll());
    mock.method(AnimeDatabase.getInstance(), 'getEntryById', () =>
      assert.fail('invalid route configuration must not prepare')
    );
    for (const url of [
      manifest('newznab', { tmdbApiKey: 42 }),
      manifest('newznab', null),
      manifest().replace('/e30/', '/invalid/'),
    ]) {
      assert.equal(
        await prepareBuiltinStream(url, 'series', 'tt0000016:1:1'),
        undefined
      );
    }
  });

  it('uses the same enriched anime episode and lease across the internal HTTP boundary', async (t) => {
    t.after(() => mock.restoreAll());
    const entry = {
      imdb: { seasonNumber: 2, fromEpisode: 13 },
      mappings: { imdbId: 'tt9911111' },
    } as any;
    mock.method(AnimeDatabase.getInstance(), 'getEntryById', async () => entry);
    let calls = 0;
    mock.method(
      MetadataService.prototype as any,
      'resolveMetadata',
      async (id: any) => {
        calls++;
        assert.equal(id.season, '2');
        assert.equal(id.episode, '13');
        return metadata;
      }
    );
    const release = await prepareBuiltinStream(
      manifest(),
      'anime',
      'kitsu:9911111:1'
    );
    const parsed = IdParser.parse('kitsu:9911111:1', 'anime')!;
    enrichParsedIdWithAnimeEntry(parsed, entry);
    assert.equal(
      (await new MetadataService({}).getMetadata(parsed, 'series')).title,
      'Example'
    );
    assert.equal(calls, 1);
    release!();
  });

  it('separates preparation for different metadata credentials', async (t) => {
    t.after(() => mock.restoreAll());
    let calls = 0;
    mock.method(
      MetadataService.prototype as any,
      'resolveMetadata',
      async () => {
        calls++;
        return metadata;
      }
    );
    const id = IdParser.parse('tt0000005:1:1', 'series')!;
    const releases = await Promise.all(
      ['one', 'two'].map((tmdbApiKey) =>
        new MetadataService({ tmdbApiKey }).prepare(id, 'series')
      )
    );
    assert.equal(calls, 2);
    releases.forEach((release) => release());
  });

  it('leases metadata across delayed groups, isolates callers, and releases after execution', async (t) => {
    t.after(() => mock.restoreAll());
    let calls = 0;
    mock.method(
      MetadataService.prototype as any,
      'resolveMetadata',
      async () => {
        calls++;
        return metadata;
      }
    );
    const service = new MetadataService({});
    const id = IdParser.parse('tt0000002:1:1', 'series')!;
    const [releaseA, releaseB] = await Promise.all([
      service.prepare(id, 'series'),
      service.prepare(id, 'series'),
    ]);
    assert.equal(calls, 1);
    (await service.getMetadata(id, 'series')).titles!.length = 0;
    releaseA();
    releaseA();
    assert.equal((await service.getMetadata(id, 'series')).titles!.length, 1);
    releaseB();
    await service.getMetadata(id, 'series');
    assert.equal(calls, 2);
  });

  it('isolates ordinary metadata consumers from the lock result reused by preparation', async (t) => {
    t.after(() => mock.restoreAll());
    mock.method(
      MetadataService.prototype as any,
      'resolveMetadata',
      async () => metadata
    );
    const service = new MetadataService({});
    const id = IdParser.parse('tt0000017:1:1', 'series')!;
    (await service.getMetadata(id, 'series')).titles!.length = 0;
    const release = await service.prepare(id, 'series');
    assert.equal((await service.getMetadata(id, 'series')).titles!.length, 1);
    release();
  });

  it('skips external addons/direct Library IDs and recognizes the actual Easynews route', async (t) => {
    t.after(() => mock.restoreAll());
    let calls = 0;
    mock.method(AnimeDatabase.getInstance(), 'getEntryById', async () => null);
    mock.method(
      MetadataService.prototype as any,
      'resolveMetadata',
      async () => {
        calls++;
        return metadata;
      }
    );
    assert.equal(
      await prepareBuiltinStream(
        'https://example.com/manifest.json',
        'series',
        'tt0000003:1:1'
      ),
      undefined
    );
    assert.equal(
      await prepareBuiltinStream(
        manifest('library'),
        'series',
        'library::test'
      ),
      undefined
    );
    const release = await prepareBuiltinStream(
      manifest('easynews'),
      'series',
      'tt0000003:1:1'
    );
    assert.equal(calls, 1);
    release!();
  });

  it('does not prepare cached stream responses', async () => {
    const wrapper = new Wrapper({
      manifestUrl: manifest(),
      preset: { type: 'newznab' },
    } as Addon) as any;
    const result = await wrapper._request({
      prepare: () => assert.fail('cached resources must not wait for metadata'),
      requestFn: () => assert.fail('cached resources must not fetch'),
      cacher: { get: async () => ['cached'] },
      timeout: 4000,
      resourceName: 'stream',
      cacheKey: 'cached',
      cacheTtl: 10,
    });
    assert.deepEqual(result, ['cached']);
  });

  for (const concurrentPreparation of [false, true])
    it(`returns stale streams after ${concurrentPreparation ? 'concurrent' : 'required'} preparation fails`, async () => {
      const wrapper = new Wrapper({
        manifestUrl: manifest(),
        preset: { type: 'newznab' },
      } as Addon) as any;
      const result = await wrapper._request({
        prepare: async () => {
          throw new Error('metadata unavailable');
        },
        concurrentPreparation,
        requestFn: async (signal: AbortSignal) => delay(1000, [], { signal }),
        cacher: { get: async () => ['stale'] },
        bypassCache: true,
        timeout: 20,
        resourceName: 'stream',
        cacheKey: `failed-preparation-${concurrentPreparation}`,
        cacheTtl: 10,
      });
      assert.deepEqual(result, ['stale']);
    });

  for (const fails of [true, false])
    it(`finishes an early ${fails ? 'failed' : 'successful'} concurrent transport without waiting for preparation and releases its late lease`, async () => {
      const wrapper = new Wrapper({
        manifestUrl: manifest(),
        preset: { type: 'torbox-search' },
      } as Addon) as any;
      const pending = Promise.withResolvers<() => void>();
      let releases = 0;
      const operation = wrapper._request({
        prepare: () => pending.promise,
        concurrentPreparation: true,
        requestFn: async () => {
          if (fails) throw new Error('HTTP 500');
          return 'streams';
        },
        timeout: 20,
        resourceName: 'stream',
        cacheKey: `early-transport-${fails}`,
        cacheTtl: 0,
      });
      if (fails) await assert.rejects(operation, /HTTP 500/);
      else assert.equal(await operation, 'streams');
      pending.resolve(() => {
        releases++;
      });
      await delay(0);
      assert.equal(releases, 1);
    });
});
