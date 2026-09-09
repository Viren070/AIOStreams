import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StreamContext } from './context.js';
import StreamFilterer from './filterer.js';
import { AnimeDatabase, type AnimeEntry } from '../utils/index.js';
import { MetadataService } from '../metadata/service.js';
import { settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';
import type { ParsedStream, UserData } from '../db/schemas.js';

const entry = {
  title: 'Example Anime',
  synonyms: ['Known Alias'],
  mappings: { kitsuId: 1 },
  imdb: { seasonNumber: 2, fromEpisode: 41 },
} as AnimeEntry;

describe('entry-relative request coordinates', () => {
  for (const [id, localEpisode, enrichedEpisode] of [
    ['kitsu:1:4', 4, '44'],
    ['mal:1:4', 4, '44'],
    ['kitsu:1:0', 0, '40'],
    ['mal:1:0', 0, '40'],
  ] as const) {
    it(`preserves the local episode through enrichment for ${id}`, async (t) => {
      t.mock.method(SettingsRepository, 'getAll', async () => []);
      t.mock.method(SettingsRepository, 'getVersion', async () => 0);
      await settingsStore.initialise();
      t.mock.method(AnimeDatabase, 'getInstance', () => ({
        getEntryById: async () => entry,
      }));
      t.mock.method(MetadataService.prototype, 'getMetadata', async () => ({
        title: entry.title,
        titles: [{ title: entry.title }],
      }));
      const context = await StreamContext.create('series', id, {} as UserData);
      assert.equal(context.animeEpisode, localEpisode);
      assert.equal(context.parsedId?.episode, enrichedEpisode);
      assert.equal(
        (await context.getMetadata())?.relativeAbsoluteEpisode,
        localEpisode
      );
    });
  }
  it('does not invent a local coordinate for an IMDb request', async (t) => {
    t.mock.method(AnimeDatabase, 'getInstance', () => ({
      getEntryById: async () => entry,
    }));
    const context = await StreamContext.create(
      'series',
      'tt1:2:44',
      {} as UserData
    );
    assert.equal(context.animeEpisode, undefined);
  });
});

describe('entry-relative strict filtering', () => {
  for (const fixture of [
    {
      name: 'zero local episode',
      episode: 0,
      filename: 'Example Anime 00.mkv',
      keep: true,
    },
    {
      name: 'bare local episode',
      episode: 4,
      filename: 'Example Anime 04.mkv',
      keep: true,
    },
    {
      name: 'fractional episode',
      episode: 1.5,
      filename: 'Example Anime 1.5.mkv',
      keep: true,
    },
    {
      name: 'fractional episode with version',
      episode: 1.5,
      filename: 'Example Anime 1.5v2.mkv',
      keep: true,
    },
    {
      name: 'integer lookalike',
      episode: 1.5,
      filename: 'Example Anime 105.mkv',
      keep: false,
    },
    {
      name: 'wrong local episode',
      episode: 4,
      filename: 'Example Anime 05.mkv',
      keep: false,
    },
    {
      name: 'wrong anime entry',
      episode: 4,
      filename: 'Other Anime 04.mkv',
      keep: false,
    },
    {
      name: 'wrapped folder and filename',
      episode: 4,
      folderName: 'Known Alias',
      filename: '04.mkv',
      keep: true,
    },
  ]) {
    it(fixture.name, async (t) => {
      t.mock.method(SettingsRepository, 'getAll', async () => []);
      t.mock.method(SettingsRepository, 'getVersion', async () => 0);
      await settingsStore.initialise();
      t.mock.method(AnimeDatabase, 'getInstance', () => ({
        getEntryById: async () => entry,
      }));
      const userData = {
        seasonEpisodeMatching: { enabled: true, strict: true },
        titleMatching: { enabled: true, mode: 'exact' },
      } as UserData;
      const context = await StreamContext.create(
        'series',
        'kitsu:1:4',
        userData
      );
      // Fractional release matching is also used with externally supplied coordinates.
      Object.defineProperty(context, 'animeEpisode', {
        value: fixture.episode,
      });
      t.mock.method(context, 'getMetadata', async () => ({
        title: 'Example Anime',
        titles: [{ title: 'Example Anime' }, { title: 'Known Alias' }],
        relativeAbsoluteEpisode: fixture.episode,
      }));
      t.mock.method(context, 'getReleaseDates', async () => undefined);
      t.mock.method(context, 'getEpisodeAirDate', async () => undefined);
      t.mock.method(context, 'getEpisodeRuntime', async () => undefined);
      const stream = {
        id: 'test',
        type: 'p2p',
        filename: fixture.filename,
        folderName: fixture.folderName,
        addon: { name: 'Test', preset: { id: 'test' } },
        parsedFile: {
          title: fixture.filename.replace(/\.mkv$/, ''),
          audioChannels: [],
          visualTags: [],
          audioTags: [],
          languages: [],
          subtitles: [],
        },
      } as ParsedStream;
      const result = await new StreamFilterer(userData).filter(
        [stream],
        context
      );
      assert.equal(result.length, fixture.keep ? 1 : 0);
    });
  }
});
