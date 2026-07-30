import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mapStremThruLibraryItems } from './stremthru.js';

describe('mapStremThruLibraryItems', () => {
  it('marks debridge usenet rows carried by the StremThru library list', () => {
    const rows = [
      {
        id: 'rd-1',
        hash: 'torrent-hash',
        name: 'Torrent.Movie.2024.mkv',
        size: 100,
        status: 'downloaded',
        added_at: '2026-07-29T00:00:00Z',
        kind: 'realdebrid',
      },
      {
        id: 'usenet-hash',
        hash: 'usenet-hash',
        name: 'Usenet.Movie.2024.mkv',
        size: 200,
        status: 'downloaded',
        added_at: '2026-07-29T01:00:00Z',
        // Debridge /v1/library uses kind=usenet for recent usenet mints.
        kind: 'usenet',
      },
    ];

    const mapped = mapStremThruLibraryItems(rows, 'torrent');

    assert.deepEqual(
      mapped.map((item) => [item.id, item.libraryType]),
      [
        ['rd-1', 'torrent'],
        ['usenet-hash', 'usenet'],
      ]
    );
  });

  it('treats untyped rows from native newz endpoints as usenet', () => {
    const rows = [
      {
        id: 'newz-1',
        hash: 'nzb-hash',
        name: 'NZB.Movie.2024.mkv',
        size: 200,
        status: 'downloaded',
        added_at: '2026-07-29T01:00:00Z',
      },
    ];

    assert.deepEqual(mapStremThruLibraryItems(rows, 'usenet'), [
      {
        id: 'newz-1',
        hash: 'nzb-hash',
        name: 'NZB.Movie.2024.mkv',
        size: 200,
        status: 'downloaded',
        private: undefined,
        addedAt: '2026-07-29T01:00:00Z',
        libraryType: 'usenet',
      },
    ]);
  });
});
