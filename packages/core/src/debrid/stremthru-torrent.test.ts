import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { getDebridService } from './index.js';
import { toUrlSafeBase64 } from '../utils/general.js';
import { initDb } from '../db/index.js';
import { initialiseConfig } from '../config/index.js';

// getDebridService reads runtime config (poll times, builtin stremthru url),
// which needs a database + initialised config.
before(async () => {
  const dbFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'aiostreams-stt-test-')),
    'test.db'
  );
  await initDb(`sqlite://${dbFile}`);
  await initialiseConfig();
});

function cred(obj: Record<string, string>): string {
  return toUrlSafeBase64(JSON.stringify(obj));
}

test('getDebridService builds a torrent-capable StremThru service for stremthru_torrent', () => {
  const svc = getDebridService(
    'stremthru_torrent',
    cred({ url: 'http://my-stremthru:8080', authToken: 'secret' })
  );
  assert.equal(svc.serviceName, 'stremthru_torrent');
  assert.equal(svc.capabilities.torrents, true);
  assert.equal(svc.capabilities.usenet, false);
});

test('stremthru_torrent rejects credentials missing url or token', () => {
  assert.throws(() =>
    getDebridService('stremthru_torrent', cred({ url: 'http://x' }))
  );
  assert.throws(() => getDebridService('stremthru_torrent', 'not-base64-json'));
});
