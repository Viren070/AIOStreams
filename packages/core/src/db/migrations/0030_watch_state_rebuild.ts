import type { Migration } from './types.js';
import { WATCH_STATE_DDL } from './0028_watch_state.js';
import { PLAYBACK_HANDOFF_DDL } from './0029_playback_handoff.js';

/**
 * Rebuilds watch state onto the shape 28 and 29 now declare, `persona` in every
 * key included. Those were rewritten in place, so an instance that already
 * applied them never sees the new columns, and the DDL is `IF NOT EXISTS`, so
 * the tables have to be dropped rather than left alone.
 */
const TABLES = [
  'user_watch_state',
  'watch_state_deliveries',
  'watch_state_sinks',
  'watch_deliveries',
  'watch_sinks',
  'jellyfin_display_prefs',
  'watch_sessions',
  'watch_state',
];

const drop = TABLES.map((table) => `DROP TABLE IF EXISTS ${table};`).join(
  '\n      '
);

export const watchStateRebuild: Migration = {
  id: 30,
  name: 'watch_state_rebuild',
  up: {
    sqlite: `
      ${drop}
      ${WATCH_STATE_DDL.sqlite}
      ${PLAYBACK_HANDOFF_DDL.sqlite}
    `,
    postgres: `
      ${drop}
      ${WATCH_STATE_DDL.postgres}
      ${PLAYBACK_HANDOFF_DDL.postgres}
    `,
  },
};
