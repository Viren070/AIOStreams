import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Load the core entry point first; the db modules and the logger import each other.
import '../../index.js';
import { closeDb, getDb, initDb } from '../db.js';
import { sql } from '../sql.js';
import { LinkedAccountRepository } from './linked-accounts.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linked-accounts-'));

async function addLink(uuid: string, pushOnParentChange: boolean) {
  await getDb().exec(
    sql`INSERT INTO users (uuid, password_hash, config, config_salt)
        VALUES (${uuid}, 'hash', 'config', 'salt')
        ON CONFLICT(uuid) DO NOTHING`
  );
  const link = await LinkedAccountRepository.create({
    uuid,
    platform: 'aiomanager',
    label: 'AIOManager',
    identity: 'aiomanager.example.com',
    credentials: { apiKey: 'key' },
    config: { manifestUrls: [] },
  });
  if (pushOnParentChange) {
    await LinkedAccountRepository.update(uuid, link.id, {
      pushOnParentChange: true,
    });
  }
  return link.id;
}

describe('LinkedAccountRepository.listPushOnParentChange', () => {
  before(async () => {
    await initDb(`sqlite://${path.join(dir, 'test.db')}`);
  });

  after(async () => {
    await closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lists only the opted-in links of the given configurations', async () => {
    const a1 = await addLink('a', true);
    await addLink('a', false);
    const b1 = await addLink('b', true);
    await addLink('c', true);

    const found = await LinkedAccountRepository.listPushOnParentChange([
      'a',
      'b',
    ]);
    assert.deepEqual(found, [
      { uuid: 'a', id: a1 },
      { uuid: 'b', id: b1 },
    ]);
    assert.deepEqual(
      await LinkedAccountRepository.listPushOnParentChange([]),
      []
    );
  });

  it('reports the flag, off for a new link', async () => {
    const id = await addLink('d', false);
    assert.equal(
      (await LinkedAccountRepository.get('d', id))?.pushOnParentChange,
      false
    );
    await LinkedAccountRepository.update('d', id, { pushOnParentChange: true });
    assert.equal(
      (await LinkedAccountRepository.get('d', id))?.pushOnParentChange,
      true
    );
  });
});
