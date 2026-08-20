import type { Migration } from './types.js';

/**
 * Record which sources a stored build was made from, so a build missing one
 * can be refused rather than overwriting a complete store. The fingerprint
 * cannot answer this: it covers only the sources that were available, and a
 * replica missing one simply produces a different fingerprint.
 *
 * Existing rows default to `[]`, i.e. incomplete, so the first replica with
 * every source republishes once after the upgrade.
 */
export const animeBuildSources: Migration = {
  id: 22,
  name: 'anime_build_sources',
  up: {
    sqlite: `
      ALTER TABLE anime_build ADD COLUMN sources TEXT NOT NULL DEFAULT '[]';
    `,
    postgres: `
      ALTER TABLE anime_build
        ADD COLUMN IF NOT EXISTS sources TEXT NOT NULL DEFAULT '[]';
    `,
  },
};
