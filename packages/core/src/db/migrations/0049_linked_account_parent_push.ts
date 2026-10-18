import type { Migration } from './types.js';

/**
 * Whether a link is pushed when a configuration this one inherits from is
 * saved. Off by default: the push happens on the server, without the user
 * having this configuration open. `last_checked_at` records every push
 * attempt, including ones skipped because nothing changed, so capped runs
 * rotate through the links.
 */
export const linkedAccountParentPush: Migration = {
  id: 49,
  name: 'linked_account_parent_push',
  up: {
    sqlite: `
      ALTER TABLE linked_accounts ADD COLUMN push_on_parent_change INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE linked_accounts ADD COLUMN last_checked_at INTEGER;
    `,
    postgres: `
      ALTER TABLE linked_accounts ADD COLUMN IF NOT EXISTS push_on_parent_change SMALLINT NOT NULL DEFAULT 0;
      ALTER TABLE linked_accounts ADD COLUMN IF NOT EXISTS last_checked_at BIGINT;
    `,
  },
};
