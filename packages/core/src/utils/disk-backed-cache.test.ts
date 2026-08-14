import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it, type TestContext } from 'node:test';
import { DiskBackedCache } from './disk-backed-cache.js';

const codec = {
  serialize: (value: Buffer): Buffer => value,
  deserialize: (value: Buffer): Buffer => value,
  sizeOf: (value: Buffer): number => value.length,
};

async function tempDir(t: TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aiostreams-disk-test-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function makeCache(dir: string, name = 'disk-test'): DiskBackedCache<Buffer> {
  return new DiskBackedCache<Buffer>({
    name,
    dir,
    maxMemBytes: 0,
    maxDiskBytes: 16 * 1024 * 1024,
    ...codec,
  });
}

it('persists unaffected keys and keeps a targeted deletion across reloads', async (t) => {
  const dir = await tempDir(t);
  const first = makeCache(dir);
  await first.whenReady();
  first.set('target', Buffer.from('target'));
  first.set('other', Buffer.from('other'));
  await first.flush();
  assert.equal(await first.delete('target'), true);
  assert.equal(await first.delete('target'), false);
  await first.close();

  const reopened = makeCache(dir);
  await reopened.whenReady();
  assert.equal(await reopened.getAsync('target'), undefined);
  assert.deepEqual(await reopened.getAsync('other'), Buffer.from('other'));
  await reopened.close();
});

it('drains a pending write before deletion and cannot overwrite a fresh rewrite', async (t) => {
  const dir = await tempDir(t);
  const name = 'pending-write';
  const key = 'https://indexer.test/api?t=get&id=pending';
  const fileKey = createHash('sha1').update(key).digest('hex');
  const filePath = path.join(dir, name, fileKey);
  const cache = makeCache(dir, name);
  await cache.whenReady();

  cache.set(key, Buffer.alloc(4 * 1024 * 1024, 0x61));
  assert.equal(await cache.delete(key), true);
  await assert.rejects(() => fs.stat(filePath), { code: 'ENOENT' });

  const fresh = Buffer.from('fresh valid NZB body');
  cache.set(key, fresh);
  await cache.flush();
  assert.deepEqual(await fs.readFile(filePath), fresh);
  await cache.close();

  const reopened = makeCache(dir, name);
  await reopened.whenReady();
  assert.deepEqual(await reopened.getAsync(key), fresh);
  await reopened.close();
});
