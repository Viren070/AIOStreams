import type { Migration } from './types.js';

/**
 * Native usenet library/history. One row per NZB (keyed by the `hashNzbUrl`
 * content hash) records what the built-in engine has resolved or definitively
 * failed, the selected/streamable file list, and activity timestamps. This
 * backs `NativeUsenetService.checkNzbs` (library flag + cached file list +
 * failed filtering) and the dashboard's usenet activity/history view (where a
 * user can manually delete entries).
 */
export const usenet: Migration = {
  id: 7,
  name: 'usenet',
  up: {
    sqlite: `
      CREATE TABLE IF NOT EXISTS usenet_library (
        nzb_hash TEXT PRIMARY KEY,
        name TEXT,
        size INTEGER,
        file_index INTEGER,
        files TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'available',
        fail_reason TEXT,
        fail_count INTEGER NOT NULL DEFAULT 0,
        added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_used_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_usenet_library_status
        ON usenet_library (status);
      CREATE INDEX IF NOT EXISTS idx_usenet_library_last_used
        ON usenet_library (last_used_at);
    `,
    postgres: `
      CREATE TABLE IF NOT EXISTS usenet_library (
        nzb_hash TEXT PRIMARY KEY,
        name TEXT,
        size BIGINT,
        file_index INTEGER,
        files TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'available',
        fail_reason TEXT,
        fail_count INTEGER NOT NULL DEFAULT 0,
        added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_used_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_usenet_library_status
        ON usenet_library (status);
      CREATE INDEX IF NOT EXISTS idx_usenet_library_last_used
        ON usenet_library (last_used_at);
    `,
  },
};
