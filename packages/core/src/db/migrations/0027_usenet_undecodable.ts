import type { Migration } from './types.js';

/**
 * Count articles a provider delivered that failed decode / checksum / size
 * verification, next to `missing` (430s) and `errors` (transport).
 */
export const usenetUndecodable: Migration = {
  id: 27,
  name: 'usenet_undecodable',
  up: {
    sqlite: `
      ALTER TABLE usenet_provider_metrics
        ADD COLUMN undecodable INTEGER NOT NULL DEFAULT 0;
    `,
    postgres: `
      ALTER TABLE usenet_provider_metrics
        ADD COLUMN IF NOT EXISTS undecodable BIGINT NOT NULL DEFAULT 0;
    `,
  },
};
