import type { Migration } from './types.js';

export const baseline: Migration = {
  id: 1,
  name: 'baseline',
  up: {
    sqlite: `
      CREATE TABLE IF NOT EXISTS users (
        uuid TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        config TEXT NOT NULL,
        config_salt TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP),
        updated_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP),
        accessed_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP)
      );

      CREATE TABLE IF NOT EXISTS distributed_locks (
        key TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        result TEXT
      );

      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `,
    postgres: `
      CREATE TABLE IF NOT EXISTS users (
        uuid TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        config TEXT NOT NULL,
        config_salt TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS distributed_locks (
        key TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        result TEXT
      );

      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `,
  },
};
