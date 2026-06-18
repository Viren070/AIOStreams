import type { Migration } from './types.js';

/**
 * Extend `usenet_library` (additively) so it can drive a richer dashboard
 * (live imports w/ progress, ownership, source, friendly errors, manual adds)
 * and project cleanly into a future SABnzbd-compatible queue+history API. No
 * rebuild: existing `available`/`failed` rows stay valid; `status` simply gains
 * the `queued`/`inspecting` (and reserved `streaming`) lifecycle values.
 */
export const usenetLibraryExt: Migration = {
  id: 9,
  name: 'usenet_library_ext',
  up: {
    sqlite: `
      ALTER TABLE usenet_library ADD COLUMN nzo_id TEXT;
      ALTER TABLE usenet_library ADD COLUMN progress REAL NOT NULL DEFAULT 0;
      ALTER TABLE usenet_library ADD COLUMN bytes_done INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE usenet_library ADD COLUMN bytes_total INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE usenet_library ADD COLUMN owner TEXT;
      ALTER TABLE usenet_library ADD COLUMN source TEXT NOT NULL DEFAULT 'auto';
      ALTER TABLE usenet_library ADD COLUMN import_ms INTEGER;
      ALTER TABLE usenet_library ADD COLUMN nzb_url TEXT;
      ALTER TABLE usenet_library ADD COLUMN category TEXT;
      ALTER TABLE usenet_library ADD COLUMN error_code TEXT;

      CREATE INDEX IF NOT EXISTS idx_usenet_library_owner
        ON usenet_library (owner);
    `,
    postgres: `
      ALTER TABLE usenet_library ADD COLUMN IF NOT EXISTS nzo_id TEXT;
      ALTER TABLE usenet_library ADD COLUMN IF NOT EXISTS progress REAL NOT NULL DEFAULT 0;
      ALTER TABLE usenet_library ADD COLUMN IF NOT EXISTS bytes_done BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE usenet_library ADD COLUMN IF NOT EXISTS bytes_total BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE usenet_library ADD COLUMN IF NOT EXISTS owner TEXT;
      ALTER TABLE usenet_library ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'auto';
      ALTER TABLE usenet_library ADD COLUMN IF NOT EXISTS import_ms INTEGER;
      ALTER TABLE usenet_library ADD COLUMN IF NOT EXISTS nzb_url TEXT;
      ALTER TABLE usenet_library ADD COLUMN IF NOT EXISTS category TEXT;
      ALTER TABLE usenet_library ADD COLUMN IF NOT EXISTS error_code TEXT;

      CREATE INDEX IF NOT EXISTS idx_usenet_library_owner
        ON usenet_library (owner);
    `,
  },
};
