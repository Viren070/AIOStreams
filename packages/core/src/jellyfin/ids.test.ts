import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../index.js';
import type { MetaPreview } from '../db/schemas.js';
import { buildContentItem, isBareMeta, isPlaceholderItem } from './dto.js';
import { decodeItemId, encodeItemId, itemIdsForProviderIds } from './ids.js';

const ctx = {
  serverId: 'server',
  userId: 'user',
  uuid: 'uuid',
  listVersions: false,
  markUnaired: false,
};

describe('itemIdsForProviderIds', () => {
  test('finds a movie by its IMDb id', async () => {
    const ids = itemIdsForProviderIds(['imdb.tt0111161'], ['movie']);
    assert.deepEqual(ids, [
      encodeItemId({ k: 'movie', t: 'movie', i: 'tt0111161' }),
    ]);
    assert.deepEqual(await decodeItemId(ids[0]), {
      kind: 'descriptor',
      descriptor: { k: 'movie', t: 'movie', i: 'tt0111161' },
    });
  });

  test('finds a series by its TMDB or TVDB id', () => {
    assert.deepEqual(itemIdsForProviderIds(['tmdb.1396'], ['series']), [
      encodeItemId({ k: 'series', t: 'series', i: 'tmdb:1396' }),
    ]);
    assert.deepEqual(itemIdsForProviderIds(['tvdb.81189'], ['series']), [
      encodeItemId({ k: 'series', t: 'series', i: 'tvdb:81189' }),
    ]);
  });

  test('takes several pairs, one id per pair and kind', () => {
    const ids = itemIdsForProviderIds(
      ['imdb.tt0111161', 'tmdb.278'],
      ['movie']
    );
    assert.deepEqual(ids, [
      encodeItemId({ k: 'movie', t: 'movie', i: 'tt0111161' }),
      encodeItemId({ k: 'movie', t: 'movie', i: 'tmdb:278' }),
    ]);
    assert.deepEqual(
      itemIdsForProviderIds(['imdb.tt0111161'], ['movie', 'series']),
      [
        encodeItemId({ k: 'movie', t: 'movie', i: 'tt0111161' }),
        encodeItemId({ k: 'series', t: 'series', i: 'tt0111161' }),
      ]
    );
  });

  test('looks for an anime id under anime as well', () => {
    assert.deepEqual(itemIdsForProviderIds(['kitsu.1'], ['series']), [
      encodeItemId({ k: 'series', t: 'series', i: 'kitsu:1' }),
      encodeItemId({ k: 'series', t: 'anime', i: 'kitsu:1' }),
    ]);
    assert.deepEqual(itemIdsForProviderIds(['MyAnimeList.1'], ['movie']), [
      encodeItemId({ k: 'movie', t: 'movie', i: 'mal:1' }),
      encodeItemId({ k: 'movie', t: 'anime', i: 'mal:1' }),
    ]);
    assert.deepEqual(itemIdsForProviderIds(['imdb.tt0111161'], ['series']), [
      encodeItemId({ k: 'series', t: 'series', i: 'tt0111161' }),
    ]);
  });

  test('ignores provider case and a bare IMDb number', () => {
    const expected = itemIdsForProviderIds(['imdb.tt0111161'], ['movie']);
    assert.deepEqual(
      itemIdsForProviderIds(['IMDB.tt0111161'], ['movie']),
      expected
    );
    assert.deepEqual(
      itemIdsForProviderIds(['Imdb.0111161'], ['movie']),
      expected
    );
  });

  test('skips unknown providers and malformed pairs', () => {
    assert.deepEqual(
      itemIdsForProviderIds(['trakt.1', 'imdb.tt0111161'], ['movie']),
      itemIdsForProviderIds(['imdb.tt0111161'], ['movie'])
    );
    assert.deepEqual(itemIdsForProviderIds(['trakt.1'], ['movie']), []);
    assert.deepEqual(itemIdsForProviderIds(['tt0111161'], ['movie']), []);
    assert.deepEqual(itemIdsForProviderIds(['imdb.'], ['movie']), []);
    assert.deepEqual(itemIdsForProviderIds(['tmdb.abc'], ['movie']), []);
    assert.deepEqual(itemIdsForProviderIds([], ['movie', 'series']), []);
    assert.deepEqual(itemIdsForProviderIds(['imdb.tt0111161'], []), []);
  });
});

describe('isPlaceholderItem', () => {
  test('tells an item built without a meta from a real one', () => {
    const stub: MetaPreview = {
      id: 'tt0111161',
      type: 'movie',
      name: 'tt0111161',
    };
    assert.equal(
      isPlaceholderItem(buildContentItem(ctx, stub, { placeholder: true })),
      true
    );
    assert.equal(isPlaceholderItem(buildContentItem(ctx, stub)), false);
  });

  test('tells a bare meta from one that carries anything of its own', () => {
    assert.equal(isBareMeta({ id: 'tt0000000', type: 'movie' }), true);
    assert.equal(isBareMeta({ name: 'The Shawshank Redemption' }), false);
    assert.equal(
      isBareMeta({ background: 'https://images.example/backdrop.jpg' }),
      false
    );
    assert.equal(
      isBareMeta({ description: 'A banker is sent to prison.' }),
      false
    );
  });

  test('keeps a served meta that has no name and only a background', () => {
    const bare: MetaPreview = {
      id: 'tt0111161',
      type: 'movie',
      background: 'https://images.example/tt0111161-backdrop.jpg',
    };
    const item = buildContentItem(ctx, bare);
    assert.equal(item.Name, 'tt0111161');
    assert.deepEqual(item.ImageTags, {});
    assert.equal(isPlaceholderItem(item), false);
  });
});
