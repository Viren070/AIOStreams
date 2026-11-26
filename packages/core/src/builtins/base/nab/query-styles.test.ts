import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nabQueryStyle } from './query-styles.js';

const { categories } = nabQueryStyle('prowlarr');
assert.ok(categories);

describe('Prowlarr query style categories', () => {
  it('keeps the standard TV category and its children in order', () => {
    assert.deepEqual(
      categories('series', [
        { id: 2000, subcats: [2040] },
        { id: 5000, subcats: [5030, 5040] },
        { id: 6000, subcats: [6040] },
      ]),
      [5030, 5040, 5000]
    );
  });

  it('includes every advertised TV group and its children', () => {
    assert.deepEqual(
      categories('series', [
        { id: 5000, subcats: [5040] },
        { id: 5100, subcats: [5140] },
        { id: 5200, subcats: [5240] },
        { id: 5300, subcats: [5340] },
        { id: 5999, subcats: [] },
        { id: 6000, subcats: [6040] },
        { id: 100000, subcats: [] },
      ]),
      [5040, 5000, 5140, 5100, 5240, 5200, 5340, 5300, 5999]
    );
  });

  it('deduplicates categories already listed under the TV parent', () => {
    assert.deepEqual(
      categories('series', [
        { id: 5000, subcats: [5040, 5100, 5140] },
        { id: 5100, subcats: [5140, 5145] },
      ]),
      [5040, 5100, 5140, 5000, 5145]
    );
  });

  it('omits the category filter when the TV parent is absent', () => {
    assert.equal(
      categories('series', [{ id: 5100, subcats: [5140] }]),
      undefined
    );
  });

  it('uses the standard movie category and its children for movies', () => {
    assert.deepEqual(
      categories('movie', [
        { id: 2000, subcats: [2040] },
        { id: 2100, subcats: [2140] },
        { id: 5000, subcats: [5040] },
      ]),
      [2040, 2000]
    );
  });
});
