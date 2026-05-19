import type { Migration } from './types.js';

export const settings: Migration = {
  id: 2,
  name: 'settings',
  up: {
    sqlite: `
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT
      );

      CREATE TABLE IF NOT EXISTS settings_version (
        id INTEGER PRIMARY KEY DEFAULT 1,
        version INTEGER NOT NULL DEFAULT 0,
        CHECK (id = 1)
      );

      INSERT INTO settings_version (id, version)
      VALUES (1, 0)
      ON CONFLICT(id) DO NOTHING;
    `,
    postgres: `
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT
      );

      CREATE TABLE IF NOT EXISTS settings_version (
        id INTEGER PRIMARY KEY DEFAULT 1,
        version BIGINT NOT NULL DEFAULT 0,
        CHECK (id = 1)
      );

      INSERT INTO settings_version (id, version)
      VALUES (1, 0)
      ON CONFLICT(id) DO NOTHING;
    `,
  },
};
