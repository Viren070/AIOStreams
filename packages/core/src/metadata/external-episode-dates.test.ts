import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';
import { AnimeDatabase, IdParser } from '../utils/index.js';
import { DistributedLock } from '../utils/distributed-lock.js';
import { MetadataService } from './service.js';
import { TMDBMetadata } from './tmdb.js';
import { IMDBMetadata } from './imdb.js';
import { SkyhookMetadata } from './skyhook.js';

describe('metadata dates for externally numbered anime episodes', () => {
  for (const [providerDate, expectedDate] of [
    ['2026-09-12', '2026-09-12'],
    ['2024-02-29', '2024-02-29'],
    ['2026-09-12T23:30:00-04:00', '2026-09-13'],
    ['2026-09-12T12:00:00.000Z', '2026-09-12'],
    ['2026-02-30', undefined],
    ['2026-02-30T12:00:00Z', undefined],
    ['unknown', undefined],
    ['09/12/2026', undefined],
    ['2026-09-12T25:00:00Z', undefined],
  ] as const) {
    for (const tmdbAvailable of [true, false]) {
      it(`retains the requested episode date with TMDB available=${tmdbAvailable}, date=${providerDate}`, async (t) => {
        const keys = [
          'FETCH_TRAKT_ALIASES',
          'TITLE_CONFLICTS_ENABLED',
          'SCENE_MAPPINGS_ENABLED',
          'ID_MAPPINGS_ENABLED',
        ];
        for (const key of keys) {
          const previous = process.env[key];
          process.env[key] = 'false';
          t.after(() => {
            if (previous === undefined) delete process.env[key];
            else process.env[key] = previous;
          });
        }
        t.mock.method(SettingsRepository, 'getAll', async () => []);
        t.mock.method(SettingsRepository, 'getVersion', async () => 0);
        await settingsStore.initialise();
        t.mock.method(AnimeDatabase, 'getInstance', () => ({
          getEntryById: async () => ({
            title: 'Bleach Part 4',
            mappings: {
              imdbId: 'tt0434665',
              themoviedbId: 30984,
              thetvdbId: 74796,
            },
            tmdb: { seasonNumber: 2, fromEpisode: 41 },
            tvdb: { seasonNumber: 17, fromEpisode: 41 },
          }),
          hasSiblingRecords: async () => false,
        }));
        const cacheKeys: string[] = [];
        t.mock.method(DistributedLock, 'getInstance', () => ({
          withLock: async (key: string, fn: () => Promise<unknown>) => {
            cacheKeys.push(key);
            return { result: await fn(), cached: false };
          },
        }));
        const show = {
          title: 'Bleach',
          titles: [{ title: 'Bleach' }],
          year: 2004,
          releaseDate: '2004-10-05',
          tmdbId: 30984,
          tvdbId: 74796,
          seasons: [{ season_number: 17, episode_count: 50 }],
        };
        t.mock.method(TMDBMetadata.prototype, 'getMetadata', async () => ({
          ...show,
          tmdbId: '30984',
        }));
        t.mock.method(
          TMDBMetadata.prototype,
          'getNextEpisodeAirDate',
          async () => undefined
        );
        const details = t.mock.method(
          TMDBMetadata.prototype,
          'getEpisodeDetails',
          async (_id: number, season: number, episode: number) => {
            assert.equal(season, 2);
            assert.equal(episode, 48);
            return tmdbAvailable
              ? {
                  airDate: providerDate,
                  titles: [{ title: 'THE END TWO WORLD' }],
                }
              : undefined;
          }
        );
        t.mock.method(IMDBMetadata.prototype, 'getCinemetaData', async () => ({
          name: 'Bleach',
          year: 2004,
          released: '2004-10-05',
          videos: [],
        }));
        t.mock.method(
          IMDBMetadata.prototype,
          'getImdbSuggestionData',
          async () => show
        );
        t.mock.method(
          SkyhookMetadata.prototype,
          'getMetadata',
          async () => show
        );
        t.mock.method(SkyhookMetadata.prototype, 'getShow', async () => ({
          tvdbId: 74796,
          title: 'Bleach',
          episodes: [
            {
              seasonNumber: 17,
              episodeNumber: 48,
              title: 'THE END TWO WORLD',
              airDate: providerDate,
            },
          ],
        }));
        const result = await new MetadataService({
          tmdbApiKey: 'test',
        }).getMetadata(IdParser.parse('tt0434665:17:48', 'series')!, 'series');
        assert.equal(result.episodeAirDate, expectedDate);
        assert.equal(result.releaseDate, '2004-10-05');
        assert.ok(
          result.episodeTitles?.some((t) => t.title === 'THE END TWO WORLD')
        );
        assert.equal(details.mock.callCount(), 1);
        assert.ok(cacheKeys[0].endsWith(':external-episode-v1'));
      });
    }
  }
});
