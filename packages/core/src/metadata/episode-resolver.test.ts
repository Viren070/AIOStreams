import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  resolveEpisodeFacts,
  type EpisodeResolverInput,
} from './episode-resolver.js';

const base: EpisodeResolverInput = {
  season: 2026,
  episode: 1,
  isAnime: false,
  config: { enabled: true, episodeCountThreshold: 100, minSeasons: 2 },
};

for (const provider of ['TVDB', 'TMDB', 'ordinal TVDB'] as const) {
  for (const date of [
    'unknown',
    '',
    '2026-02-30',
    '2026-13-01',
    '2026-9-01',
    '2026-09-01T00:00:00Z',
    '2026-09-01',
    '2024-02-29',
  ]) {
    test(`${provider} validates episode air date ${JSON.stringify(date)}`, async () => {
      const input: EpisodeResolverInput = { ...base };
      if (provider === 'TMDB') {
        input.fetchTmdbEpisode = async () => ({ airDate: date });
      } else if (provider === 'ordinal TVDB') {
        input.season = 1;
        input.genres = ['news'];
        input.seasons = [{ season_number: 2026, episode_count: 200 }];
        input.fetchTvdbSeasonEpisodes = async (season) =>
          season === 2026 ? [{ number: 1, aired: date }] : undefined;
      } else {
        input.fetchTvdbSeasonEpisodes = async () => [
          { number: 1, aired: date },
        ];
      }
      const result = await resolveEpisodeFacts(input);
      assert.equal(result.isDateBased, true);
      assert.deepEqual(
        result.episodeAirDates,
        ['2026-09-01', '2024-02-29'].includes(date) ? [date] : undefined
      );
    });
  }
}

test('invalid direct date does not enable an unrelated ordinal fallback', async () => {
  const calls: number[] = [];
  const result = await resolveEpisodeFacts({
    ...base,
    season: 1,
    genres: ['news'],
    seasons: [{ season_number: 2026, episode_count: 200 }],
    fetchTvdbSeasonEpisodes: async (season) => {
      calls.push(season);
      return [{ number: 1, aired: season === 1 ? 'unknown' : '2026-09-01' }];
    },
  });
  assert.deepEqual(calls, [1]);
  assert.equal(result.episodeAirDates, undefined);
});
