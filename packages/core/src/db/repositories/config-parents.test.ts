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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-parents-'));

async function addUser(uuid: string): Promise<void> {
  await getDb().exec(
    sql`INSERT INTO users (uuid, password_hash, config, config_salt)
        VALUES (${uuid}, 'hash', 'config', 'salt')`
  );
}

async function link(child: string, parent: string | undefined) {
  await getDb().tx((tx) => ConfigParentRepository.set(tx, child, parent));
}

describe('ConfigParentRepository', () => {
  before(async () => {
    await initDb(`sqlite://${path.join(dir, 'test.db')}`);
  });

  after(async () => {
    await closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await getDb().exec(sql`DELETE FROM users`);
    for (const uuid of ['p', 'a', 'b', 'c', 'd']) await addUser(uuid);
  });

  it('finds direct children', async () => {
    await link('a', 'p');
    await link('b', 'p');
    assert.deepEqual(await ConfigParentRepository.descendants('p', 5), [
      'a',
      'b',
    ]);
  });

  it('finds children of children, down to the depth limit', async () => {
    await link('a', 'p');
    await link('b', 'a');
    await link('c', 'b');
    assert.deepEqual(await ConfigParentRepository.descendants('p', 5), [
      'a',
      'b',
      'c',
    ]);
    assert.deepEqual(await ConfigParentRepository.descendants('p', 2), [
      'a',
      'b',
    ]);
  });

  it('replaces a parent instead of adding a second one', async () => {
    await link('a', 'p');
    await link('a', 'd');
    assert.deepEqual(await ConfigParentRepository.descendants('p', 5), []);
    assert.deepEqual(await ConfigParentRepository.descendants('d', 5), ['a']);
  });

  it('forgets a parent that was removed', async () => {
    await link('a', 'p');
    await link('a', undefined);
    assert.deepEqual(await ConfigParentRepository.descendants('p', 5), []);
  });

  it('stops at a chain that loops back', async () => {
    await link('a', 'p');
    await link('b', 'a');
    await link('p', 'b');
    assert.deepEqual(await ConfigParentRepository.descendants('p', 5), [
      'a',
      'b',
    ]);
  });

  it('indexes a configuration that was saved before the index existed', async () => {
    await ConfigParentRepository.ensure('a', 'p');
    assert.deepEqual(await ConfigParentRepository.descendants('p', 5), ['a']);
    await ConfigParentRepository.ensure('a', 'd');
    assert.deepEqual(await ConfigParentRepository.descendants('p', 5), []);
    assert.deepEqual(await ConfigParentRepository.descendants('d', 5), ['a']);
  });

  it('drops the row when the child is deleted', async () => {
    await link('a', 'p');
    await getDb().exec(sql`DELETE FROM users WHERE uuid = 'a'`);
    assert.deepEqual(await ConfigParentRepository.descendants('p', 5), []);
  });
});
