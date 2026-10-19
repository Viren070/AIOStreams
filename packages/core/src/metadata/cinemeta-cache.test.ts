import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CinemetaCache,
  cinemetaPolicy,
  type CinemetaEntry,
  type CinemetaStore,
} from './cinemeta-cache.js';
import type { Meta } from '../db/schemas.js';

const DAY = 86_400_000;
const fixture = (extra: Partial<Meta> = {}): Meta => ({
  id: 'tt0000001',
  type: 'series',
  name: 'Example',
  releaseInfo: '2020–',
  videos: [
    { id: 'tt0000001:1:1', season: 1, episode: 1, released: '2020-01-01' },
  ],
  ...extra,
});
const episode = { season: '1', episode: '1' };
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function store() {
  const values = new Map<string, CinemetaEntry>();
  const backend: CinemetaStore = {
    get: async (key) => structuredClone(values.get(key)),
    set: async (key, value) => {
      values.set(key, structuredClone(value));
    },
  };
  return { backend, values };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('Cinemeta cache', () => {
  it('coalesces a slow cold load across episodes and returns independent snapshots', async () => {
    const db = store();
    const pending = deferred<Meta>();
    let requests = 0;
    const cache = new CinemetaCache({
      store: db.backend,
      load: async () => {
        requests++;
        return pending.promise;
      },
    });
    const results = [
      cache.get('tt0000001', 'series', episode),
      cache.get('tt0000001', 'series', { season: '2', episode: '1' }),
    ];
    await settle();
    assert.equal(requests, 1);
    pending.resolve(fixture());
    const [a, b] = await Promise.all(results);
    a.videos!.length = 0;
    assert.equal(b.videos!.length, 1);
  });

  it('refreshes before expiration without waiting and bounds background concurrency', async () => {
    const db = store();
    let now = Date.parse('2026-01-01');
    let requests = 0;
    const pending = deferred<Meta>();
    const cache = new CinemetaCache({
      store: db.backend,
      now: () => now,
      maxBackground: 1,
      load: async () => {
        requests++;
        return requests <= 2 ? fixture() : pending.promise;
      },
    });
    await cache.get('one', 'series');
    await cache.get('two', 'series');
    now += 46 * 60_000;
    await cache.get('one', 'series', episode);
    await cache.get('one', 'series', episode);
    await cache.get('two', 'series', episode);
    assert.equal(requests, 3);
    pending.resolve(fixture({ name: 'Refreshed' }));
    await settle();
    assert.equal((await cache.get('one', 'series', episode)).name, 'Refreshed');
  });

  it('serves stale while revalidating and keeps the last good response after HTTP 504', async () => {
    const db = store();
    let now = Date.parse('2026-01-01');
    let requests = 0;
    const cache = new CinemetaCache({
      store: db.backend,
      now: () => now,
      load: async () => {
        if (++requests > 1) throw new Error('HTTP 504');
        return fixture();
      },
    });
    await cache.get('one', 'series', episode);
    const original = structuredClone(db.values.get('series:one')!);
    now += 2 * 3600_000;
    assert.equal((await cache.get('one', 'series', episode)).name, 'Example');
    await settle();
    for (let i = 0; i < 10; i++) await cache.get('one', 'series', episode);
    assert.equal(requests, 2);
    assert.equal(db.values.get('series:one')!.freshUntil, original.freshUntil);
    assert.equal(db.values.get('series:one')!.errorUntil, original.errorUntil);
    now += 2 * DAY;
    assert.equal((await cache.get('one', 'series', episode)).name, 'Example');
    assert.equal(requests, 3); // stale-if-error, outside the SWR window
    now += 7 * DAY;
    await assert.rejects(cache.get('one', 'series', episode), /504/);
  });

  it('does not guess a missing or future episode from stale data', async () => {
    for (const request of [{ season: '2', episode: '1' }, episode]) {
      const db = store();
      let now = Date.parse('2026-01-01');
      let fail = false;
      const cache = new CinemetaCache({
        store: db.backend,
        now: () => now,
        load: async () => {
          if (fail) throw new Error('HTTP 504');
          return fixture({
            videos: [
              { id: 'future', season: 1, episode: 1, released: '2027-01-01' },
            ],
          });
        },
      });
      await cache.get('one', 'series');
      fail = true;
      now += 2 * 3600_000;
      await assert.rejects(cache.get('one', 'series', request), /504/);
      await assert.rejects(cache.get('one', 'series', request), /backoff/);
    }
  });

  it('backs off cold failures across new cache instances and resets after success', async () => {
    const db = store();
    let now = Date.parse('2026-01-01');
    let requests = 0;
    let fail = true;
    const options = {
      store: db.backend,
      now: () => now,
      load: async () => {
        requests++;
        if (fail) throw new Error('HTTP 504');
        return fixture();
      },
    };
    await assert.rejects(
      new CinemetaCache(options).get('one', 'series'),
      /504/
    );
    await assert.rejects(
      new CinemetaCache(options).get('one', 'series'),
      /backoff/
    );
    assert.equal(requests, 1);
    now += 60_001;
    await assert.rejects(
      new CinemetaCache(options).get('one', 'series'),
      /504/
    );
    assert.equal(db.values.get('series:one')!.retryAt, now + 120_000);
    now += 120_001;
    fail = false;
    await new CinemetaCache(options).get('one', 'series');
    assert.equal(db.values.get('series:one')!.failures, 0);
  });

  it('uses shorter policies for ongoing/unknown series, including scheduled episodes', () => {
    const now = Date.parse('2026-01-01');
    assert.equal(cinemetaPolicy(fixture(), 'series', now).fresh, 3600_000);
    assert.equal(
      cinemetaPolicy(fixture({ releaseInfo: '2020' }), 'series', now).fresh,
      3600_000
    );
    assert.equal(
      cinemetaPolicy(fixture({ releaseInfo: '2020–2022' }), 'series', now)
        .fresh,
      7 * DAY
    );
    assert.equal(
      cinemetaPolicy(
        fixture({
          releaseInfo: '2020–2022',
          videos: [{ id: 'future', released: '2027-01-01' }],
        }),
        'series',
        now
      ).fresh,
      3600_000
    );
    assert.equal(cinemetaPolicy(fixture(), 'movie', now).fresh, 7 * DAY);
    assert.equal(
      cinemetaPolicy(
        fixture({ releaseInfo: '2020–2026', status: 'Returning Series' }),
        'series',
        now
      ).fresh,
      3600_000
    );
  });

  it('does not turn storage failures into provider failures or discard a good response', async () => {
    const errors: unknown[] = [];
    const writes: CinemetaEntry[] = [];
    const cache = new CinemetaCache({
      store: {
        get: async () => {
          throw new Error('read unavailable');
        },
        set: async (_, entry) => {
          writes.push(entry);
          throw new Error('disk full');
        },
      },
      load: async () => fixture(),
      onError: (error) => errors.push(error),
    });
    assert.equal((await cache.get('one', 'series', episode)).name, 'Example');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].failures, 0);
    assert.ok(errors.length >= 2);
  });

  it('keeps the provider error when persisting backoff fails', async () => {
    const cache = new CinemetaCache({
      store: {
        get: async () => undefined,
        set: async () => {
          throw new Error('disk full');
        },
      },
      load: async () => {
        throw new Error('HTTP 504');
      },
    });
    await assert.rejects(cache.get('one', 'series'), /HTTP 504/);
  });

  it('does not overwrite a newer refresh after a delayed SQL read', async () => {
    const db = store();
    let now = Date.parse('2026-01-01');
    let requests = 0;
    let oldRead: CinemetaEntry | undefined;
    const cache = new CinemetaCache({
      store: db.backend,
      now: () => now,
      load: async () => fixture({ name: `Version ${++requests}` }),
    });
    await cache.get('one', 'series', episode);
    oldRead = structuredClone(db.values.get('series:one'));
    now += 2 * DAY;
    await cache.get('one', 'series', episode);
    const latest = structuredClone(db.values.get('series:one'));
    let reads = 0;
    const delayed = new CinemetaCache({
      store: {
        get: async () => (++reads === 1 ? oldRead : latest),
        set: db.backend.set,
      },
      now: () => now,
      load: async () =>
        assert.fail('old read must not refetch/overwrite the new response'),
    });
    assert.equal(
      (await delayed.get('one', 'series', episode)).name,
      'Version 2'
    );
    assert.equal(db.values.get('series:one')!.meta!.name, 'Version 2');
  });

  it('briefly caches absent episodes without guessing their numbering or retaining them stale', async () => {
    const db = store();
    let now = Date.parse('2026-01-01');
    let requests = 0;
    const missing = { season: '2', episode: '100' };
    const cache = new CinemetaCache({
      store: db.backend,
      now: () => now,
      load: async () => {
        if (++requests > 2) throw new Error('HTTP 504');
        return fixture();
      },
    });
    await cache.get('one', 'series', missing);
    for (let i = 0; i < 20; i++) await cache.get('one', 'series', missing);
    assert.equal(requests, 1);
    now += 60_001;
    await cache.get('one', 'series', missing);
    assert.equal(requests, 2);
    now += 2 * 3600_000;
    await assert.rejects(cache.get('one', 'series', missing), /504/);
  });

  it('retains continuous anime numbering and specials exactly on stale reads', async () => {
    const db = store();
    let now = Date.parse('2026-01-01');
    const videos = [
      { id: 'special', season: 0, episode: 0, released: '2020-01-01' },
      { id: 'cour', season: 2, number: 13, released: '2020-02-01' },
    ];
    const cache = new CinemetaCache({
      store: db.backend,
      now: () => now,
      load: async () => fixture({ videos }),
    });
    await cache.get('one', 'series');
    now += 2 * 3600_000;
    for (const request of [
      { season: '0', episode: '0' },
      { season: '2', episode: '13' },
    ]) {
      const result = await cache.get('one', 'series', request);
      assert.deepEqual(result.videos, videos);
    }
  });

  it('releases failed background slots, backs off, and does not queue skipped work', async () => {
    const db = store();
    let now = Date.parse('2026-01-01');
    const calls: string[] = [];
    const pending = deferred<Meta>();
    const cache = new CinemetaCache({
      store: db.backend,
      now: () => now,
      maxBackground: 1,
      load: async (id) => {
        calls.push(id);
        return calls.length <= 2 ? fixture() : pending.promise;
      },
    });
    await cache.get('one', 'series');
    await cache.get('two', 'series');
    now += 2 * 3600_000;
    await cache.get('one', 'series', episode);
    await cache.get('two', 'series', episode);
    assert.deepEqual(calls, ['one', 'two', 'one']);
    pending.reject(new Error('HTTP 504'));
    await settle();
    // No queue: the skipped show's refresh starts only on its next access.
    assert.equal(calls.length, 3);
    await cache.get('one', 'series', episode);
    assert.equal(calls.length, 3);
    await cache.get('two', 'series', episode);
    await settle();
    assert.deepEqual(calls, ['one', 'two', 'one', 'two']);
  });
});
