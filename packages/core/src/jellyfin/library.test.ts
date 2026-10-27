import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../index.js';
import { buildContentItem } from './dto.js';
import { encodeItemId } from './ids.js';
import { providerLookup } from './library.js';

const ctx = {
  serverId: 'server',
  userId: 'user',
  uuid: 'uuid',
  listVersions: false,
  markUnaired: false,
};

const movieId = encodeItemId({ k: 'movie', t: 'movie', i: 'tt0111161' });
const seriesId = encodeItemId({ k: 'series', t: 'series', i: 'tt0111161' });

type Call = { id: string; resolve: boolean };

/** Builds as the routes do: the movie has a meta, the series only its id. */
function fakeBuild(calls: Call[]) {
  return async (id: string, resolve: boolean) => {
    calls.push({ id, resolve });
    if (id === movieId) {
      const item = buildContentItem(ctx, {
        id: 'tt0111161',
        type: 'movie',
        name: 'The Shawshank Redemption',
        poster: 'https://images.example/tt0111161.jpg',
      });
      return { ...item, MediaSourceCount: resolve ? 1 : 2 };
    }
    if (id === seriesId) {
      return buildContentItem(ctx, {
        id: 'tt0111161',
        type: 'series',
        name: 'tt0111161',
      });
    }
    return null;
  };
}

describe('providerLookup', () => {
  test('drops the placeholder and keeps the real hit', async () => {
    const calls: Call[] = [];
    const found = await providerLookup(
      [movieId, seriesId],
      false,
      fakeBuild(calls)
    );
    assert.deepEqual(
      found.map((i) => i.Id),
      [movieId]
    );
    assert.ok(calls.every((c) => !c.resolve));
  });

  test('resolves versions for the one hit once it is known', async () => {
    const calls: Call[] = [];
    const found = await providerLookup(
      [movieId, seriesId],
      true,
      fakeBuild(calls)
    );
    assert.deepEqual(
      found.map((i) => i.Id),
      [movieId]
    );
    assert.equal(found[0].MediaSourceCount, 1);
    assert.deepEqual(
      calls.filter((c) => c.resolve),
      [{ id: movieId, resolve: true }]
    );
  });

  test('never resolves versions for several hits', async () => {
    const calls: Call[] = [];
    const twice = (id: string, resolve: boolean) =>
      fakeBuild(calls)(id === 'other' ? movieId : id, resolve);
    const found = await providerLookup([movieId, 'other'], true, twice);
    assert.equal(found.length, 2);
    assert.ok(calls.every((c) => !c.resolve));
  });

  test('answers nothing when every candidate is a placeholder', async () => {
    assert.deepEqual(await providerLookup([seriesId], true, fakeBuild([])), []);
  });
});
