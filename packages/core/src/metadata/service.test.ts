import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';
import { AnimeDatabase, IdParser } from '../utils/index.js';
import { DistributedLock } from '../utils/distributed-lock.js';
import { MetadataService } from './service.js';
import { TMDBMetadata } from './tmdb.js';

describe('MetadataService sibling alias suppression', () => {
  for (const fixture of [
    {
      name: 'uses a shared mapped ID for a unique Kitsu request',
      enabled: true,
      rejectOriginal: false,
      mappedSibling: true,
      suppress: true,
    },
    {
      name: 'keeps successful sibling detection when another lookup rejects',
      enabled: true,
      rejectOriginal: true,
      mappedSibling: true,
      suppress: true,
    },
    {
      name: 'continues metadata resolution when the mapped lookup rejects',
      enabled: true,
      rejectOriginal: false,
      mappedSibling: 'reject',
      suppress: false,
    },
    {
      name: 'does not suppress or look up siblings when disabled',
      enabled: false,
      rejectOriginal: false,
      mappedSibling: true,
      suppress: false,
    },
  ]) {
    it(fixture.name, async (t) => {
      const previous = process.env.ANIME_DB_SUPPRESS_SIBLING_ALIASES;
      t.after(() => {
        if (previous === undefined)
          delete process.env.ANIME_DB_SUPPRESS_SIBLING_ALIASES;
        else process.env.ANIME_DB_SUPPRESS_SIBLING_ALIASES = previous;
      });
      process.env.ANIME_DB_SUPPRESS_SIBLING_ALIASES = String(fixture.enabled);
      t.mock.method(SettingsRepository, 'getAll', async () => []);
      t.mock.method(SettingsRepository, 'getVersion', async () => 0);
      await settingsStore.initialise();
      const lookups: string[] = [];
      t.mock.method(AnimeDatabase, 'getInstance', () => ({
        getEntryById: async () => ({
          title: 'Example Anime',
          synonyms: ['Alias Alpha', 'Alias Beta', 'Alias Gamma', 'Alias Delta'],
          animeSeason: { year: 2020 },
          mappings: { themoviedbId: 123 },
          tmdb: { seasonNumber: null, seasonId: null },
          tvdb: { seasonNumber: null, seasonId: null },
        }),
        hasSiblingRecords: async (idType: string) => {
          lookups.push(idType);
          if (idType === 'kitsuId' && fixture.rejectOriginal)
            throw new Error('request lookup failed');
          if (idType === 'themoviedbId') {
            if (fixture.mappedSibling === 'reject')
              throw new Error('mapped lookup failed');
            return fixture.mappedSibling;
          }
          return false;
        },
      }));
      t.mock.method(DistributedLock, 'getInstance', () => ({
        withLock: async (_key: string, fn: () => Promise<unknown>) => ({
          result: await fn(),
          cached: false,
        }),
      }));
      t.mock.method(TMDBMetadata.prototype, 'getMetadata', async () => ({
        title: 'Example Anime',
        titles: [{ title: 'Unrelated Later Cour' }],
        tmdbId: '123',
        year: 2020,
      }));
      const id = IdParser.parse('kitsu:1', 'movie');
      assert.ok(id);
      const metadata = await new MetadataService({
        tmdbApiKey: 'test',
      }).getMetadata(id, 'movie');
      assert.equal(metadata.title, 'Example Anime');
      assert.equal(
        metadata.titles.some((t) => t.title === 'Unrelated Later Cour'),
        !fixture.suppress
      );
      assert.deepEqual(
        lookups,
        fixture.enabled ? ['kitsuId', 'themoviedbId'] : []
      );
    });
  }
});
