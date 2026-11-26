import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// Load the core entry point first; the Jellyfin modules and core import each other.
import '../index.js';
import { buildPlaylistsFolder, type ItemBuildContext } from './dto.js';

const ctx: ItemBuildContext = {
  serverId: 'server',
  userId: 'user',
  uuid: 'uuid',
  listVersions: false,
  markUnaired: false,
};

describe('buildPlaylistsFolder', () => {
  it('is listed as a user view of playlists, as stock Jellyfin does', () => {
    const folder = buildPlaylistsFolder(ctx);
    assert.equal(folder.Type, 'UserView');
    assert.equal(folder.CollectionType, 'playlists');
    assert.equal(folder.IsFolder, true);
  });
});
