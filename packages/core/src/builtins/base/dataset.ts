import fs from 'fs/promises';
import path from 'path';
import type { Logger } from '../../logging/logger.js';
import { DistributedLock } from '../../utils/distributed-lock.js';
import { TaskManager, type TaskResult } from '../../tasks/index.js';

export interface BaseDatasetConfig {
  dataPath: string;
  refreshIntervalSeconds: number;
  lockTimeoutMs?: number;
  logger: Logger;
  taskId: string;
  taskLabel?: string;
  taskDescription?: string;
}

/**
 * Base class for file-backed datasets that periodically sync from a remote
 * source under a distributed lock. The TaskManager owns the schedule and
 * retry-on-failure timing (via `retryIntervalMs`); subclasses only implement
 * `performSync` (the actual fetch/write) and `reloadDataFromFile` (in-memory
 * cache refresh).
 */
export abstract class BaseDataset {
  protected readonly DATA_PATH: string;
  protected readonly LOCK_DIR: string;
  protected readonly LOCK_KEY: string;
  protected readonly REFRESH_INTERVAL_MS: number;
  protected readonly LOCK_TIMEOUT_MS: number;
  protected logger: Logger;

  protected initialisationPromise: Promise<void> | null = null;

  protected readonly taskId: string;
  protected readonly taskLabel?: string;
  protected readonly taskDescription?: string;

  constructor(config: BaseDatasetConfig) {
    this.DATA_PATH = config.dataPath;
    this.LOCK_DIR = path.dirname(config.dataPath);
    this.LOCK_KEY = path.basename(
      config.dataPath,
      path.extname(config.dataPath)
    );
    this.REFRESH_INTERVAL_MS = config.refreshIntervalSeconds * 1000;
    this.LOCK_TIMEOUT_MS = config.lockTimeoutMs ?? 300000; // 5 minutes
    this.logger = config.logger;
    this.taskId = config.taskId;
    this.taskLabel = config.taskLabel;
    this.taskDescription = config.taskDescription;
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
    this.registerSyncTask();

    const exists = await fs
      .access(this.DATA_PATH)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      this.logger.info('Dataset not found, starting initial sync...');
      await TaskManager.runNow(this.taskId);
      return;
    }

    try {
      await this.reloadDataFromFile();
      this.logger.info('Loaded dataset from file');
    } catch (error) {
      this.logger.error('Failed to load dataset, forcing resync...:', error);
      await TaskManager.runNow(this.taskId);
      return;
    }

    const stat = await fs.stat(this.DATA_PATH);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > this.REFRESH_INTERVAL_MS) {
      this.logger.info(
        `Dataset is stale (${Math.round(ageMs / 1000)}s old, interval: ${
          this.REFRESH_INTERVAL_MS / 1000
        }s), syncing now...`
      );
      await TaskManager.runNow(this.taskId);
    }
  }

  /**
   * Run a single sync attempt under the distributed lock and reload the
   * in-memory cache from the freshly-written file. Returns a `TaskResult` so
   * the TaskManager can apply its retry policy on failure.
   */
  private async runSync(): Promise<TaskResult> {
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
      return { ok: true, message: 'sync complete' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Dataset sync failed:', message);
      return { ok: false, message };
    }
  }

  private registerSyncTask(): void {
    TaskManager.register({
      id: this.taskId,
      label: this.taskLabel ?? this.taskId,
      description:
        this.taskDescription ??
        `Refresh dataset stored at ${path.basename(this.DATA_PATH)}`,
      category: 'data-sync',
      kind: 'scheduled',
      intervalMs: this.REFRESH_INTERVAL_MS,
      retryIntervalMs: Math.floor(this.REFRESH_INTERVAL_MS / 4),
      enabled: true,
      destructive: false,
      multiReplica: 'single',
      run: () => this.runSync(),
    });
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
