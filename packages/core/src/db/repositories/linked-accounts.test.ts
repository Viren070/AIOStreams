import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Load the core entry point first; the db modules and the logger import each other.
import '../../index.js';
import { closeDb, getDb, initDb } from '../db.js';
import { sql } from '../sql.js';
import { ConfigParentRepository } from './config-parents.js';
import { LinkedAccountRepository } from './linked-accounts.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linked-accounts-'));

async function addUser(uuid: string, parent?: string) {
  await getDb().exec(
    sql`INSERT INTO users (uuid, password_hash, config, config_salt)
        VALUES (${uuid}, 'hash', 'config', 'salt')`
  );
  await getDb().tx((tx) => ConfigParentRepository.set(tx, uuid, parent));
}

async function addLink(uuid: string, pushOnParentChange: boolean) {
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

describe('LinkedAccountRepository', () => {
  before(async () => {
    await initDb(`sqlite://${path.join(dir, 'test.db')}`);
  });

  after(async () => {
    await closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await getDb().exec(sql`DELETE FROM users`);
  });

  it('lists the opted-in links of descendants only', async () => {
    await addUser('p');
    await addUser('a', 'p');
    await addUser('b', 'a');
    await addUser('c');
    await addLink('p', true);
    const a1 = await addLink('a', true);
    await addLink('a', false);
    const b1 = await addLink('b', true);
    await addLink('c', true);

    const found = await LinkedAccountRepository.listForParentChange('p', 5, 10);
    assert.deepEqual(found.map((link) => link.id).sort(), [a1, b1].sort());
    assert.deepEqual(
      await LinkedAccountRepository.listForParentChange('c', 5, 10),
      []
    );
  });

  it('lists the least recently checked links first, up to the limit', async () => {
    await addUser('p');
    await addUser('a', 'p');
    const first = await addLink('a', true);
    const second = await addLink('a', true);
    const third = await addLink('a', true);
    await LinkedAccountRepository.markChecked('a', first);

    const found = await LinkedAccountRepository.listForParentChange('p', 5, 2);
    assert.deepEqual(
      found.map((link) => link.id).sort(),
      [second, third].sort()
    );
  });

  it('lists direct children before deeper descendants', async () => {
    await addUser('p');
    await addUser('a', 'p');
    await addUser('b', 'a');
    const grandchild = await addLink('b', true);
    const child = await addLink('a', true);
    await LinkedAccountRepository.markChecked('a', child);

    const found = await LinkedAccountRepository.listForParentChange('p', 5, 1);
    assert.deepEqual(
      found.map((link) => link.id),
      [child]
    );
    assert.notEqual(grandchild, child);
  });

  it('counts the manifests a push of the link fetches', async () => {
    await addUser('p');
    await addUser('a', 'p');
    const id = await addLink('a', true);
    await LinkedAccountRepository.update('a', id, {
      config: { manifestUrls: ['u1', 'u2'] },
    });
    const [found] = await LinkedAccountRepository.listForParentChange(
      'p',
      5,
      1
    );
    assert.equal(found.urls, 2);
  });

  it('reports the flag, off for a new link', async () => {
    await addUser('d');
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
