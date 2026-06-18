import type { Migration } from './types.js';

/**
 * Store the NZB password (from `<head><meta type="password">` or a
 * `{{password}}` token in the name) alongside the library entry so the
 * dashboard info modal can surface it. Additive, nullable — existing rows stay
 * valid with a NULL password.
 */
export const usenetLibraryPassword: Migration = {
  id: 10,
  name: 'usenet_library_password',
  up: {
    sqlite: `
      ALTER TABLE usenet_library ADD COLUMN password TEXT;
    `,
    postgres: `
      ALTER TABLE usenet_library ADD COLUMN IF NOT EXISTS password TEXT;
    `,
  },
};
