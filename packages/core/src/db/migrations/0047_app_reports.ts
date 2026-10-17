import type { Migration } from './types.js';

/**
 * Reports the apps send, read by a short code. `uuid` is the configuration of
 * a report sent here; one another server passed on has none, only `origin`.
 */
const ddl = (int: string) => `
      CREATE TABLE IF NOT EXISTS app_reports (
        code        TEXT PRIMARY KEY,
        created_at  ${int} NOT NULL,
        uuid        TEXT REFERENCES users(uuid) ON DELETE CASCADE,
        persona     TEXT,
        origin      TEXT,
        kind        TEXT NOT NULL,
        platform    TEXT NOT NULL,
        app_version TEXT NOT NULL,
        device      TEXT NOT NULL,
        note        TEXT NOT NULL,
        summary     TEXT NOT NULL,
        details     TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_app_reports_created
        ON app_reports (created_at);
`;

export const appReports: Migration = {
  id: 47,
  name: 'app_reports',
  up: { sqlite: ddl('INTEGER'), postgres: ddl('BIGINT') },
};
