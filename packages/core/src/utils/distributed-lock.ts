import { config as appConfig } from '../config/index.js';
import { getDb } from '../db/db.js';
import { sql } from '../db/sql.js';
import { RedisClientType } from 'redis';
import { Cache, REDIS_PREFIX } from './index.js';
import { createLogger } from '../logging/logger.js';
import { Time } from './time.js';
import {
  registerLockErrorClass,
  resolveErrorCtor,
} from './lock-error-registry.js';
import fs from 'fs/promises';
import path from 'path';

export { registerLockErrorClass, resolveErrorCtor };

const logger = createLogger('distributed-lock');
const lockPrefix = `${REDIS_PREFIX}lock:`;

export interface LockOptions {
  timeout?: number;
  ttl?: number;
  retryInterval?: number;
  type?: 'memory' | 'sql' | 'redis' | 'file';
  lockDir?: string; // Required for file-based locks
}

export interface LockResult<T> {
  result: T;
  cached: boolean;
}

interface StoredResult<T> {
  value?: T;
  error?: Error;
}

const warnedUnregisteredClasses = new Set<string>();

// message/name are non-enumerable, so flatten Errors into a revivable,
// class-tagged object before JSON.stringify drops them.
export function flattenError(err: Error) {
  const className = err.constructor?.name;
  if (
    className &&
    className !== 'Error' &&
    !resolveErrorCtor(className) &&
    !warnedUnregisteredClasses.has(className)
  ) {
    warnedUnregisteredClasses.add(className);
    logger.warn(
      `Error class '${className}' crossed a distributed lock without being registered via registerLockErrorClass - a waiter reviving it will get a plain Error instead, so any 'instanceof ${className}' check downstream will silently fail for concurrent duplicate requests.`
    );
  }
  const flat: Record<string, unknown> = {
    __lockError: true,
    className,
    name: err.name,
    message: err.message,
  };
  for (const [k, v] of Object.entries(err)) {
    // cause may hold a non-JSON-safe SDK error (circular refs) - drop it,
    // and never let a field clobber a protocol key.
    if (k !== 'cause' && k !== '__lockError' && k !== 'className') {
      flat[k] = v;
    }
  }
  return flat;
}

export function stringifyLockResult(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, val) =>
      val instanceof Error ? flattenError(val) : val
    );
  } catch (e: any) {
    // e.g. an unanticipated circular field - must not crash the lock.
    logger.error(
      `Failed to serialize lock result, falling back to a minimal error: ${e.message}`
    );
    return JSON.stringify({
      error: flattenError(new Error('Unserializable lock result')),
    });
  }
}

