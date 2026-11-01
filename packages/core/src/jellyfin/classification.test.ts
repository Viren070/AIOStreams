import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectionTypeFor,
  viewCollectionType,
  isBoxsetCatalog,
  isBoxsetEntry,
} from './classification.js';
import type { Catalog } from './dto.js';

describe('collectionTypeFor', () => {
  it('returns movies when sniffed entries are all movies even if catalog name has collection', () => {
    const catalog: Catalog = {
      type: 'movie',
      id: 'mdblist.criterion-collection',
      name: 'The Criterion Collection',
    };
    assert.equal(collectionTypeFor(catalog, ['movie']), 'movies');
    assert.equal(viewCollectionType(catalog, ['movie']), 'movies');
  });

  it('returns movies when sniffed entries are all movies even if catalog type is collection', () => {
    const catalog: Catalog = {
      type: 'collection',
      id: '2f02e3b0.100-on-rottentomatoes-com-movie',
      name: 'Rotten Tomatoes 100% Fresh',
    };
    assert.equal(collectionTypeFor(catalog, ['movie']), 'movies');
    assert.equal(viewCollectionType(catalog, ['movie']), 'movies');
  });

  it('returns boxsets when sniffed entries are pure collections', () => {
    const catalog: Catalog = {
      type: 'collections',
      id: 'ctmdb.popular',
      name: 'Popular Collections',
    };
    assert.equal(collectionTypeFor(catalog, ['collection']), 'boxsets');
    assert.equal(viewCollectionType(catalog, ['collection']), 'boxsets');
  });

  it('returns boxsets when entries include collection and catalog name matches collection', () => {
    const catalog: Catalog = {
      type: 'movie',
      id: 'ctmdb.featured',
      name: 'Featured Collections',
    };
    assert.equal(
      collectionTypeFor(catalog, ['movie', 'collection']),
      'boxsets'
    );
  });

  it('returns movies when entries include collection but catalog is not collection-named', () => {
    const catalog: Catalog = {
      type: 'movie',
      id: 'addon.top-rated',
      name: 'Top Rated',
    };
    assert.equal(collectionTypeFor(catalog, ['movie', 'collection']), 'movies');
  });

  it('returns tvshows when sniffed entries are series or anime', () => {
    const catalog: Catalog = {
      type: 'series',
      id: 'addon.shows',
      name: 'Anime & Series Collection',
    };
    assert.equal(collectionTypeFor(catalog, ['series']), 'tvshows');
    assert.equal(collectionTypeFor(catalog, ['anime']), 'tvshows');
  });

  it('preserves declared type when unsniffed and catalog is movie or series', () => {
    const movieCatalog: Catalog = {
      type: 'movie',
      id: 'addon.criterion',
      name: 'The Criterion Collection',
    };
    assert.equal(collectionTypeFor(movieCatalog, []), 'movies');

    const seriesCatalog: Catalog = {
      type: 'series',
      id: 'addon.boxset-series',
      name: 'Complete Series Collection',
    };
    assert.equal(collectionTypeFor(seriesCatalog, []), 'tvshows');
  });

  it('guesses boxsets when unsniffed only for declared collection types or non-standard catalogs', () => {
    const collectionCatalog: Catalog = {
      type: 'collection',
      id: 'addon.collections',
      name: 'Franchises',
    };
    assert.equal(collectionTypeFor(collectionCatalog, []), 'boxsets');
  });
});

describe('isBoxsetCatalog', () => {
  it('does not match catalogs solely due to "collection" in catalog name', () => {
    assert.equal(
      isBoxsetCatalog({
        type: 'movie',
        id: 'mdblist.criterion',
        name: 'The Criterion Collection',
      }),
      false
    );
    assert.equal(
      isBoxsetCatalog({
        type: 'movie',
        id: 'mdblist.top',
        name: "Palme d'Or Collection",
      }),
      false
    );
  });

  it('matches catalogs with declared collection or boxset types', () => {
    assert.equal(
      isBoxsetCatalog({
        type: 'collection',
        id: 'custom.id',
        name: 'Custom',
      }),
      true
    );
    assert.equal(
      isBoxsetCatalog({
        type: 'collections',
        id: 'custom.id',
        name: 'Custom',
      }),
      true
    );
    assert.equal(
      isBoxsetCatalog({
        type: 'boxsets',
        id: 'custom.id',
        name: 'Custom',
      }),
      true
    );
  });

  it('matches catalogs with collection in the catalog id', () => {
    assert.equal(
      isBoxsetCatalog({
        type: 'movie',
        id: 'tmdb.collections.popular',
        name: 'Popular Movies',
      }),
      true
    );
  });

  it('returns false for undefined catalog', () => {
    assert.equal(isBoxsetCatalog(undefined), false);
  });
});

describe('isBoxsetEntry', () => {
  it('returns true when preview has a collection property', () => {
    assert.equal(
      isBoxsetEntry({ type: 'movie', collection: { id: 'c1' } }),
      true
    );
  });

  it('returns false for plain movies in catalogs named "collection"', () => {
    const catalog = {
      type: 'movie',
      id: 'mdblist.123',
      name: 'The Criterion Collection',
    };
    assert.equal(isBoxsetEntry({ type: 'movie' }, catalog), false);
  });

  it('returns true for movies in genuine boxset catalogs', () => {
    const catalog = {
      type: 'collections',
      id: 'tmdb.collections',
      name: 'Franchises',
    };
    assert.equal(isBoxsetEntry({ type: 'movie' }, catalog), true);
  });
});
