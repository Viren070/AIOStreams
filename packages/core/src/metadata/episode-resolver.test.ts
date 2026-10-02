import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEpisodeFacts, SeasonRecord } from './episode-resolver.js';

const baseConfig = { enabled: true, episodeCountThreshold: 40, minSeasons: 4 };

function seasons(numbers: number[], episodeCount: number): SeasonRecord[] {
  return numbers.map((season_number) => ({
    season_number,
    episode_count: episodeCount,
  }));
}

describe('resolveEpisodeFacts: alternateSeasonNumber', () => {
  test('arriving as the real year resolves the ordinal position', async () => {
    const result = await resolveEpisodeFacts({
      season: 1940,
      episode: 1,
      isAnime: false,
      seasons: seasons([1940, 1950, 1960], 50),
      config: baseConfig,
    });
    assert.equal(result.alternateSeasonNumber, 1);
  });

  test('arriving as the ordinal position resolves the real year', async () => {
    const result = await resolveEpisodeFacts({
      season: 1,
      episode: 1,
      isAnime: false,
      seasons: seasons([1940, 1950, 1960], 50),
      config: baseConfig,
    });
    assert.equal(result.alternateSeasonNumber, 1940);
  });

  test('no alternate when real and ordinal already match', async () => {
    const result = await resolveEpisodeFacts({
      season: 5,
      episode: 1,
      isAnime: false,
      seasons: seasons([1, 2, 3, 4, 5, 6], 50),
      config: baseConfig,
    });
    assert.equal(result.alternateSeasonNumber, undefined);
  });

  test('no alternate for a non-year season list with a gap', async () => {
    const result = await resolveEpisodeFacts({
      season: 3,
      episode: 1,
      isAnime: false,
      seasons: seasons([1, 3], 50),
      config: baseConfig,
    });
    assert.equal(result.alternateSeasonNumber, undefined);
  });

  test('no alternate when no season data is available', async () => {
    const result = await resolveEpisodeFacts({
      season: 25,
      episode: 1,
      isAnime: false,
      config: baseConfig,
    });
    assert.equal(result.alternateSeasonNumber, undefined);
  });

  test('no alternate when the season is out of bounds for the known list', async () => {
    const result = await resolveEpisodeFacts({
      season: 4,
      episode: 1,
      isAnime: false,
      seasons: seasons([1940, 1950, 1960], 50),
      config: baseConfig,
    });
    assert.equal(result.alternateSeasonNumber, undefined);
  });
});

describe('resolveEpisodeFacts: fetchTvdbSeriesSeasons enrichment', () => {
  test('recovers an out-of-bounds ordinal once the missing season is filled in', async () => {
    const result = await resolveEpisodeFacts({
      season: 3,
      episode: 1,
      isAnime: false,
      seasons: seasons([1940, 1950], 50),
      fetchTvdbSeriesSeasons: async () => [1940, 1945, 1950],
      config: baseConfig,
    });
    assert.equal(result.resolvedSeasonNumber, 1950);
  });

  test('is not called for an ordinary non-year season list', async () => {
    let calls = 0;
    await resolveEpisodeFacts({
      season: 2,
      episode: 1,
      isAnime: false,
      seasons: seasons([1, 2, 3], 50),
      fetchTvdbSeriesSeasons: async () => {
        calls++;
        return [1, 2, 3];
      },
      config: baseConfig,
    });
    assert.equal(calls, 0);
  });
});

describe('resolveEpisodeFacts: isDateBased is symmetric across arrival forms', () => {
  test('arriving as the real year and as the ordinal position agree', async () => {
    const viaYear = await resolveEpisodeFacts({
      season: 2006,
      episode: 1,
      isAnime: false,
      genres: ['talk show'],
      seasons: seasons([2003, 2004, 2005, 2006], 50),
      config: baseConfig,
    });
    const viaOrdinal = await resolveEpisodeFacts({
      season: 4,
      episode: 1,
      isAnime: false,
      genres: ['talk show'],
      seasons: seasons([2003, 2004, 2005, 2006], 50),
      config: baseConfig,
    });
    assert.equal(viaYear.isDateBased, true);
    assert.equal(viaOrdinal.isDateBased, viaYear.isDateBased);
  });
});

describe('resolveEpisodeFacts: year-numbered seasons need a daily-sized episode count to count as date-based', () => {
  test('a year-numbered season with few episodes is not date-based', async () => {
    const result = await resolveEpisodeFacts({
      season: 1960,
      episode: 1,
      isAnime: false,
      seasons: seasons([1940, 1950, 1960], 10),
      config: baseConfig,
    });
    assert.equal(result.isDateBased, false);
  });

  test('a year-numbered season with a daily-sized episode count is date-based', async () => {
    const result = await resolveEpisodeFacts({
      season: 1960,
      episode: 1,
      isAnime: false,
      seasons: seasons([1940, 1950, 1960], 50),
      config: baseConfig,
    });
    assert.equal(result.isDateBased, true);
  });
});
