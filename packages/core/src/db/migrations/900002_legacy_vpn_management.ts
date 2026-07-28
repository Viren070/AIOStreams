import type { Migration } from './types.js';

/**
 * Compatibility marker for databases previously migrated by the private fork.
 * Existing VPN profile data is preserved but is not surfaced by this build.
 */
export const legacyVpnManagement: Migration = {
  id: 900002,
  name: 'legacy_vpn_management',
  up: {
    sqlite: '',
    postgres: '',
  },
};
