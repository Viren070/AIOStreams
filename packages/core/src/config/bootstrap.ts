import { Env } from '../utils/env.js';

/**
 * Bootstrap config - env-only values needed *before* the DB-backed
 * `SettingsStore` is initialised.
 */
export const bootstrap = {
  nodeEnv: Env.NODE_ENV,
  port: Env.PORT,
  baseUrl: Env.BASE_URL,
  internalUrl: Env.INTERNAL_URL,
  internalSecret: Env.INTERNAL_SECRET,
  databaseUri: Env.DATABASE_URI,
  redisUri: Env.REDIS_URI,
  redisTimeout: Env.REDIS_TIMEOUT,
  settingsRefreshInterval: Env.SETTINGS_REFRESH_INTERVAL,
  secretKey: Env.SECRET_KEY,
  auth: Env.AIOSTREAMS_AUTH,
  authAdmins: Env.AIOSTREAMS_AUTH_ADMINS,
  authConnectionLimits: Env.AIOSTREAMS_AUTH_CONNECTIONS_LIMIT,
  logLevel: Env.LOG_LEVEL,
  logFormat: Env.LOG_FORMAT,
  logBufferMaxBytes: Env.LOG_BUFFER_MAX_BYTES,
  logBufferMaxEntries: Env.LOG_BUFFER_MAX_ENTRIES,
  version: Env.VERSION,
  tag: Env.TAG,
  channel: Env.CHANNEL,
  description: Env.DESCRIPTION,
  gitCommit: Env.GIT_COMMIT,
  buildTime: Env.BUILD_TIME,
  buildCommitTime: Env.BUILD_COMMIT_TIME,
  systemLifecycleEnabled: Env.SYSTEM_LIFECYCLE_ENABLED,
} as const;

export type BootstrapConfig = typeof bootstrap;
