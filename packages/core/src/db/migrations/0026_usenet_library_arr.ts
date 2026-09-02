import type { Migration } from './types.js';

/**
 * Columns for the arr download-client mode and the library recheck. The
 * timestamps are epoch ms so SQLite and Postgres compare them the same way;
 * the columns are documented on the repository's entry type.
 */
export const usenetLibraryArr: Migration = {
  id: 26,
  name: 'usenet_library_arr',
  up: {
    sqlite: `
      ALTER TABLE usenet_library ADD COLUMN origin TEXT;
      ALTER TABLE usenet_library ADD COLUMN posted_at INTEGER;
      ALTER TABLE usenet_library ADD COLUMN completed_at INTEGER;
      ALTER TABLE usenet_library ADD COLUMN last_checked_at INTEGER;
      ALTER TABLE usenet_library ADD COLUMN next_check_at INTEGER;
      ALTER TABLE usenet_library ADD COLUMN check_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE usenet_library ADD COLUMN hidden_at INTEGER;
      ALTER TABLE usenet_library ADD COLUMN arr_link TEXT;
      UPDATE usenet_library SET origin = CASE WHEN source = 'auto' THEN 'playback' ELSE 'dashboard' END WHERE origin IS NULL;
      CREATE INDEX IF NOT EXISTS idx_usenet_library_next_check ON usenet_library (next_check_at);
    `,
    postgres: `
      ALTER TABLE usenet_library ADD COLUMN IF NOT EXISTS origin TEXT;
      ALTER TABLE usenet_library ADD COLUMN IF NOT EXISTS posted_at BIGINT;
      ALTER TABLE usenet_library ADD COLUMN IF NOT EXISTS completed_at BIGINT;
      ALTER TABLE usenet_library ADD COLUMN IF NOT EXISTS last_checked_at BIGINT;
      ALTER TABLE usenet_library ADD COLUMN IF NOT EXISTS next_check_at BIGINT;
      ALTER TABLE usenet_library ADD COLUMN IF NOT EXISTS check_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE usenet_library ADD COLUMN IF NOT EXISTS hidden_at BIGINT;
      ALTER TABLE usenet_library ADD COLUMN IF NOT EXISTS arr_link TEXT;
      UPDATE usenet_library SET origin = CASE WHEN source = 'auto' THEN 'playback' ELSE 'dashboard' END WHERE origin IS NULL;
      CREATE INDEX IF NOT EXISTS idx_usenet_library_next_check ON usenet_library (next_check_at);
    `,
  },
};