export function parseLockResult<T>(json: string): T {
  return JSON.parse(json, (_key, val) => {
    if (!val || typeof val !== 'object' || !val.__lockError) return val;
    const ctor = resolveErrorCtor(val.className);
    const err = (ctor ? Object.create(ctor.prototype) : new Error()) as Error;
    for (const [k, v] of Object.entries(val)) {
      if (k === '__lockError' || k === 'className') continue;
      // avoids throwing on getter-only accessors, e.g. DOMException.prototype.name
      Object.defineProperty(err, k, {
        value: v,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return err;
  });
}

export class DistributedLock {
  private static instance: DistributedLock;
  private redis: RedisClientType | null = null;
  private subRedis: RedisClientType | null = null;
  private initialised = false;
  private initialisePromise: Promise<void> | null = null;

  // In-memory lock storage
  private memoryLocks: Map<
    string,
    {
      owner: string;
      expiresAt: number;
      result?: any;
      error?: Error;
      waiters: Array<{
        resolve: (result: any) => void;
        reject: (error: Error) => void;
      }>;
    }
  > = new Map();

  private constructor() {}

  static getInstance(): DistributedLock {
    if (!this.instance) {
      this.instance = new DistributedLock();
    }
    return this.instance;
  }

  async initialise(): Promise<void> {
    if (this.initialised) return;
    if (this.initialisePromise) {
      await this.initialisePromise;
      return;
    }
    this.initialisePromise = (async () => {
      if (appConfig.bootstrap.redisUri) {
        this.redis = Cache.getRedisClient();
        this.subRedis = this.redis.duplicate();

        this.subRedis.on('error', (err: any) => {
          logger.error(`Redis subscriber client error: ${err.message || err}`);
        });

        this.subRedis.on('reconnecting', () => {
          logger.warn('Redis subscriber client reconnecting');
        });

        this.subRedis.on('end', () => {
          logger.warn('Redis subscriber connection closed');
        });

        await this.subRedis.connect();
        logger.debug('DistributedLock initialised with Redis backend.');
      } else {
        logger.debug('DistributedLock initialised with SQL backend.');
      }
      this.initialised = true;
    })();
    await this.initialisePromise;
  }

  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    options: LockOptions = {}
  ): Promise<LockResult<T>> {
    await this.initialise();

    if (options.type === 'memory') {
      return this.withMemoryLock(key, fn, options);
    }

    if (options.type === 'file') {
      return this.withFileLock(key, fn, options);
    }

    return this.redis && options.type !== 'sql'
      ? this.withRedisLock(key, fn, options)
      : this.withSqlLock(key, fn, options);
  }

  private async withRedisLock<T>(
    key: string,
    fn: () => Promise<T>,
    options: LockOptions
  ): Promise<LockResult<T>> {
    const { timeout = 30 * Time.Second, ttl = Time.Minute } = options;
    const owner = Math.random().toString(36).substring(2);
    const redisKey = `${lockPrefix}${key}`;
    const doneChannel = `${redisKey}:done`;

    const acquireLock = async (): Promise<boolean> => {
      const result = await this.redis!.set(redisKey, owner, {
        PX: ttl,
        NX: true,
      });
      return result === 'OK';
    };

    if (await acquireLock()) {
      logger.debug(`Redis lock acquired for key: ${key}`);
      let result: T;
      try {
        result = await fn();
        const storedResult: StoredResult<T> = { value: result };
        await this.redis!.publish(
          doneChannel,
          stringifyLockResult(storedResult)
        );
      } catch (e: any) {
        const errorResult: StoredResult<T> = { error: e };
        await this.redis!.publish(
          doneChannel,
          stringifyLockResult(errorResult)
        );
        throw e;
      } finally {
        if ((await this.redis!.get(redisKey)) === owner) {
          logger.debug(`Releasing redis lock for key: ${key}`);
          await this.redis!.del(redisKey);
        }
      }
      return { result, cached: false };
    }

    // Waiter logic
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout;

      const cleanup = () => {
        clearTimeout(timeoutId);
        this.subRedis!.unsubscribe(doneChannel).catch((e) =>
          logger.error(`Error during unsubscribe: ${e.message}`)
        );
      };

      const subscriber = (message: string) => {
        cleanup();
        const storedResult: StoredResult<T> = parseLockResult(message);
        if (storedResult.error) {
          logger.warn(
            `Received error result for key: ${key} from lock holder.`
          );
          reject(storedResult.error);
        } else {
          logger.debug(`Received cached result for key: ${key} via pub/sub.`);
          resolve({ result: storedResult.value!, cached: true });
        }
      };

      const onTimeout = () => {
        cleanup();
        const errorMessage = `Timed out waiting for redis lock on key: ${key}`;
        logger.error(errorMessage);
        reject(new Error(errorMessage));
      };

      this.subRedis!.subscribe(doneChannel, subscriber)
        .then(() => {
          timeoutId = setTimeout(onTimeout, timeout);
          // Double-check the lock's existence to handle race conditions.
          this.redis!.get(redisKey)
            .then((lockValue) => {
              if (lockValue === null) {
                logger.warn(
                  `Lock for key ${key} was released before subscription completed. Timing out.`
                );
                onTimeout();
              }
            })
            .catch((err) => {
              cleanup();
              reject(err);
            });
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  private async withMemoryLock<T>(
    key: string,
    fn: () => Promise<T>,
    options: LockOptions
  ): Promise<LockResult<T>> {
    const { timeout = 30 * Time.Second, ttl = Time.Minute } = options;
    const owner = Math.random().toString(36).substring(2);

    // Clean up expired locks
    const now = Date.now();
    for (const [lockKey, lock] of this.memoryLocks.entries()) {
      if (lock.expiresAt < now) {
        this.memoryLocks.delete(lockKey);
      }
    }

    const existingLock = this.memoryLocks.get(key);

    // Try to acquire the lock
    if (!existingLock || existingLock.expiresAt < now) {
      logger.debug(`Memory lock acquired for key: ${key}`);

      const lock: {
        owner: string;
        expiresAt: number;
        result?: T;
        error?: Error;
        waiters: Array<{
          resolve: (result: any) => void;
          reject: (error: Error) => void;
        }>;
      } = {
        owner,
        expiresAt: now + ttl,
        waiters: [],
      };
      this.memoryLocks.set(key, lock);

      let result: T;
      try {
        result = await fn();
        lock.result = result;
        lock.waiters.forEach(({ resolve }) =>
          resolve({ result, cached: true })
        );
        lock.waiters = [];
      } catch (e: any) {
        lock.error = e instanceof Error ? e : new Error(String(e));

        lock.waiters.forEach(({ reject }) => reject(lock.error!));
        lock.waiters = [];

        throw e;
      } finally {
        setTimeout(() => {
          logger.debug(`Releasing memory lock for key: ${key}`);
          this.memoryLocks.delete(key);
        }, 2000);
      }

      return { result, cached: false };
    }

    // Wait for the lock holder to finish
    return new Promise<LockResult<T>>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const errorMessage = `Timed out waiting for memory lock on key: ${key}`;
        logger.error(errorMessage);

        // Remove this waiter from the list
        const lock = this.memoryLocks.get(key);
        if (lock) {
          const waiterIndex = lock.waiters.findIndex(
            (w) => w.resolve === waiterResolve
          );
          if (waiterIndex > -1) {
            lock.waiters.splice(waiterIndex, 1);
          }
        }

        reject(new Error(errorMessage));
      }, timeout);

      const waiterResolve = (lockResult: LockResult<T>) => {
        clearTimeout(timeoutId);
        logger.debug(
          `Received cached result for key: ${key} from memory lock.`
        );
        resolve(lockResult);
      };

      const waiterReject = (error: Error) => {
        clearTimeout(timeoutId);
        logger.warn(
          `Received error result for key: ${key} from memory lock holder.`
        );
        reject(error);
      };

      if (existingLock.result !== undefined) {
        waiterResolve({ result: existingLock.result, cached: true });
      } else if (existingLock.error) {
        waiterReject(existingLock.error);
      } else {
        existingLock.waiters.push({
          resolve: waiterResolve,
          reject: waiterReject,
        });
      }
    });
  }

  private async withFileLock<T>(
    key: string,
    fn: () => Promise<T>,
    options: LockOptions
  ): Promise<LockResult<T>> {
    const {
      timeout = 30 * Time.Second,
      ttl = 5 * Time.Minute,
      lockDir,
    } = options;

    if (!lockDir) {
      throw new Error('lockDir is required for file-based locks');
    }

    const owner = Math.random().toString(36).substring(2);
    const lockPath = path.join(lockDir, `${key}.lock`);
    const STALE_TIMEOUT = ttl;

    const acquireLock = async (): Promise<boolean> => {
      try {
        // Check if lock file exists
        const lockExists = await fs
          .access(lockPath)
          .then(() => true)
          .catch(() => false);

        if (lockExists) {
          // Check if lock is stale
          const stats = await fs.stat(lockPath);
          const lockAge = Date.now() - stats.mtimeMs;

          if (lockAge > STALE_TIMEOUT) {
            logger.warn(
              `Stale file lock detected for key ${key} (${Math.round(lockAge / 1000)}s old), removing...`
            );
            await fs.unlink(lockPath).catch(() => {});
          } else {
            logger.debug(
              `File lock exists for key ${key} (${Math.round(lockAge / 1000)}s old), another process is syncing`
            );
            return false;
          }
        }

        // Try to create lock file (atomic operation)
        await fs.mkdir(path.dirname(lockPath), { recursive: true });
        await fs.writeFile(
          lockPath,
          JSON.stringify({
            owner,
            pid: process.pid,
            timestamp: Date.now(),
          }),
          { flag: 'wx' } // Fail if file exists
        );

        return true;
      } catch (error: any) {
        if (error.code === 'EEXIST') {
          logger.debug(`File lock for key ${key} created by another process`);
          return false;
        }
        logger.error(`Error acquiring file lock for key ${key}:`, error);
        return false;
      }
    };

    const releaseLock = async () => {
      try {
        await fs.unlink(lockPath);
        logger.debug(`Released file lock for key: ${key}`);
      } catch (error) {
        logger.debug(
          `Error releasing file lock for key ${key} (may already be released):`,
          error
        );
      }
    };

    const runHolder = async (): Promise<LockResult<T>> => {
      logger.debug(`File lock acquired for key: ${key}`);
      try {
        return { result: await fn(), cached: false };
      } finally {
        await releaseLock();
      }
    };

    if (await acquireLock()) return runHolder();

    logger.debug(
      `Waiting for file lock on key ${key} to be released by another process...`
    );

    const retryInterval = options.retryInterval || 500;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, retryInterval));

      const stats = await fs.stat(lockPath).catch(() => null);
      if (!stats) {
        logger.debug(`File lock released for key ${key}`);
        return { result: undefined as T, cached: true };
      }
      // Only an acquirer clears a stale lock, so a waiter that never re-tries
      // waits out the whole timeout behind a holder that died.
      if (Date.now() - stats.mtimeMs > STALE_TIMEOUT && (await acquireLock())) {
        return runHolder();
      }
    }

    const errorMessage = `Timed out waiting for file lock on key: ${key}`;
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }

  private async withSqlLock<T>(
    key: string,
    fn: () => Promise<T>,
    options: LockOptions
  ): Promise<LockResult<T>> {
    const db = getDb();
    const {
      timeout = 30 * Time.Second,
      ttl = Time.Minute,
      retryInterval = 100,
    } = options;
    const owner = Math.random().toString(36).substring(2);
    const expiresAt = Date.now() + ttl;

    const tryAcquireLock = async (): Promise<boolean> => {
      return db.tx(async (tx) => {
        await tx.exec(
          sql`DELETE FROM distributed_locks WHERE expires_at < ${Date.now()}`
        );

        // ON CONFLICT (...) DO NOTHING works on both SQLite (3.24+) and
        // Postgres. The driver's `rowCount` is normalized.
        const result = await tx.exec(
          sql`INSERT INTO distributed_locks (key, owner, expires_at)
              VALUES (${key}, ${owner}, ${expiresAt})
              ON CONFLICT (key) DO NOTHING`
        );
        const acquired = result.rowCount > 0;
        if (acquired) {
          logger.debug(`SQL lock acquired for key: ${key}`);
        }
        return acquired;
      });
    };

    if (await tryAcquireLock()) {
      let result: T;
      try {
        result = await fn();

        await db.exec(
          sql`UPDATE distributed_locks
              SET result = ${stringifyLockResult({ value: result })}
              WHERE key = ${key} AND owner = ${owner}`
        );
      } catch (e: any) {
        try {
          const errorEntry: StoredResult<T> = { error: e };
          await db.exec(
            sql`UPDATE distributed_locks
                SET result = ${stringifyLockResult(errorEntry)}
                WHERE key = ${key} AND owner = ${owner}`
          );
        } catch (err) {
          logger.error(
            `Failed to write error result to lock for key ${key}:`,
            err
          );
        }
        throw e;
      } finally {
        // Delay release so waiters have time to read the result.
        setTimeout(() => {
          logger.debug(`Releasing SQL lock for key: ${key}`);
          db.exec(
            sql`DELETE FROM distributed_locks WHERE key = ${key} AND owner = ${owner}`
          ).catch(() => undefined);
        }, 2000);
      }
      return { result, cached: false };
    }

    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const lockRow = await db.maybeOne<{ result: string | null }>(
        sql`SELECT result FROM distributed_locks WHERE key = ${key}`
      );
      if (lockRow && lockRow.result) {
        const storedResult: StoredResult<T> = parseLockResult(lockRow.result);
        if (storedResult.error) {
          logger.warn(`Polled error result for key: ${key} from SQL lock.`);
          throw storedResult.error;
        }
        logger.debug(`Polled cached result for key: ${key} from SQL lock.`);
        return { result: storedResult.value!, cached: true };
      }
      await new Promise((res) => setTimeout(res, retryInterval));
    }
    const errorMessage = `Timed out waiting for SQL lock on key: ${key}`;
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }

  async close(): Promise<void> {
    if (this.subRedis) {
      await this.subRedis.quit();
    }
    this.initialised = false;
    this.initialisePromise = null;
  }
}
