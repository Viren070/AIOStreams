import assert from 'node:assert/strict';
import test from 'node:test';
import { getProviderEpisodeNumbers } from './service.js';

test('uses remapped season and episode numbers for downstream provider lookups', () => {
  assert.deepEqual(
    getProviderEpisodeNumbers(11, 5, {
      resolvedSeasonNumber: 14,
      resolvedEpisodeNumber: 8,
    }),
    { seasonNumber: 14, episodeNumber: 8 }
  );
});

test('keeps the requested numbering when no provider remap is available', () => {
  assert.deepEqual(getProviderEpisodeNumbers(11, 5), {
    seasonNumber: 11,
    episodeNumber: 5,
  });
});
