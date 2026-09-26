import assert from 'node:assert/strict';
import { it } from 'node:test';
import '../utils/index.js';
import { AnimeRepository } from '../db/repositories/anime.js';
import { AnimeDatabase } from './database.js';
import { AnimeType, type AnimeRecord } from './types.js';

it('keeps IMDb-scoped hints consistent in single and batched lookups', async (t) => {
  const id = 'tt9999101';
  const records: AnimeRecord[] = [
    {
      rid: 9001,
      type: AnimeType.TV,
      ids: { imdbId: id, kitsuId: 1 },
      title: 'Wrong Part',
      imdb: { id: 'tt9999102', fromSeason: 2, fromEpisode: 1 },
    },
    {
      rid: 9002,
      type: AnimeType.TV,
      ids: { imdbId: 'tt9999103', kitsuId: 2 },
      title: 'Correct Part',
      imdb: { id, fromSeason: 2, fromEpisode: 1 },
    },
  ];
  t.mock.method(AnimeRepository, 'findCandidates', async () => records);
  const db = AnimeDatabase.getInstance();
  const batch = (await db.selectorFor('imdbId', id))(2, 1);
  const single = await db.getEntryById('imdbId', id, 2, 1);
  for (const entry of [single, batch]) {
    assert.equal(entry?.mappings.kitsuId, 2);
    assert.equal(entry?.mappings.imdbId, id);
    assert.equal(entry?.imdb?.id, id);
  }
  assert.deepEqual(single?.localEpisodeTitles, ['Correct Part']);
  assert.equal(records[1].ids.imdbId, 'tt9999103');
});

it('excludes another IMDb show from specials in both lookup paths', async (t) => {
  const id = 'tt9999201';
  const records: AnimeRecord[] = [
    {
      rid: 9011,
      type: AnimeType.SPECIAL,
      ids: { imdbId: 'tt9999202', kitsuId: 11 },
      imdb: { id, fromSeason: 0, fromEpisode: 1 },
    },
    { rid: 9012, type: AnimeType.SPECIAL, ids: { imdbId: id, kitsuId: 12 } },
  ];
  t.mock.method(AnimeRepository, 'findCandidates', async () => records);
  const db = AnimeDatabase.getInstance();
  assert.equal(
    (await db.selectorFor('imdbId', id))(0, 1)?.mappings.kitsuId,
    12
  );
  assert.equal(
    (await db.getEntryById('imdbId', id, 0, 1))?.mappings.kitsuId,
    12
  );
});
