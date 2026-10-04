import type { Migration } from './types.js';

const ddl = (big: string) => `
      CREATE TABLE IF NOT EXISTS media_info_probes (
        id          TEXT PRIMARY KEY,
        release_key TEXT NOT NULL,
        file        TEXT NOT NULL,
        cause       TEXT NOT NULL,
        outcome     TEXT NOT NULL,
        error       TEXT,
        queued_at   ${big} NOT NULL,
        started_at  ${big},
        finished_at ${big} NOT NULL,
        bytes_read  ${big} NOT NULL DEFAULT 0,
        tracks      INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_media_info_probes_finished
        ON media_info_probes (finished_at);
`;

export const mediaInfoProbes: Migration = {
  id: 44,
  name: 'media_info_probes',
  up: { sqlite: ddl('INTEGER'), postgres: ddl('BIGINT') },
};
