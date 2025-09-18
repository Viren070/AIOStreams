import app from './app.js';

import {
  Env,
  createLogger,
  DB,
  UserRepository,
  logStartupInfo,
  logStartupFooter,
  Cache,
  FeatureControl,
  PTT,
  AnimeDatabase,
} from '@aiostreams/core';

const logger = createLogger('server');

async function initialiseDatabase() {
  try {
    await DB.getInstance().initialise(Env.DATABASE_URI, []);
  } catch (error) {
    logger.error('Failed to initialise database:', error);
    throw error;
  }
}

async function initialisePTT() {
  try {
    await PTT.initialise();
  } catch (error) {
    logger.error('Failed to initialise PTT Server:', error);
    throw error;
  }
}

async function startAutoPrune() {
  try {
    if (Env.PRUNE_MAX_DAYS < 0) {
      return;
    }
    await UserRepository.pruneUsers(Env.PRUNE_MAX_DAYS);
  } catch {}
  setTimeout(startAutoPrune, Env.PRUNE_INTERVAL * 1000);
}

async function initialiseRedis() {
  if (Env.REDIS_URI) {
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

async function start() {
  try {
    logStartupInfo();
    await initialiseDatabase();
    await initialiseRedis();
    await initialisePTT();
    initialiseAnimeDatabase();
    FeatureControl.initialise();
    if (Env.PRUNE_MAX_DAYS >= 0) {
      startAutoPrune();
    }
    const server = app.listen(Env.PORT, (error) => {
      if (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
      }
      logger.info(
        `Server running on port ${Env.PORT}: ${JSON.stringify(server.address())}`
      );
      logStartupFooter();
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

async function shutdown() {
  await Cache.close();
  await PTT.cleanup();
  FeatureControl.cleanup();
  await DB.getInstance().close();
}

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
  logger.error('Failed to start server:', error);
  process.exit(1);
});
