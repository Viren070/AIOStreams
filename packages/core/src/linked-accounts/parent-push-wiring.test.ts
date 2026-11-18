import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Load the core entry point first; the config, db and service modules import each other.
import '../index.js';
import { initialiseConfig } from '../config/index.js';
import { closeDb, getDb, initDb } from '../db/db.js';
import { sql } from '../db/sql.js';
import { LinkedAccountRepository } from '../db/repositories/linked-accounts.js';
import { UserRepository, userConfigBus } from '../db/repositories/users.js';
import type { UserData } from '../db/schemas.js';
import { constants } from '../utils/index.js';

// The smallest configuration the save path accepts.
const base = (): UserData =>
  ({
    sortCriteria: { global: [] },
    formatter: { id: constants.FORMATTERS[0] },
    presets: [],
  }) as unknown as UserData;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parent-push-wiring-'));

async function targetsOf(parent: string): Promise<string[]> {
  const found = await LinkedAccountRepository.listForParentChange(
    parent,
    5,
    10
  );
  return found.map((link) => link.uuid);
}

/** `getUser` indexes in the background; give it a moment to land. */
async function eventually(check: () => Promise<boolean>): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

describe('parent change push wiring', () => {
  let parent: string;
  let child: string;

  before(async () => {
    await initDb(`sqlite://${path.join(dir, 'test.db')}`);
    await initialiseConfig();
    parent = (await UserRepository.createUser(base(), 'parent-pw')).uuid;
    child = (
      await UserRepository.createUser(
        { ...base(), parentConfig: { uuid: parent, password: 'parent-pw' } },
        'child-pw'
      )
    ).uuid;
    const link = await LinkedAccountRepository.create({
      uuid: child,
      platform: 'aiomanager',
      label: 'AIOManager',
      identity: 'manager',
      credentials: { apiKey: 'key' },
      config: { manifestUrls: [] },
    });
    await LinkedAccountRepository.update(child, link.id, {
      pushOnParentChange: true,
    });
  });

  after(async () => {
    await closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('indexes a child created with a parent', async () => {
    assert.deepEqual(await targetsOf(parent), [child]);
  });

  it('announces a committed save of the parent', async () => {
    const saved: string[] = [];
    const listener = (uuid: string) => saved.push(uuid);
    userConfigBus.on('saved', listener);
    try {
      await UserRepository.updateUser(parent, 'parent-pw', base());
    } finally {
      userConfigBus.off('saved', listener);
    }
    assert.deepEqual(saved, [parent]);
  });

  it('indexes, on read, a child saved before the index existed', async () => {
    await getDb().exec(sql`DELETE FROM config_parents`);
    assert.deepEqual(await targetsOf(parent), []);
    await UserRepository.getUser(child, 'child-pw');
    assert.ok(
      await eventually(async () => (await targetsOf(parent)).length === 1)
    );
  });

  it('forgets the parent once the child stops inheriting', async () => {
    await UserRepository.updateUser(child, 'child-pw', base());
    assert.deepEqual(await targetsOf(parent), []);
  });
});
