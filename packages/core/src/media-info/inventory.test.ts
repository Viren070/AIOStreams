import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import '../index.js';
import type { UserData } from '../db/schemas.js';
import { Cache } from '../utils/cache.js';
import type { MediaInfoIdentity } from './identity.js';
import { torrentInventories } from './inventory.js';

const hash = 'a'.repeat(40);
const name = 'folder/Movie.mkv';
const size = 6_930_229_510;
const identity: MediaInfoIdentity = {
  releaseKeys: [`btih:${hash}`],
  service: 'torbox',
};
const user = {
  services: [{ id: 'torbox', credentials: { apiKey: 'fixture' } }],
} as UserData;
const item = (hash: string) => ({ hash, size, files: [{ name, size }] });
let requests: string[][];
let response: (hashes: string[]) => unknown;
let status: number;

beforeEach(async () => {
  await Cache.clearPrefix('media-info:torbox-inventory');
  requests = [];
  status = 200;
  response = (hashes) => ({ success: true, data: hashes.map(item) });
  mock.method(
    globalThis,
    'fetch',
    async (input: string, options: RequestInit) => {
      const url = new URL(input);
      assert.equal(url.origin, 'https://api.torbox.app');
      assert.equal(url.pathname, '/v1/api/torrents/checkcached');
      assert.equal(options.method, 'GET');
      assert.equal(
        new Headers(options.headers).get('authorization'),
        'Bearer fixture'
      );
      assert.equal(url.searchParams.get('format'), 'list');
      assert.equal(url.searchParams.get('list_files'), 'true');
      const hashes = url.searchParams.get('hash')!.split(',');
      assert.ok(hashes.length <= 100);
      requests.push(hashes);
      return new Response(JSON.stringify(response(hashes)), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  );
});

afterEach(() => mock.restoreAll());

describe('complete TorBox inventory', () => {
  it('uses the native SDK and caches only a verified sole-file response', async () => {
    assert.deepEqual(
      (await torrentInventories([identity], user)).get(identity),
      [{ name, size }]
    );
    const another = { ...identity };
    assert.deepEqual((await torrentInventories([another], user)).get(another), [
      { name, size },
    ]);
    assert.equal(requests.length, 1);
    const now = Date.now();
    mock.method(Date, 'now', () => now + 3_601_000);
    await torrentInventories([identity], user);
    assert.equal(requests.length, 2);
  });

  it('rejects partial, contradictory, duplicate and malformed inventories', async () => {
    for (const data of [
      [],
      {},
      [item('b'.repeat(40))],
      [item(hash), item(hash)],
      [{ hash, files: [{ name, size }] }],
      [{ ...item(hash), size: size + 1 }],
      [
        {
          ...item(hash),
          files: [
            { name, size },
            { name: 'sample.mkv', size: 10 },
          ],
        },
      ],
      [{ ...item(hash), files: [{ name, size }, null] }],
      [{ ...item(hash), files: [] }],
      [{ hash, size: 0, files: [{ name, size: 0 }] }],
      [{ hash, size: 1.5, files: [{ name, size: 1.5 }] }],
      [
        {
          hash,
          size: Number.MAX_SAFE_INTEGER + 1,
          files: [{ name, size: Number.MAX_SAFE_INTEGER + 1 }],
        },
      ],
      [{ ...item(hash), files: [{ size }] }],
    ]) {
      await Cache.clearPrefix('media-info:torbox-inventory');
      response = () => ({ success: true, data });
      assert.equal((await torrentInventories([identity], user)).size, 0);
    }
  });

  it('does not accept error responses or retry an unavailable provider immediately', async () => {
    response = () => {
      throw new Error('network unavailable');
    };
    assert.equal((await torrentInventories([identity], user)).size, 0);
    assert.equal((await torrentInventories([identity], user)).size, 0);
    assert.equal(requests.length, 1);
    const now = Date.now();
    mock.method(Date, 'now', () => now + 31_000);
    response = (hashes) => ({ success: true, data: hashes.map(item) });
    assert.equal((await torrentInventories([identity], user)).size, 1);
    assert.equal(requests.length, 2);
  });

  it('rejects HTTP and application errors even if their payload includes files', async () => {
    status = 503;
    assert.equal((await torrentInventories([identity], user)).size, 0);
    assert.equal(requests.length, 1);
    await Cache.clearPrefix('media-info:torbox-inventory');
    status = 200;
    response = () => ({ success: false, data: [item(hash)] });
    assert.equal((await torrentInventories([identity], user)).size, 0);
  });

  it('deduplicates hashes and limits each batch to 100', async () => {
    const identities = Array.from({ length: 201 }, (_, n) => ({
      ...identity,
      releaseKeys: [`btih:${n.toString(16).padStart(40, '0')}`],
    }));
    const found = await torrentInventories(
      [...identities, identities[0]],
      user
    );
    assert.equal(found.size, 201);
    assert.deepEqual(
      requests.map((hashes) => hashes.length),
      [100, 100, 1]
    );
  });

  it('never treats other providers or their partial caches as complete', async () => {
    assert.equal(
      (await torrentInventories([{ ...identity, service: 'realdebrid' }], user))
        .size,
      0
    );
    assert.equal((await torrentInventories([identity], undefined)).size, 0);
    assert.equal(requests.length, 0);
  });

  it('aborts a slow native request after the enrichment timeout', async () => {
    let calls = 0;
    mock.method(globalThis, 'fetch', (_url: string, options: RequestInit) => {
      calls++;
      return new Promise((_resolve, reject) =>
        options.signal!.addEventListener(
          'abort',
          () => reject(options.signal!.reason),
          { once: true }
        )
      );
    });
    const keepAlive = setTimeout(() => {}, 5_000);
    const started = performance.now();
    try {
      assert.equal((await torrentInventories([identity], user)).size, 0);
      assert.equal(calls, 1);
      assert.ok(performance.now() - started < 4_500);
    } finally {
      clearTimeout(keepAlive);
    }
  });
});
