import { describe, test, mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { settingsStore } from '../../config/index.js';
import { SettingsRepository } from '../../db/repositories/settings.js';
import { AnimeDatabase } from '../../anime-database/index.js';
import { AnimeType, type AnimeEntry } from '../../anime-database/types.js';
import { IdMappingDataset } from '../../metadata/id-mappings.js';
import { IMDBMetadata } from '../../metadata/imdb.js';
import { fillIds } from './index.js';
import type { SegmentLookup } from './types.js';

// One Piece on IMDb: one MAL entry counted on through every IMDb season.
const onePiece: AnimeEntry = {
  type: AnimeType.TV,
  mappings: { malId: 21, imdbId: 'tt0388629' },
  imdb: { id: 'tt0388629', seasonNumber: 1, fromEpisode: 1 },
  tmdb: { seasonNumber: null, seasonId: null },
  tvdb: { seasonNumber: null, seasonId: 31893, absoluteOrder: true },
} as AnimeEntry;

async function stub(
  t: TestContext,
  entry: () => Promise<AnimeEntry | null>,
  videos: () => Promise<unknown>
) {
  mock.method(SettingsRepository, 'getAll', async () => []);
  mock.method(SettingsRepository, 'getVersion', async () => 0);
  await settingsStore.initialise();
  const dataset = IdMappingDataset.getInstance();
  t.mock.method(dataset, 'resolve', () => ({}));
  const database = AnimeDatabase.getInstance();
  t.mock.method(database, 'getEntryById', entry);
  t.mock.method(IMDBMetadata.prototype, 'getCinemetaData', videos);
}

function s21e1(): SegmentLookup {
  return {
    kind: 'episode',
    ids: { imdb: 'tt0388629' },
    season: 21,
    episode: 1,
  };
}

describe('fillIds', () => {
  test("counts through Cinemeta's list only for the providers that wait", async (t) => {
    let fetched = 0;
    await stub(
      t,
      async () => onePiece,
      async () => {
        fetched++;
        return {
          videos: [
            { season: 1, episode: 1 },
            { season: 1, episode: 2 },
            { season: 21, episode: 1 },
          ],
        };
      }
    );
    const lookup = s21e1();
    const resolution = await fillIds(lookup, ['aniskip', 'introdb']);
    assert.equal(lookup.ids.mal, '21');
    await resolution.animeEpisode;
    assert.equal(fetched, 1);
    assert.equal(lookup.animeEpisode, 3);
    assert.equal(resolution.animeEpisodeFailed, false);
  });

  test('a failed episode list is not a miss', async (t) => {
    await stub(
      t,
      async () => onePiece,
      async () => {
        throw new Error('timeout');
      }
    );
    const lookup = s21e1();
    const resolution = await fillIds(lookup, ['aniskip']);
    await resolution.animeEpisode;
    assert.equal(lookup.animeEpisode, undefined);
    assert.equal(resolution.animeEpisodeFailed, true);
    assert.equal(resolution.idsFailed, false);
  });

  test('a failed anime database lookup is not a miss', async (t) => {
    await stub(
      t,
      async () => {
        throw new Error('db down');
      },
      async () => ({ videos: [] })
    );
    const lookup = s21e1();
    const resolution = await fillIds(lookup, ['aniskip']);
    assert.equal(lookup.ids.mal, undefined);
    assert.equal(resolution.idsFailed, true);
  });

  test('a database without the entry is a miss', async (t) => {
    await stub(
      t,
      async () => null,
      async () => ({ videos: [] })
    );
    const lookup = s21e1();
    const resolution = await fillIds(lookup, ['aniskip']);
    await resolution.animeEpisode;
    assert.equal(resolution.idsFailed, false);
    assert.equal(resolution.animeEpisodeFailed, false);
  });
});
