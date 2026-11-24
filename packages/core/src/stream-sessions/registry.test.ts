import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settingsStore, StreamRegistry } from '../index.js';
import { SettingsRepository } from '../db/repositories/settings.js';

test('snapshots follow the newest read that is still open', async (t) => {
  t.mock.method(SettingsRepository, 'getAll', async () => []);
  t.mock.method(SettingsRepository, 'getVersion', async () => 0);
  await settingsStore.initialise();
  const registry = new StreamRegistry();

  function openRead(start: number, bytes: number) {
    const opened = registry.open({
      transport: 'proxy',
      username: 'fixture-user',
      targetKey: 'fixture-stream',
      size: 1000,
      start,
    });
    assert.ok(opened.ok);
    opened.handle.addBytes(bytes);
    return opened.handle;
  }

  const progress = () =>
    registry
      .snapshot()
      .map(({ activeReads, start, currentBytes }) => [
        activeReads,
        start,
        currentBytes,
      ]);

  const first = openRead(10, 20);
  const middle = openRead(100, 30);
  const newest = openRead(900, 40);
  assert.deepEqual(progress(), [[3, 900, 40]]);

  first.close();
  assert.deepEqual(progress(), [[2, 900, 40]]);

  newest.close();
  assert.deepEqual(progress(), [[1, 100, 30]]);
  middle.addBytes(50);
  assert.deepEqual(progress(), [[1, 100, 80]]);

  middle.close();
  assert.deepEqual(progress(), [[0, 0, 0]]);
});
