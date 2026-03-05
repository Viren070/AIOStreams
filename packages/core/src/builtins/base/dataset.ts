import fs from 'fs/promises';
import path from 'path';
import { Logger } from 'winston';
import { DistributedLock } from '../../utils/distributed-lock.js';

export interface BaseDatasetConfig {
  dataPath: string;
  refreshIntervalSeconds: number;
  maxSyncRetries?: number;
  lockTimeoutMs?: number;
  logger: Logger;
}

export abstract class BaseDataset {
  protected readonly DATA_PATH: string;
  protected readonly LOCK_DIR: string;
  protected readonly LOCK_KEY: string;
  protected readonly REFRESH_INTERVAL_MS: number;
  protected readonly MAX_SYNC_RETRIES: number;
  protected readonly LOCK_TIMEOUT_MS: number;
  protected logger: Logger;

  protected initialisationPromise: Promise<void> | null = null;
  protected refreshInterval: NodeJS.Timeout | null = null;
  protected syncRetryCount: number = 0;
  protected syncRetryTimeout: NodeJS.Timeout | null = null;

  constructor(config: BaseDatasetConfig) {
    this.DATA_PATH = config.dataPath;
    this.LOCK_DIR = path.dirname(config.dataPath);
    this.LOCK_KEY = path.basename(
      config.dataPath,
      path.extname(config.dataPath)
    );
    this.REFRESH_INTERVAL_MS = config.refreshIntervalSeconds * 1000;
    this.MAX_SYNC_RETRIES = config.maxSyncRetries ?? 1;
    this.LOCK_TIMEOUT_MS = config.lockTimeoutMs ?? 300000; // 5 minutes
    this.logger = config.logger;
  }

  public async initialise(): Promise<void> {
    if (this.initialisationPromise) {
      return this.initialisationPromise;
    }

    this.initialisationPromise = this.loadData().catch((err) => {
      this.logger.warn(
        'Initial dataset load failed, will retry in background:',
        err
      );
      throw err;
    });

    return this.initialisationPromise;
  }

  protected async loadData(): Promise<void> {
    const exists = await fs
      .access(this.DATA_PATH)
      .then(() => true)
      .catch(() => false);

    if (exists) {
      try {
        await this.reloadDataFromFile();
        this.logger.info('Loaded dataset from file');
        // Reset retry count on successful load
        this.syncRetryCount = 0;
      } catch (error) {
        this.logger.error('Failed to load dataset, forcing resync...:', error);
        await this.syncWithRetry();
      }
    } else {
      this.logger.info('Dataset not found, starting initial sync...');
      await this.syncWithRetry();
    }

    this.startSyncInterval();
  }

  protected async syncWithRetry(): Promise<void> {
    try {
      const lock = DistributedLock.getInstance();

      const { cached } = await lock.withLock(
        this.LOCK_KEY,
        async () => {
          this.logger.info('Starting dataset sync...');
          await this.performSync();
          this.logger.info('Dataset sync completed');
        },
        {
          type: 'file',
          lockDir: this.LOCK_DIR,
          timeout: this.LOCK_TIMEOUT_MS,
          ttl: this.LOCK_TIMEOUT_MS,
        }
      );

      if (cached) {
        this.logger.info(
          'Another process completed sync, loading data from file...'
        );
      }

      const fileExists = await fs
        .access(this.DATA_PATH)
        .then(() => true)
        .catch(() => false);

      if (fileExists) {
        await this.reloadDataFromFile();
        this.logger.info('Loaded dataset from file');
      }

      // Reset retry count on success
      this.syncRetryCount = 0;
    } catch (error) {
      this.syncRetryCount++;

      if (this.syncRetryCount <= this.MAX_SYNC_RETRIES) {
        this.logger.warn(
          `Sync failed (attempt ${this.syncRetryCount}/${this.MAX_SYNC_RETRIES}), retrying immediately...`
        );
        await this.syncWithRetry();
      } else {
        this.logger.error(
          `Sync failed after ${this.MAX_SYNC_RETRIES} retries. Will retry after quarter of refresh interval.`
        );
        this.scheduleRetrySync();
        throw error;
      }
    }
  }

  protected scheduleRetrySync(): void {
    if (this.syncRetryTimeout) {
      clearTimeout(this.syncRetryTimeout);
    }

    const retryDelay = Math.floor(this.REFRESH_INTERVAL_MS / 4);
    this.logger.info(
      `Scheduling sync retry in ${retryDelay / 1000} seconds...`
    );

    this.syncRetryTimeout = setTimeout(() => {
      this.syncWithRetry()
        .then(() => {
          this.logger.info('Sync retry succeeded');
          this.syncRetryCount = 0;
        })
        .catch((err: any) => {
          this.logger.error('Sync retry failed:', err);
          // Schedule another retry
          this.scheduleRetrySync();
        });
    }, retryDelay);
  }

  protected startSyncInterval() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    this.refreshInterval = setInterval(() => {
      this.syncWithRetry().catch((err) => {
        this.logger.error('Background sync failed:', err);
      });
    }, this.REFRESH_INTERVAL_MS);
  }

  /**
   * Perform the actual dataset sync. Must be implemented by subclasses.
   * This method is called within a distributed lock context.
   */
  protected abstract performSync(): Promise<void>;

  /**
   * Reload data from the persistent file. Must be implemented by subclasses.
   */
  protected abstract reloadDataFromFile(): Promise<void>;
}
