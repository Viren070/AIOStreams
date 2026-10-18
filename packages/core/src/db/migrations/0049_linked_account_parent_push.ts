import type { Migration } from './types.js';

/**
 * Whether a link is pushed when a configuration this one inherits from is
 * saved. Off by default: the push happens on the server, without the user
 * having this configuration open.
 */
export const linkedAccountParentPush: Migration = {
  id: 49,
  name: 'linked_account_parent_push',
  up: {
    sqlite: `
      ALTER TABLE linked_accounts ADD COLUMN push_on_parent_change INTEGER NOT NULL DEFAULT 0;
    `,
    postgres: `
      ALTER TABLE linked_accounts ADD COLUMN IF NOT EXISTS push_on_parent_change SMALLINT NOT NULL DEFAULT 0;
    `,
  },
};
