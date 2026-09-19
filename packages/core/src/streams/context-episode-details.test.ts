import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AnimeDatabase, type AnimeEntry } from '../utils/index.js';
import { TMDBMetadata } from '../metadata/tmdb.js';
import type { UserData } from '../db/schemas.js';
import { settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';
import { StreamContext } from './context.js';

describe('TMDB episode details for enriched anime requests', () => {
  for (const fixture of [
    {
      name: 'Kitsu double offset across seasons',
      id: 'kitsu:49444:4',
      parentSeason: 17,
      parentOffset: 41,
      expected: 44,
    },
    {
      name: 'MAL double offset across seasons',
      id: 'mal:1:3',
      parentSeason: 17,
      parentOffset: 41,
      expected: 43,
    },
    {
      name: 'different offsets within the same season',
      id: 'kitsu:1:4',
      parentSeason: 2,
      parentOffset: 51,
      expected: 44,
    },
    {
      name: 'local episode above the offset',
      id: 'kitsu:1:50',
      parentSeason: 2,
      parentOffset: 1,
      expected: 90,
    },
    {
      name: 'explicit TMDB season stays in external coordinates',
      id: 'tmdb:1:2:44',
      parentSeason: 2,
      parentOffset: 41,
      expected: 44,
    },
    {
      name: 'IMDb already mapped episode stays unchanged',
      id: 'tt1:2:44',
      parentSeason: 2,
      parentOffset: 41,
      expected: 44,
    },
    {
      name: 'IMDb retains the existing cross-season fallback',
      id: 'tt1:17:4',
      parentSeason: 17,
      parentOffset: 41,
      expected: 44,
    },
  ]) {
    it(fixture.name, async (t) => {
      t.mock.method(SettingsRepository, 'getAll', async () => []);
      t.mock.method(SettingsRepository, 'getVersion', async () => 0);
      await settingsStore.initialise();
      const entry = {
        title: 'Example Anime',
        mappings: { kitsuId: 1 },
        imdb: {
          seasonNumber: fixture.parentSeason,
          fromEpisode: fixture.parentOffset,
        },
        tmdb: { seasonNumber: 2, fromEpisode: 41 },
      } as AnimeEntry;
      t.mock.method(AnimeDatabase, 'getInstance', () => ({
        getEntryById: async () => entry,
      }));
      t.mock.method(StreamContext.prototype, 'getMetadata', async () => ({
        tmdbId: 123,
      }));
      const details = t.mock.method(
        TMDBMetadata.prototype,
        'getEpisodeDetails',
        async () => ({ airDate: '2026-01-01', runtime: 24 })
      );
      const context = await StreamContext.create('series', fixture.id, {
        tmdbApiKey: 'test',
      } as UserData);
      assert.equal(await context.getEpisodeAirDate(), '2026-01-01');
      assert.equal(await context.getEpisodeRuntime(), 24);
      assert.equal(details.mock.callCount(), 1);
      assert.deepEqual(details.mock.calls[0].arguments, [
        123,
        2,
        fixture.expected,
      ]);
    });
  }
});
