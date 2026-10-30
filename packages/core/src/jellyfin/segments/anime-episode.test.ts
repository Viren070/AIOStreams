import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AnimeType, type AnimeEntry } from '../../anime-database/types.js';
import { entryEpisode, needsVideos, type ShowVideo } from './anime-episode.js';

function entry(overrides: Partial<AnimeEntry>): AnimeEntry {
  return {
    type: AnimeType.TV,
    tmdb: { seasonNumber: null, seasonId: null },
    tvdb: { seasonNumber: null, seasonId: null },
    ...overrides,
  };
}

/** Seasons of the given lengths, numbered from 1 in each. */
function videos(...lengths: number[]): ShowVideo[] {
  return lengths.flatMap((length, i) =>
    Array.from({ length }, (_, e) => ({ season: i + 1, episode: e + 1 }))
  );
}

// Shapes as the anime database returns them for these shows.
const aotS3Part2 = entry({
  imdb: { id: 'tt2560140', seasonNumber: 3, fromEpisode: 13 },
  tmdb: { seasonNumber: 3, seasonId: 126952, fromEpisode: 13 },
  tvdb: { seasonNumber: 3, seasonId: 1846517, fromEpisode: 13 },
});
const frierenS2 = entry({
  imdb: { id: 'tt22248376', seasonNumber: 2, fromEpisode: 1 },
  tmdb: { seasonNumber: 1, seasonId: null, fromEpisode: 29 },
  tvdb: { seasonNumber: 2, seasonId: null },
});
const onePiece = entry({
  imdb: {
    id: 'tt0388629',
    seasonNumber: 1,
    fromEpisode: 1,
    nonImdbEpisodes: [590],
  },
  tvdb: { seasonNumber: null, seasonId: 31893, absoluteOrder: true },
});

describe('entryEpisode', () => {
  test('restarts a split cour at its first episode', () => {
    assert.equal(entryEpisode(aotS3Part2, 'imdb', 'tt2560140', 3, 13), 1);
    assert.equal(entryEpisode(aotS3Part2, 'imdb', 'tt2560140', 3, 22), 10);
  });

  test("reads TMDB's continuous season through its own offset", () => {
    assert.equal(entryEpisode(frierenS2, 'imdb', 'tt22248376', 2, 1), 1);
    assert.equal(entryEpisode(frierenS2, 'tmdb', '209867', 1, 29), 1);
    assert.equal(entryEpisode(frierenS2, 'tmdb', '209867', 1, 38), 10);
  });

  test('refuses an episode before the entry starts', () => {
    assert.equal(entryEpisode(aotS3Part2, 'imdb', 'tt2560140', 3, 12), null);
    assert.equal(entryEpisode(frierenS2, 'tmdb', '209867', 1, 28), null);
  });

  test('refuses a later season the entry does not cover', () => {
    assert.equal(entryEpisode(aotS3Part2, 'imdb', 'tt2560140', 4, 1), null);
  });

  test('keeps the number for an anime id', () => {
    assert.equal(entryEpisode(aotS3Part2, 'mal', '38524', undefined, 7), 7);
    assert.equal(entryEpisode(aotS3Part2, 'kitsu', '41982', 1, 7), 7);
  });

  test('counts an absolute entry through earlier seasons', () => {
    const list = videos(10, 5, 4);
    assert.equal(entryEpisode(onePiece, 'imdb', 'tt0388629', 3, 2, list), 17);
    assert.equal(entryEpisode(onePiece, 'imdb', 'tt0388629', 1, 3, list), 3);
  });

  test('numbers past an episode IMDb never aired', () => {
    // 589 episodes before season 2, then IMDb skips the entry's 590.
    const list = videos(589, 400);
    assert.equal(
      entryEpisode(onePiece, 'imdb', 'tt0388629', 1, 589, list),
      589
    );
    assert.equal(entryEpisode(onePiece, 'imdb', 'tt0388629', 2, 1, list), 591);
    assert.equal(
      entryEpisode(onePiece, 'imdb', 'tt0388629', 2, 302, list),
      892
    );
  });

  test('refuses an absolute entry without its episode list', () => {
    assert.equal(entryEpisode(onePiece, 'imdb', 'tt0388629', 21, 1), null);
    assert.equal(
      entryEpisode(onePiece, 'imdb', 'tt0388629', 21, 1, videos(10)),
      null
    );
  });

  test('ignores specials and duplicates in the list', () => {
    const list = [
      { season: 0, episode: 1 },
      ...videos(3, 2),
      { season: 1, episode: 2 },
      { season: 2, episode: null },
    ];
    assert.equal(entryEpisode(onePiece, 'imdb', 'tt0388629', 2, 2, list), 5);
  });

  test('falls back to TVDB numbering when IMDb has no row', () => {
    const tvdbOnly = entry({
      tvdb: { seasonNumber: 2, seasonId: null, fromEpisode: 13 },
    });
    assert.equal(entryEpisode(tvdbOnly, 'imdb', 'tt0000001', 2, 14), 2);
    assert.equal(entryEpisode(entry({}), 'imdb', 'tt0000001', 1, 1), null);
  });

  test('says when the episode list is needed', () => {
    assert.equal(needsVideos(onePiece, 'imdb', 'tt0388629', 21), true);
    assert.equal(needsVideos(onePiece, 'imdb', 'tt0388629', 1), false);
    assert.equal(needsVideos(aotS3Part2, 'imdb', 'tt2560140', 4), false);
  });
});

describe('entryEpisode with another show', () => {
  test("takes no IMDb hint from another show's row", () => {
    // The entry's IMDb row is a sequel listed under its own id.
    assert.equal(entryEpisode(aotS3Part2, 'imdb', 'tt9999999', 3, 13), null);
    assert.equal(needsVideos(onePiece, 'imdb', 'tt9999999', 21), false);
  });
});
