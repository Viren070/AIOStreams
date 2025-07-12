import app from './app';

import {
  Env,
  createLogger,
  DB,
  UserRepository,
  logStartupInfo,
} from '@aiostreams/core';

const logger = createLogger('server');

async function initialiseDatabase() {
  try {
    await DB.getInstance().initialise(Env.DATABASE_URI, []);
    logger.info('Database initialised');
  } catch (error) {
    logger.error('Failed to initialise database:', error);
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

async function start() {
  try {
    await initialiseDatabase();
    if (Env.PRUNE_MAX_DAYS >= 0) {
      startAutoPrune();
    }
    logStartupInfo();
    app.listen(Env.PORT, () => {
      logger.info(`Server running on port ${Env.PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  await DB.getInstance().close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  await DB.getInstance().close();
  process.exit(0);
});

start().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});
