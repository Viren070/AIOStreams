import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEpisodeFacts } from './episode-resolver.js';

test('maps a TMDB episode title to its differently-numbered TVDB episode', async () => {
  const episodes = new Map([
    [11, [{ number: 5, aired: '2024-01-01', name: 'A Different Episode' }]],
    [14, [{ number: 5, aired: '2024-01-01', name: "Related to Items You've Viewed" }]],
  ]);

  const resolution = await resolveEpisodeFacts({
    season: 11,
    episode: 5,
    isAnime: false,
    seasons: [
      { season_number: 11, episode_count: 10 },
      { season_number: 14, episode_count: 10 },
    ],
    fetchTmdbEpisode: async () => ({
      airDate: '2024-01-01',
      titles: [{ title: 'Related to Items Youve Viewed!' }],
    }),
    fetchTvdbSeasonEpisodes: async (season) => episodes.get(season),
    config: { enabled: true, episodeCountThreshold: 100, minSeasons: 3 },
  });

  assert.equal(resolution.resolvedSeasonNumber, 14);
  assert.equal(resolution.resolvedEpisodeNumber, 5);
});

test('does not remap when the direct TVDB episode title already agrees', async () => {
  const resolution = await resolveEpisodeFacts({
    season: 11,
    episode: 5,
    isAnime: false,
    seasons: [
      { season_number: 11, episode_count: 10 },
      { season_number: 14, episode_count: 10 },
    ],
    fetchTmdbEpisode: async () => ({ titles: [{ title: 'The Correct Episode' }] }),
    fetchTvdbSeasonEpisodes: async (season) => [
      {
        number: 5,
        aired: '2024-01-01',
        name: season === 11 ? 'The Correct Episode' : 'A Different Episode',
      },
    ],
    config: { enabled: true, episodeCountThreshold: 100, minSeasons: 3 },
  });

  assert.equal(resolution.resolvedSeasonNumber, 11);
  assert.equal(resolution.resolvedEpisodeNumber, undefined);
});
