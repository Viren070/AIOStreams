import app from './app.js';
import fs from 'fs/promises';
import path from 'path';

import {
  Env,
  createLogger,
  DB,
  UserRepository,
  logStartupInfo,
  logStartupFooter,
  Cache,
  FeatureControl,
  AnimeDatabase,
  ProwlarrAddon,
  TemplateManager,
  maskSensitiveInfo,
  constants,
  SeaDexDataset,
} from '@aiostreams/core';
import { randomBytes } from 'crypto';

const logger = createLogger('server');

async function initialiseDatabase() {
  try {
    await DB.getInstance().initialise(Env.DATABASE_URI, []);
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
    TemplateManager.loadTemplates();
  } catch (error) {
    logger.error('Failed to initialise templates:', error);
  }
}

function initialiseAuth() {
  if (Env.NZB_PROXY_PUBLIC_ENABLED) {
    Env.AIOSTREAMS_AUTH.set(
      constants.PUBLIC_NZB_PROXY_USERNAME,
      Env.AIOSTREAMS_AUTH.get(constants.PUBLIC_NZB_PROXY_USERNAME) ||
        randomBytes(32).toString('hex')
    );
    logger.info('AIOStreams Public NZB Proxy is enabled.', {
      username: constants.PUBLIC_NZB_PROXY_USERNAME,
      password: maskSensitiveInfo(
        Env.AIOSTREAMS_AUTH.get(constants.PUBLIC_NZB_PROXY_USERNAME) || ''
      ),
    });
  }
}

async function start() {
  try {
    logStartupInfo();
    await initialiseTemplates();
    await initialiseDatabase();
    await initialiseRedis();
    initialiseAnimeDatabase();
    initialiseSeaDexDataset();
    FeatureControl.initialise();
    await initialiseProwlarr();
    if (Env.PRUNE_MAX_DAYS >= 0) {
      startAutoPrune();
    }
    initialiseAuth();
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
