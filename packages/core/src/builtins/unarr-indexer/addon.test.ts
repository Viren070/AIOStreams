import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUnarrSearchParams, validateUnarrApiUrl } from './addon.js';
import type { ParsedId } from '../../utils/id-parser.js';

const parsedEpisode: ParsedId = {
  type: 'imdbId',
  value: 'tt1196946',
  fullId: 'tt1196946:1:1',
  externalType: 'imdb_id',
  mediaType: 'series',
  season: '1',
  episode: '1',
  generator: (value, season, episode) => `${value}:${season}:${episode}`,
};

test('builds Unarr episode search with IDs, query, and season mapping', () => {
  assert.deepEqual(
    buildUnarrSearchParams(
      parsedEpisode,
      {
        primaryTitle: 'The Mentalist',
        titles: ['The Mentalist'],
        year: 2008,
        imdbId: 'tt1196946',
        tvdbId: 82459,
        season: 1,
        episode: 1,
      },
      30
    ),
    {
      query: 'The Mentalist 2008',
      imdbId: 'tt1196946',
      tvdbId: '82459',
      season: 1,
      episode: 1,
      limit: 30,
    }
  );
});

test('uses the parsed IMDb ID when metadata has no external ID', () => {
  assert.equal(
    buildUnarrSearchParams(parsedEpisode, { titles: ['The Mentalist'] }, 10)
      .imdbId,
    'tt1196946'
  );
});

test('allows only the official HTTPS Unarr host family', () => {
  assert.equal(validateUnarrApiUrl('https://unarr.app/'), 'https://unarr.app');
  assert.equal(
    validateUnarrApiUrl('https://api.unarr.app/'),
    'https://api.unarr.app'
  );
  assert.throws(() => validateUnarrApiUrl('http://unarr.app'));
  assert.throws(() => validateUnarrApiUrl('https://unarr.app.example.com'));
});
