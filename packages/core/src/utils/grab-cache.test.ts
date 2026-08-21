import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { parseNzb } from '../usenet/nzb/parse.js';
import {
  GrabHttpError,
  NzbTooLargeError,
  assertLikelyNzbPayload,
} from './download-manager.js';
import { DiskBackedCache } from './disk-backed-cache.js';
import { GrabCache } from './grab-cache.js';

const bufferCodec = {
  serialize: (value: Buffer): Buffer => value,
  deserialize: (value: Buffer): Buffer => value,
  sizeOf: (value: Buffer): number => value.length,
};

const VALID_NZB = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
  <file poster="poster" date="1" subject="&quot;video.mkv&quot; yEnc (1/1)">
    <groups><group>alt.binaries.test</group></groups>
    <segments><segment bytes="10" number="1">part@example.test</segment></segments>
  </file>
</nzb>`);

async function testCache(
  t: TestContext,
  opts: { maxMemBytes?: number; maxDiskBytes?: number } = {}
): Promise<GrabCache<Buffer>> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aiostreams-grab-test-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return new GrabCache<Buffer>({
    name: 'grab-test',
    dir,
    maxMemBytes: opts.maxMemBytes ?? 1024 * 1024,
    maxDiskBytes: opts.maxDiskBytes ?? 0,
    ...bufferCodec,
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('GrabCache producer validation', () => {
  it('does not cache a successful HTTP-shaped HTML payload', async (t) => {
    const cache = await testCache(t);
    const url = 'https://indexer.test/api?t=get&id=poisoned';
    let requests = 0;
    const produce = async (): Promise<Buffer> => {
      requests++;
      const body = Buffer.from('<!doctype html><html>Login</html>');
      assertLikelyNzbPayload('text/html', body);
      return body;
    };

    await assert.rejects(() => cache.fetch(url, produce));
    assert.equal(await cache.cached(url), undefined);
    await assert.rejects(() => cache.fetch(url, produce));
    assert.equal(requests, 2);
  });

  it('caches a valid NZB after validation and preserves single-flight', async (t) => {
    const cache = await testCache(t);
    const url = 'https://indexer.test/api?t=get&id=valid';
    const release = deferred<Buffer>();
    let requests = 0;
    const produce = async (): Promise<Buffer> => {
      requests++;
      const body = await release.promise;
      assertLikelyNzbPayload('application/octet-stream', body);
      return body;
    };

    const first = cache.fetch(url, produce);
    const second = cache.fetch(url, produce);
    release.resolve(VALID_NZB);
    assert.deepEqual(await first, VALID_NZB);
    assert.deepEqual(await second, VALID_NZB);
    assert.deepEqual(await cache.fetch(url, produce), VALID_NZB);
    assert.equal(requests, 1);
  });

  it('does not cache HTTP or size failures', async (t) => {
    const cache = await testCache(t);
    const cases = [
      {
        key: 'http',
        error: new GrabHttpError(503, 'Service Unavailable'),
      },
      { key: 'size', error: new NzbTooLargeError(101, 100) },
    ];

    for (const { key, error } of cases) {
      let attempts = 0;
      const produce = async (): Promise<Buffer> => {
        attempts++;
        throw error;
      };
      await assert.rejects(() => cache.fetch(key, produce), error.constructor);
      assert.equal(await cache.cached(key), undefined);
      await assert.rejects(() => cache.fetch(key, produce), error.constructor);
      assert.equal(attempts, 2);
    }
  });
});

describe('GrabCache.delete', () => {
  for (const tier of [
    { name: 'L1', maxMemBytes: 1024, maxDiskBytes: 0 },
    { name: 'L2', maxMemBytes: 0, maxDiskBytes: 1024 },
  ]) {
    it(`removes only the requested key from ${tier.name}`, async (t) => {
      const cache = await testCache(t, tier);
      await cache.fetch('target', async () => Buffer.from('target'));
      await cache.fetch('other', async () => Buffer.from('other'));
      assert.deepEqual(await cache.cached('target'), Buffer.from('target'));
      assert.deepEqual(await cache.cached('other'), Buffer.from('other'));

      assert.equal(await cache.delete('target'), true);
      assert.equal(await cache.cached('target'), undefined);
      assert.deepEqual(await cache.cached('other'), Buffer.from('other'));
      assert.equal(await cache.delete('target'), false);
      assert.equal(await cache.delete('unknown'), false);
    });
  }

  it('coalesces deletes, waits an earlier producer, and gates a new fetch', async (t) => {
    const cache = await testCache(t);
    const started = deferred<void>();
    const release = deferred<Buffer>();
    let replacementRuns = 0;

    const first = cache.fetch('target', async () => {
      started.resolve();
      return release.promise;
    });
    await started.promise;

    const deleting = cache.delete('target');
    const coalesced = cache.delete('target');
    assert.strictEqual(coalesced, deleting);

    const replacement = cache.fetch('target', async () => {
      replacementRuns++;
      return Buffer.from('fresh');
    });
    const unrelated = cache.fetch('other', async () => Buffer.from('other'));
    assert.deepEqual(await unrelated, Buffer.from('other'));
    assert.equal(replacementRuns, 0);

    release.resolve(Buffer.from('stale'));
    assert.deepEqual(await first, Buffer.from('stale'));
    assert.equal(await deleting, true);
    assert.equal(await coalesced, true);
    assert.deepEqual(await replacement, Buffer.from('fresh'));
    assert.equal(replacementRuns, 1);
    assert.deepEqual(await cache.cached('target'), Buffer.from('fresh'));
  });

  it('still invalidates after an earlier producer rejects', async (t) => {
    const cache = await testCache(t);
    const started = deferred<void>();
    const release = deferred<Buffer>();
    const original = new Error('producer failed');
    const first = cache.fetch('target', async () => {
      started.resolve();
      return release.promise;
    });
    await started.promise;
    const deleting = cache.delete('target');
    release.reject(original);

    await assert.rejects(first, (err) => err === original);
    assert.equal(await deleting, false);
    assert.deepEqual(
      await cache.fetch('target', async () => Buffer.from('fresh')),
      Buffer.from('fresh')
    );
  });

  it('waits for a pending cached L2 read before deletion', async (t) => {
    const cache = await testCache(t, {
      maxMemBytes: 0,
      maxDiskBytes: 1024,
    });
    const key = 'https://indexer.test/api?t=get&id=pending-read';
    const stale = Buffer.from('stale');
    await cache.fetch(key, async () => stale);

    const backing = (cache as unknown as { cache: DiskBackedCache<Buffer> })
      .cache;
    await backing.flush();
    backing.resize(1024);

    const readStarted = deferred<void>();
    const releaseRead = deferred<void>();
    const originalGetAsync = backing.getAsync.bind(backing);
    let firstRead = true;
    t.mock.method(backing, 'getAsync', async (readKey: string) => {
      if (!firstRead) return originalGetAsync(readKey);
      firstRead = false;
      readStarted.resolve();
      await releaseRead.promise;
      // Model getAsync's completed L2-read promotion after invalidation began.
      backing.set(readKey, stale, { skipDisk: true });
      return stale;
    });
    const originalDelete = backing.delete.bind(backing);
    const deleteBacking = t.mock.method(
      backing,
      'delete',
      (deleteKey: string) => originalDelete(deleteKey)
    );

    const reading = cache.cached(key);
    await readStarted.promise;
    const deleting = cache.delete(key);
    assert.equal(deleteBacking.mock.callCount(), 0);

    releaseRead.resolve();
    assert.deepEqual(await reading, stale);
    assert.equal(await deleting, true);
    assert.equal(deleteBacking.mock.callCount(), 1);
    assert.equal(await originalGetAsync(key), undefined);
  });
});

describe('poisoned NZB self-healing', () => {
  it('evicts a pre-existing poisoned URL after parsing and fetches fresh next time', async (t) => {
    const cache = await testCache(t);
    const url = 'https://indexer.test/api?t=get&id=self-heal';
    const otherUrl = 'https://indexer.test/api?t=get&id=other';
    const poisoned = Buffer.from('<html><body>Rules</body></html>');
    await cache.fetch(url, async () => poisoned);
    await cache.fetch(otherUrl, async () => VALID_NZB);

    const cached = await cache.fetch(url, async () => {
      throw new Error('poisoned entry should have been a cache hit');
    });
    let parseError: unknown;
    try {
      await parseNzb(cached);
    } catch (err) {
      parseError = err;
      await cache.delete(url);
    }
    assert.ok(parseError instanceof Error);
    assert.equal(await cache.cached(url), undefined);
    assert.deepEqual(await cache.cached(otherUrl), VALID_NZB);

    let remoteRequests = 0;
    const fresh = await cache.fetch(url, async () => {
      remoteRequests++;
      return VALID_NZB;
    });
    const parsed = await parseNzb(fresh);
    assert.equal(parsed.files.length, 1);
    assert.deepEqual(await cache.fetch(url, async () => poisoned), VALID_NZB);
    assert.equal(remoteRequests, 1);
  });
});
