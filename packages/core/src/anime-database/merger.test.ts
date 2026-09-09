import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSources } from './merger.js';
import type { SourceEntry } from './types.js';

function merge(...entries: SourceEntry[]) {
  return mergeSources(
    entries.map((entry, index) => ({
      sourceId: `source-${index}`,
      entries: [entry],
    }))
  )[0]!;
}

describe('IMDb mapping identity', () => {
  it('preserves paired hints and ID while still merging other IDs', () => {
    const record = merge(
      {
        ids: { kitsuId: 48015, imdbId: 'tt14986406' },
        imdb: { fromSeason: 3, fromEpisode: 1 },
      },
      {
        ids: { kitsuId: 48015, imdbId: 'tt0434665', thetvdbId: 74796 },
      }
    );
    assert.equal(record.ids.imdbId, 'tt14986406');
    assert.deepEqual(record.imdb, { fromSeason: 3, fromEpisode: 1 });
    assert.equal(record.ids.thetvdbId, 74796);
  });

  it('does not replace a paired mapping with an empty hint object', () => {
    const record = merge(
      {
        ids: { kitsuId: 1, imdbId: 'tt1' },
        imdb: { fromSeason: 3, fromEpisode: 1 },
      },
      { ids: { kitsuId: 1, imdbId: 'tt2' }, imdb: {} }
    );
    assert.equal(record.ids.imdbId, 'tt1');
    assert.deepEqual(record.imdb, { fromSeason: 3, fromEpisode: 1 });
  });

  it('replaces hints cleanly when a different ID supplies a mapping', () => {
    const record = merge(
      {
        ids: { kitsuId: 1, imdbId: 'tt1' },
        imdb: {
          fromSeason: 3,
          fromEpisode: 14,
          title: 'Old',
          nonImdbEpisodes: [2],
        },
      },
      {
        ids: { kitsuId: 1, imdbId: 'tt2' },
        imdb: { fromSeason: 1 },
      }
    );
    assert.equal(record.ids.imdbId, 'tt2');
    assert.deepEqual(record.imdb, { fromSeason: 1 });
  });

  it('continues to merge partial hints for the same ID', () => {
    const record = merge(
      {
        ids: { kitsuId: 1, imdbId: 'tt1' },
        imdb: { fromSeason: 3, fromEpisode: 1 },
      },
      { ids: { kitsuId: 1, imdbId: 'tt1' }, imdb: { fromEpisode: 14 } }
    );
    assert.deepEqual(record.imdb, { fromSeason: 3, fromEpisode: 14 });
  });

  it('retains last-writer-wins for IDs without hints', () => {
    const record = merge(
      { ids: { kitsuId: 1, imdbId: 'tt1' } },
      { ids: { kitsuId: 1, imdbId: 'tt2' } }
    );
    assert.equal(record.ids.imdbId, 'tt2');
    assert.equal(record.imdb, undefined);
  });
});
