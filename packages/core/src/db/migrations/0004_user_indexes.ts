import type { Migration } from './types.js';

export const userIndexes: Migration = {
  id: 4,
  name: 'user_indexes',
  up: {
    sqlite: `
      CREATE INDEX IF NOT EXISTS idx_users_created_at  ON users (created_at);
      CREATE INDEX IF NOT EXISTS idx_users_accessed_at ON users (accessed_at);
    `,
    postgres: `
      CREATE INDEX IF NOT EXISTS idx_users_created_at  ON users (created_at);
      CREATE INDEX IF NOT EXISTS idx_users_accessed_at ON users (accessed_at);
    `,
  },
};
