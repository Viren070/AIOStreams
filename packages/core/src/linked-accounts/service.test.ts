import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
// Load the core entry point first; the config, db and service modules import each other.
import '../index.js';
import { initialiseConfig } from '../config/index.js';
import { closeDb, getDb, initDb } from '../db/db.js';
import { sql } from '../db/sql.js';
import { LinkedAccountRepository } from '../db/repositories/linked-accounts.js';
import { LinkedAccountService } from './service.js';

// test/setup.ts points BASE_URL here, so manifest URLs on it count as our own.
const BASE_PORT = 3000;
const UUID = '2528d43f-b21a-45b7-911b-daf82470e05e';
const MANIFEST_URL = `http://localhost:${BASE_PORT}/stremio/${UUID}/pw/manifest.json`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linked-service-'));
let catalogs: unknown[] = [];
let reinstalls = 0;
const servers: http.Server[] = [];

function listen(port: number, handler: http.RequestListener) {
  const server = http.createServer(handler);
  servers.push(server);
  return new Promise<AddressInfo>((resolve) =>
    server.listen(port, '127.0.0.1', () =>
      resolve(server.address() as AddressInfo)
    )
  );
}

function json(res: http.ServerResponse, body: unknown) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

describe('LinkedAccountService.pushIfChanged', () => {
  let linkId: string;

  before(async () => {
    await initDb(`sqlite://${path.join(dir, 'test.db')}`);
    await initialiseConfig();
    // This instance, serving the configuration's manifest.
    await listen(BASE_PORT, (_req, res) =>
      json(res, {
        id: 'aiostreams',
        name: 'AIOStreams',
        version: '1.0.0',
        catalogs,
        resources: [],
        types: [],
      })
    );
    // An AIOManager instance accepting pushes.
    const manager = await listen(0, (req, res) => {
      if (req.url === '/hydra/reinstall') reinstalls++;
      json(res, { addons: [] });
    });
    await getDb().exec(
      sql`INSERT INTO users (uuid, password_hash, config, config_salt)
          VALUES (${UUID}, 'hash', 'config', 'salt')`
    );
    linkId = (
      await LinkedAccountRepository.create({
        uuid: UUID,
        platform: 'aiomanager',
        label: 'AIOManager',
        identity: 'manager',
        credentials: { apiKey: 'key' },
        config: {
          instanceUrl: `http://127.0.0.1:${manager.port}`,
          manifestUrls: [MANIFEST_URL],
        },
      })
    ).id;
  });

  after(async () => {
    for (const server of servers) server.close();
    await closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    reinstalls = 0;
  });

  it('pushes a manifest the platform has not seen', async () => {
    catalogs = [{ type: 'movie', id: 'one' }];
    assert.notEqual(
      await LinkedAccountService.pushIfChanged(UUID, linkId),
      null
    );
    assert.equal(reinstalls, 1);
  });

  it('leaves the platform alone when the manifest is unchanged', async () => {
    assert.equal(await LinkedAccountService.pushIfChanged(UUID, linkId), null);
    assert.equal(reinstalls, 0);
  });

  it('pushes again once the manifest changes', async () => {
    catalogs = [{ type: 'movie', id: 'two' }];
    assert.notEqual(
      await LinkedAccountService.pushIfChanged(UUID, linkId),
      null
    );
    assert.equal(reinstalls, 1);
  });
});
