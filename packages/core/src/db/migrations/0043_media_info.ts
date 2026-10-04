import type { Migration } from './types.js';

const ddl = (big: string) => `
      CREATE TABLE IF NOT EXISTS media_info (
        release_key   TEXT NOT NULL,
        file          TEXT NOT NULL,
        origin        TEXT NOT NULL DEFAULT 'local',
        release_files INTEGER NOT NULL,
        size          ${big},
        info          TEXT NOT NULL,
        version       INTEGER NOT NULL,
        created_at    ${big} NOT NULL,
        updated_at    ${big} NOT NULL,
        PRIMARY KEY (release_key, file, origin)
      );
`;

export const mediaInfo: Migration = {
  id: 43,
  name: 'media_info',
  up: { sqlite: ddl('INTEGER'), postgres: ddl('BIGINT') },
};
