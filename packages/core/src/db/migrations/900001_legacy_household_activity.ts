import type { Migration } from './types.js';

/**
 * Compatibility marker for databases previously migrated by the private fork.
 * The legacy household tables and columns are intentionally left dormant; the
 * nightly build does not expose their API or UI.
 */
export const legacyHouseholdActivity: Migration = {
  id: 900001,
  name: 'legacy_household_activity',
  up: {
    sqlite: '',
    postgres: '',
  },
};
