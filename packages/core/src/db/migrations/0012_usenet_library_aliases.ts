import type { Migration } from './types.js';

/**
 * Alias table for the native usenet library. `usenet_library.nzb_hash` is
 * the NZB content hash (SHA1 over the sorted segment message-ids (`computeNzbHash`)),
 * while search results only know the search-time hash (`hashNzbUrl`, MD5 of the cleaned NZB URL).
 * Each alias row maps one such opaque search-time hash onto the
 * content hash, so one post reachable through many URLs converges on a single library row.
 */
export const usenetLibraryAliases: Migration = {
  id: 12,
  name: 'usenet_library_aliases',
  up: {
    sqlite: `
      CREATE TABLE IF NOT EXISTS usenet_library_aliases (
        alias_hash TEXT PRIMARY KEY,
        nzb_hash TEXT NOT NULL,
        nzb_url TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_usenet_library_aliases_nzb_hash
        ON usenet_library_aliases (nzb_hash);
    `,
    postgres: `
      CREATE TABLE IF NOT EXISTS usenet_library_aliases (
        alias_hash TEXT PRIMARY KEY,
        nzb_hash TEXT NOT NULL,
        nzb_url TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_usenet_library_aliases_nzb_hash
        ON usenet_library_aliases (nzb_hash);
    `,
  },
};
