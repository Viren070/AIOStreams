import { createLogger } from '../logging/logger.js';
import { config as appConfig } from '../config/index.js';

const logger = createLogger('startup');

export const logStartupInfo = () => {
  const currentTime = new Date().toISOString().replace('T', ' ').slice(0, 19);

  logger.info(
    '╔═══════════════════════════════════════════════════════════════╗'
  );
  logger.info(
    '║                    🚀 AIOStreams Starting                     ║'
  );
  logger.info(
    '╚═══════════════════════════════════════════════════════════════╝'
  );
  logger.info('');
  logger.info(
    `  Version:       ${appConfig.bootstrap.version} (${appConfig.bootstrap.tag})`
  );
  logger.info(`  Node Env:      ${appConfig.bootstrap.nodeEnv.toUpperCase()}`);
  logger.info(`  Git Commit:    ${appConfig.bootstrap.gitCommit.slice(0, 8)}`);
  logger.info(`  Build Time:    ${appConfig.bootstrap.buildTime}`);
  logger.info(`  Current Time:  ${currentTime} UTC`);
  logger.info(`  Node Version:  ${process.version}`);
  logger.info('');
  logger.info(
    `  Addon:         ${appConfig.branding.addonName} (${appConfig.branding.addonId})`
  );
  logger.info(`  Port:          ${appConfig.bootstrap.port}`);
  logger.info(`  Base URL:      ${appConfig.bootstrap.baseUrl || '(not set)'}`);
  logger.info('');

  const dbType = appConfig.bootstrap.databaseUri.split('://')[0].toUpperCase();
  const dbDisplay = appConfig.bootstrap.databaseUri.includes('sqlite')
    ? appConfig.bootstrap.databaseUri.replace('sqlite://', '') ||
      './data/db.sqlite'
    : appConfig.bootstrap.databaseUri.replace(/:\/\/[^@]+@/, '://***@');
  logger.info(`  Database:      ${dbType}  ${dbDisplay}`);
  if (appConfig.bootstrap.redisUri) {
    logger.info(
      `  Redis:         ${appConfig.bootstrap.redisUri.replace(/:\/\/[^@]+@/, '://***@')}`
    );
  }
  logger.info('');

  logger.info(`  Log Level:     ${appConfig.logging.logLevel.toUpperCase()}`);
  logger.info(`  Log Format:    ${appConfig.logging.logFormat.toUpperCase()}`);
  if (appConfig.logging.logSensitiveInfo) {
    logger.warn(
      '  Sensitive Info logging is ENABLED =€” disable in production'
    );
  }
  logger.info('');

  if (appConfig.bootstrap.auth) {
    logger.info(`  Auth:          Basic auth enabled`);
  }
  if (appConfig.api.authRequired) {
    logger.info(`  Auth Required: /stremio/configure requires login`);
  }
  logger.info('');

  logger.info(
    '  Runtime settings are viewable and editable at /dashboard/settings'
  );
  logger.info('');
};
