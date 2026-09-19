import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

vi.mock('../logging/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn() }),
}));
import { buildAnimeEntry } from './builder.js';
import { filterCandidatesBySeasonType, selectBestRecord } from './selector.js';
import { AnimeType, type AnimeRecord, type IdValue } from './types.js';
import type { IdType } from '../utils/id-parser.js';

// Kitsu maps the original LOGH to IMDb season 1 onward and both Gaiden
// entries to specials. Other providers give Gaiden its own seasons 1 and 2.
const original: AnimeRecord = {
  rid: 0,
  type: AnimeType.OVA,
  ids: {
    imdbId: 'tt0096633',
    kitsuId: 727,
    themoviedbId: 27660,
    thetvdbId: 81618,
  },
  imdb: { fromSeason: 1, fromEpisode: 1 },
  tvdb: { seasonNumber: 'a' },
  trakt: { seasonNumber: 1 },
};
const gaiden = (
  rid: number,
  season: number,
  fromEpisode: number
): AnimeRecord => ({
  rid,
  type: AnimeType.OVA,
  ids: { imdbId: 'tt0096633', themoviedbId: 68312, thetvdbId: 268996 },
  imdb: { fromSeason: 0, fromEpisode },
  tvdb: { seasonNumber: season },
  tmdb: { seasonNumber: season },
  trakt: { seasonNumber: season },
});
const records = [original, gaiden(1, 1, 4), gaiden(2, 2, 28)];

function lookup(
  candidates: AnimeRecord[],
  season: number,
  episode = 1,
  idType: IdType = 'imdbId',
  idValue: IdValue = 'tt0096633'
) {
  return selectBestRecord(
    filterCandidatesBySeasonType(candidates, season, idType),
    idType,
    idValue,
    season,
    episode
  );
}

describe('anime candidate type filtering with IMDb season mappings', () => {
  for (const season of [1, 2, 3, 4]) {
    it(`keeps the original OVA provider IDs for LOGH S${season}E05`, () => {
      const chosen = lookup(records, season, 5);
      assert.equal(chosen, original);
      const entry = buildAnimeEntry(chosen!);
      assert.equal(entry.mappings.themoviedbId, 27660);
      assert.equal(entry.mappings.thetvdbId, 81618);
    });
  }

  it('still selects each Gaiden entry for its mapped IMDb specials', () => {
    assert.equal(lookup(records, 0, 4), records[1]);
    assert.equal(lookup(records, 0, 28), records[2]);
  });

  for (const type of [AnimeType.OVA, AnimeType.ONA, AnimeType.SPECIAL]) {
    it(`preserves a mapped ${type} spanning later IMDb seasons without using its title`, () => {
      const main: AnimeRecord = {
        rid: 10,
        type,
        ids: {},
        imdb: { fromSeason: 1 },
        tvdb: { seasonNumber: 1 },
      };
      const extra: AnimeRecord = {
        rid: 11,
        type: AnimeType.OVA,
        ids: {},
        imdb: { fromSeason: 0 },
        tvdb: { seasonNumber: 2 },
      };
      assert.equal(lookup([main, extra], 3), main);
      assert.equal(lookup([extra, main], 3), main);
    });
  }

  it('lets the scorer select a later mapped cour and respect its episode start', () => {
    const first: AnimeRecord = {
      rid: 10,
      type: AnimeType.ONA,
      ids: {},
      imdb: { fromSeason: 2, fromEpisode: 1 },
    };
    const second: AnimeRecord = {
      rid: 11,
      type: AnimeType.ONA,
      ids: {},
      imdb: { fromSeason: 2, fromEpisode: 13 },
    };
    const tv: AnimeRecord = {
      rid: 12,
      type: AnimeType.TV,
      ids: {},
      tvdb: { seasonNumber: 2 },
    };
    assert.equal(lookup([first, second, tv], 2, 12), first);
    assert.equal(lookup([first, second, tv], 2, 13), second);
  });

  it('does not use IMDb season ranges to override TVDB coordinates', () => {
    const main = {
      ...original,
      ids: { ...original.ids, thetvdbId: 268996 },
      tvdb: { seasonNumber: 1 },
    };
    assert.equal(
      lookup([main, records[2]], 2, 5, 'thetvdbId', 268996),
      records[2]
    );
  });

  it('preserves legacy type filtering when idType is omitted', () => {
    // Without IMDb coordinates, only Gaiden's advertised season 2 survives.
    assert.deepEqual(filterCandidatesBySeasonType(records, 2), [records[2]]);
    assert.deepEqual(filterCandidatesBySeasonType(records, 2, 'imdbId'), [
      original,
      records[2],
    ]);
  });

  it('does not retain a later IMDb cour solely for its mapping when requesting season 1', () => {
    const current: AnimeRecord = {
      rid: 30,
      type: AnimeType.TV,
      ids: {},
      imdb: { fromSeason: 1 },
    };
    const later: AnimeRecord = {
      rid: 31,
      type: AnimeType.ONA,
      ids: {},
      imdb: { fromSeason: 2 },
    };
    // No secondary-provider hints retain `later`, and `current` prevents the
    // existing empty-filter fallback from restoring all candidates.
    assert.deepEqual(
      filterCandidatesBySeasonType([current, later], 1, 'imdbId'),
      [current]
    );
    assert.equal(lookup([later, current], 1), current);
  });

  it('retains movie-only lookup and regular TV selection', () => {
    const movie: AnimeRecord = { rid: 20, type: AnimeType.MOVIE, ids: {} };
    const tv: AnimeRecord = {
      rid: 21,
      type: AnimeType.TV,
      ids: {},
      imdb: { fromSeason: 1 },
    };
    assert.deepEqual(
      filterCandidatesBySeasonType([movie, tv], undefined, 'imdbId'),
      [movie]
    );
    assert.equal(lookup([movie, tv], 3), tv);
  });
});
