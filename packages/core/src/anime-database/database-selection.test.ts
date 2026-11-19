import assert from 'node:assert/strict';
import { it } from 'node:test';
import '../utils/index.js';
import { AnimeRepository } from '../db/repositories/anime.js';
import { AnimeDatabase } from './database.js';
import { AnimeType, type AnimeRecord } from './types.js';

it('preserves IMDb-mapped OVAs in both single and batched database lookups', async (t) => {
  const record: AnimeRecord = {
    rid: 987654,
    type: AnimeType.OVA,
    ids: { imdbId: 'tt0096633', kitsuId: 727 },
    imdb: { fromSeason: 1, fromEpisode: 1 },
    tvdb: { seasonNumber: 'a' },
  };
  const find = t.mock.method(AnimeRepository, 'findCandidates', async () => [
    record,
  ]);
  const db = AnimeDatabase.getInstance();
  const select = await db.selectorFor('imdbId', 'tt0096633');
  assert.equal(select(3, 1)?.mappings.kitsuId, 727);
  assert.equal(select(4, 1)?.mappings.kitsuId, 727);
  assert.equal(find.mock.callCount(), 1);
  assert.equal(
    (await db.getEntryById('imdbId', 'tt0096633', 3, 1))?.mappings.kitsuId,
    727
  );
});
