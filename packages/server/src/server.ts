import app from './app.js';

import {
  Env,
  config as appConfig,
  createLogger,
  initDb,
  initialiseConfig,
  closeDb,
  UserRepository,
  logStartupInfo,
  Cache,
  RegexAccess,
  SelAccess,
  AnimeDatabase,
  ConfigStartupError,
  ProwlarrAddon,
  TemplateManager,
  maskSensitiveInfo,
  constants,
  SeaDexDataset,
  ensureConfigAccessKey,
  warnLegacyAuthVarsIfNeeded,
  startAnalytics,
  stopAnalytics,
  TaskManager,
  drainUsenetMetrics,
  pruneUsenetMetrics,
} from '@aiostreams/core';
import { randomBytes } from 'crypto';

const logger = createLogger('server');

async function initialiseDatabase() {
  try {
    await initDb(appConfig.bootstrap.databaseUri);
    await initialiseConfig();
  } catch (error) {
    if (error instanceof ConfigStartupError) throw error;
    logger.error('Failed to initialise database:', error);
    throw error;
  }
}

function registerPruneTask() {
  const maxDays = appConfig.tasks.pruning.maxDays;
  TaskManager.register({
    id: 'prune-users',
    label: 'Prune inactive users',
    description:
      'Deletes user configs that have not been accessed within the configured window.',
    category: 'users',
    kind: 'scheduled',
    intervalMs: appConfig.tasks.pruning.interval * 1000,
    enabled: maxDays >= 0,
    destructive: true,
    multiReplica: 'single',
    run: async () => {
      if (appConfig.tasks.pruning.maxDays < 0)
        return { ok: true, message: 'pruning disabled' };
      const n = await UserRepository.pruneUsers(
        appConfig.tasks.pruning.maxDays
      );
      return { ok: true, message: `pruned ${n} users` };
    },
  });
}

function registerCacheTasks() {
  TaskManager.register({
    id: 'clear-all-cache',
    label: 'Clear all cache',
    description: 'Wipes every registered cache backend. Destructive.',
    category: 'cache',
    kind: 'manual',
    enabled: true,
    destructive: true,
    multiReplica: 'all',
    run: async () => {
      await Cache.clearAll();
      return { ok: true, message: 'cache cleared' };
    },
  });
  TaskManager.register({
    id: 'clear-expired-cache',
    label: 'Clear expired cache keys',
    description: 'Deletes expired SQL cache rows (memory/redis self-expire).',
    category: 'cache',
    kind: 'manual',
    enabled: true,
    destructive: false,
    multiReplica: 'single',
    run: async () => {
      const n = await Cache.clearExpired();
      return { ok: true, message: `removed ${n} expired rows` };
    },
  });
}

// Retain usenet provider rollups for ~13 months so the "all time" / monthly
// views have history without the table growing unbounded.
const USENET_METRICS_RETENTION_DAYS = 400;

function registerUsenetTasks() {
  TaskManager.register({
    id: 'usenet-metrics-drain',
    label: 'Flush usenet provider metrics',
    description:
      'Drains the in-memory native usenet engine counters into the hourly ' +
      'provider metrics table that powers the dashboard charts.',
    category: 'usenet',
    kind: 'scheduled',
    intervalMs: 60_000,
    enabled: true,
    destructive: false,
    multiReplica: 'all',
    run: async () => {
      const n = await drainUsenetMetrics();
      return { ok: true, message: `flushed ${n} provider deltas` };
    },
  });
  TaskManager.register({
    id: 'usenet-metrics-prune',
    label: 'Prune old usenet metrics',
    description:
      'Deletes native usenet provider rollups older than the retention window.',
    category: 'usenet',
    kind: 'scheduled',
    intervalMs: 24 * 60 * 60_000,
    enabled: true,
    destructive: true,
    multiReplica: 'single',
    run: async () => {
      const n = await pruneUsenetMetrics(USENET_METRICS_RETENTION_DAYS);
      return { ok: true, message: `pruned ${n} metric rows` };
    },
  });
}

async function initialiseRedis() {
  if (appConfig.bootstrap.redisUri) {
    await Cache.testRedisConnection();
  }
}

async function initialiseAnimeDatabase() {
  try {
    await AnimeDatabase.getInstance().initialise();
  } catch (error) {
    logger.error('Failed to initialise AnimeDatabase:', error);
  }
}

async function initialiseSeaDexDataset() {
  try {
    await SeaDexDataset.getInstance().initialise();
  } catch {}
}

async function initialiseProwlarr() {
  try {
    await ProwlarrAddon.fetchpreconfiguredIndexers();
  } catch (error) {
    logger.error('Failed to initialise Prowlarr:', error);
  }
}

async function initialiseTemplates() {
  try {
    await TemplateManager.loadTemplates();
  } catch (error) {
    logger.error('Failed to initialise templates:', error);
  }
}

async function initialiseAuth() {
  await ensureConfigAccessKey();
  warnLegacyAuthVarsIfNeeded();
  if (appConfig.nzbProxy.publicEnabled) {
    appConfig.bootstrap.auth.set(
      constants.PUBLIC_NZB_PROXY_USERNAME,
      appConfig.bootstrap.auth.get(constants.PUBLIC_NZB_PROXY_USERNAME) ||
        randomBytes(32).toString('hex')
    );
    logger.info('AIOStreams Public NZB Proxy is enabled.', {
      username: constants.PUBLIC_NZB_PROXY_USERNAME,
      password: maskSensitiveInfo(
        appConfig.bootstrap.auth.get(constants.PUBLIC_NZB_PROXY_USERNAME) || ''
      ),
    });
  }
}

async function start() {
  try {
    await initialiseDatabase();
    await initialiseTemplates();
    logStartupInfo();
    await initialiseRedis();
    initialiseAnimeDatabase();
    initialiseSeaDexDataset();
    RegexAccess.initialise();
    SelAccess.initialise();
    await initialiseProwlarr();
    registerPruneTask();
    registerCacheTasks();
    registerUsenetTasks();
    await initialiseAuth();
    startAnalytics();
    const server = app.listen(appConfig.bootstrap.port, (error) => {
      if (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
      }
      logger.info(
        `Server running on port ${appConfig.bootstrap.port}: ${JSON.stringify(server.address())}`
      );
    });
  } catch (error) {
    if (error instanceof ConfigStartupError) throw error;
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

async function shutdown() {
  TaskManager.stopAll();
  await stopAnalytics().catch(() => undefined);
  await Cache.close();
  RegexAccess.cleanup();
  SelAccess.cleanup();
  await closeDb();
}

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled promise rejection ');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception ');
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  await shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  await shutdown();
  process.exit(0);
});

start().catch((error) => {
  if (error instanceof ConfigStartupError) {
    // The message is already a pre-formatted human-friendly banner — print
    // it verbatim and exit 1 without dumping a node stack trace.
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  logger.error('Failed to start server:', error);
  process.exit(1);
});
