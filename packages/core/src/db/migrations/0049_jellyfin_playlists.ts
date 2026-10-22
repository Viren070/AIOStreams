import type { Migration } from './types.js';

/** A user's playlists; `items` is a JSON array of item ids, in order. */
const ddl = (int: string) => `
      CREATE TABLE IF NOT EXISTS jellyfin_playlists (
        id          TEXT PRIMARY KEY,
        uuid        TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
        persona     TEXT NOT NULL,
        name        TEXT NOT NULL,
        items       TEXT NOT NULL,
        created_at  ${int} NOT NULL,
        updated_at  ${int} NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jellyfin_playlists_owner
        ON jellyfin_playlists (uuid, persona);
`;

export const jellyfinPlaylists: Migration = {
  id: 49,
  name: 'jellyfin_playlists',
  up: { sqlite: ddl('INTEGER'), postgres: ddl('BIGINT') },
};
