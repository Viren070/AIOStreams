import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { libraryCatalogItemType } from './catalog.js';

describe('libraryCatalogItemType', () => {
  it('renders debridge usenet library rows in the usenet lane', () => {
    assert.equal(libraryCatalogItemType({ libraryType: 'usenet' }), 'usenet');
  });

  it('keeps existing library rows in the torrent lane by default', () => {
    assert.equal(libraryCatalogItemType({}), 'torrent');
  });
});
