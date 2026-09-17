import '../streams/filterer.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TVDBMetadata } from './tvdb.js';
import { settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';
import { conflictEpisodeBound } from '../streams/title-conflict-episodes.js';

const page = (
  id: number,
  episodes: unknown[],
  next: string | null,
  total: number
) => ({
  status: 'success',
  data: { series: { id, name: 'Example' }, episodes },
  links: { next, total_items: total },
});

describe('authenticated competitor episode catalogs', () => {
  it('fetches every page, validates the response and caches the complete catalog', async (t) => {
    t.mock.method(SettingsRepository, 'getAll', async () => []);
    t.mock.method(SettingsRepository, 'getVersion', async () => 0);
    await settingsStore.initialise();
    const client = new TVDBMetadata({ apiKey: 'test' });
    t.mock.method(client as any, 'ensureToken', async () => {});
    const calls: string[] = [];
    t.mock.method(
      (client as any).api,
      'request',
      async (endpoint: string, options: any) => {
        calls.push(endpoint);
        return options.schema.parse(
          page(
            98765001,
            [{ seasonNumber: 1, number: calls.length, absoluteNumber: 0 }],
            calls.length === 1 ? '?page=1' : null,
            2
          )
        );
      }
    );
    const catalog = await client.getEpisodeCatalog(98765001);
    assert.equal(conflictEpisodeBound(catalog!), 2);
    assert.equal(catalog?.episodes[0].absoluteEpisodeNumber, undefined);
    assert.deepEqual(calls, [
      '/series/98765001/episodes/default?page=0',
      '/series/98765001/episodes/default?page=1',
    ]);
    assert.deepEqual(await client.getEpisodeCatalog(98765001), catalog);
    assert.equal(calls.length, 2);
  });

  for (const failure of [
    'network',
    'wrong-id',
    'malformed',
    'empty-page',
    'page-limit',
    'count-mismatch',
  ]) {
    it(`does not return or cache a partial catalog after ${failure}`, async (t) => {
      t.mock.method(SettingsRepository, 'getAll', async () => []);
      t.mock.method(SettingsRepository, 'getVersion', async () => 0);
      await settingsStore.initialise();
      const client = new TVDBMetadata({ apiKey: 'test' });
      t.mock.method(client as any, 'ensureToken', async () => {});
      const id =
        98765100 +
        [
          'network',
          'wrong-id',
          'malformed',
          'empty-page',
          'page-limit',
          'count-mismatch',
        ].indexOf(failure);
      let calls = 0;
      let recovered = false;
      t.mock.method(
        (client as any).api,
        'request',
        async (_endpoint: string, options: any) => {
          calls++;
          if (recovered)
            return options.schema.parse(
              page(id, [{ seasonNumber: 1, number: 1 }], null, 1)
            );
          if (calls === 1)
            return options.schema.parse(
              page(id, [{ seasonNumber: 1, number: 1 }], '?page=1', 2)
            );
          if (failure === 'network') throw new Error('offline');
          return options.schema.parse(
            page(
              failure === 'wrong-id' ? id + 1 : id,
              failure === 'empty-page'
                ? []
                : [
                    {
                      seasonNumber: 1,
                      number: failure === 'malformed' ? undefined : calls,
                    },
                  ],
              failure === 'page-limit' || failure === 'empty-page'
                ? '?page=2'
                : null,
              failure === 'count-mismatch' ? 99 : 2
            )
          );
        }
      );
      assert.equal(await client.getEpisodeCatalog(id), undefined);
      assert.ok(calls <= 10);
      recovered = true;
      assert.equal(
        conflictEpisodeBound((await client.getEpisodeCatalog(id))!),
        1,
        'failed lookups do not poison the cache'
      );
    });
  }
});
