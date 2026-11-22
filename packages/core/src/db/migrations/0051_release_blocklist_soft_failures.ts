import type { Migration } from './types.js';

/**
 * Repeated-failure verdicts and release-group demotion.
 *
 * `release_blocklist_failures` counts "soft" failures (release defects that a
 * single observation does not prove, e.g. an incomplete archive) per release
 * key until the configured threshold turns them into a local `dead` verdict.
 * A proven-working play deletes the row.
 *
 * `release_blocklist_group_penalties` records one row per dead release of a
 * release group for one title (series: the show, movie: the movie), so a
 * group whose posts keep failing for that title can be demoted in the sorted
 * list. Rows older than the demotion window no longer count and are pruned.
 */
export const releaseBlocklistSoftFailures: Migration = {
  id: 51,
  name: 'release_blocklist_soft_failures',
  up: {
    sqlite: `
      CREATE TABLE IF NOT EXISTS release_blocklist_failures (
        k       TEXT PRIMARY KEY,
        n       INTEGER NOT NULL DEFAULT 0,
        last_at INTEGER NOT NULL DEFAULT 0
      ) WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS release_blocklist_group_penalties (
        grp        TEXT NOT NULL,
        title_key  TEXT NOT NULL,
        release_id TEXT NOT NULL,
        dead_at    INTEGER NOT NULL,
        PRIMARY KEY (grp, title_key, release_id)
      ) WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS release_blocklist_group_penalties_title
        ON release_blocklist_group_penalties (title_key, dead_at);
      CREATE INDEX IF NOT EXISTS release_blocklist_group_penalties_dead_at
        ON release_blocklist_group_penalties (dead_at);
    `,
    postgres: `
      CREATE TABLE IF NOT EXISTS release_blocklist_failures (
        k       TEXT PRIMARY KEY,
        n       INTEGER NOT NULL DEFAULT 0,
        last_at BIGINT NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS release_blocklist_group_penalties (
        grp        TEXT NOT NULL,
        title_key  TEXT NOT NULL,
        release_id TEXT NOT NULL,
        dead_at    BIGINT NOT NULL,
        PRIMARY KEY (grp, title_key, release_id)
      );

      CREATE INDEX IF NOT EXISTS release_blocklist_group_penalties_title
        ON release_blocklist_group_penalties (title_key, dead_at);
      CREATE INDEX IF NOT EXISTS release_blocklist_group_penalties_dead_at
        ON release_blocklist_group_penalties (dead_at);
    `,
  },
};
