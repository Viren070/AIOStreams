import { DB } from '../db/db.js';
import { RedisClientType } from 'redis';
import { TransactionQueue } from '../db/queue.js';
import { Cache, Env, REDIS_PREFIX } from './index.js';
import { createLogger } from './logger.js';

const logger = createLogger('distributed-lock');
const lockPrefix = `${REDIS_PREFIX}lock:`;

export interface LockOptions {
  timeout?: number;
  ttl?: number;
  retryInterval?: number;
}

export interface LockResult<T> {
  result: T;
  cached: boolean;
}

interface StoredResult<T> {
  value?: T;
  error?: string;
}

export class DistributedLock {
  private static instance: DistributedLock;
  private redis: RedisClientType | null = null;
  private subRedis: RedisClientType | null = null;
  private initialised = false;
  private initialisePromise: Promise<void> | null = null;

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
      if (Env.REDIS_URI) {
        this.redis = Cache.getRedisClient();
        this.subRedis = this.redis.duplicate();
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
    return this.redis
      ? this.withRedisLock(key, fn, options)
      : this.withSqlLock(key, fn, options);
  }

  private async withRedisLock<T>(
    key: string,
    fn: () => Promise<T>,
    options: LockOptions
  ): Promise<LockResult<T>> {
    const { timeout = 30000, ttl = 60000 } = options;
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
        await this.redis!.publish(doneChannel, JSON.stringify(storedResult));
      } catch (e: any) {
        const errorResult: StoredResult<T> = { error: e.message || 'Error' };
        await this.redis!.publish(doneChannel, JSON.stringify(errorResult));
        throw e;
      } finally {
        if ((await this.redis!.get(redisKey)) === owner) {
          logger.debug(`Releasing redis lock for key: ${key}`);
          await this.redis!.del(redisKey);
        }
      }
      return { result, cached: false };
    }

    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout;

      const subscriber = (message: string) => {
        clearTimeout(timeoutId);
        this.subRedis!.unsubscribe(doneChannel);
        const storedResult: StoredResult<T> = JSON.parse(message);
        if (storedResult.error) {
          logger.warn(
            `Received error result for key: ${key} from lock holder.`
          );
          reject(new Error(storedResult.error));
        } else {
          logger.debug(`Received cached result for key: ${key} via pub/sub.`);
          resolve({ result: storedResult.value!, cached: true });
        }
      };

      this.subRedis!.subscribe(doneChannel, subscriber).catch(reject);

      timeoutId = setTimeout(() => {
        this.subRedis!.unsubscribe(doneChannel);
        const errorMessage = `Timed out waiting for redis lock on key: ${key}`;
        logger.error(errorMessage);
        reject(new Error(errorMessage));
      }, timeout);
    });
  }

  private async withSqlLock<T>(
    key: string,
    fn: () => Promise<T>,
    options: LockOptions
  ): Promise<LockResult<T>> {
    const db = DB.getInstance();
    const { timeout = 30000, ttl = 60000 } = options;
    const { retryInterval = db.isSQLite() ? 250 : 100 } = options;
    const owner = Math.random().toString(36).substring(2);
    const expiresAt = new Date(Date.now() + ttl);

    const tryAcquireLock = async () => {
      return TransactionQueue.getInstance().enqueue(async () => {
        const tx = await db.begin();
        try {
          await tx.execute(
            `DELETE FROM distributed_locks WHERE expires_at < ?`,
            [new Date()]
          );
          const existing = await tx.execute(
            `SELECT * FROM distributed_locks WHERE key = ?`,
            [key]
          );
          if (existing.rows.length === 0) {
            await tx.execute(
              `INSERT INTO distributed_locks (key, owner, expires_at) VALUES (?, ?, ?)`,
              [key, owner, expiresAt]
            );
            await tx.commit();
            logger.debug(`SQL lock acquired for key: ${key}`);
            return true;
          }
          await tx.rollback();
          return false;
        } catch (e) {
          await tx.rollback();
          throw e;
        }
      });
    };

    if (await tryAcquireLock()) {
      let result: T;
      try {
        result = await fn();

        // Atomically update the result using the transaction queue
        await TransactionQueue.getInstance().enqueue(async () => {
          const tx = await db.begin();
          try {
            await tx.execute(
              `UPDATE distributed_locks SET result = ? WHERE key = ? AND owner = ?`,
              [JSON.stringify({ value: result }), key, owner]
            );
            await tx.commit();
          } catch (e) {
            await tx.rollback();
            throw e;
          }
        });
      } catch (e: any) {
        // Atomically update the error using the transaction queue
        await TransactionQueue.getInstance().enqueue(async () => {
          const tx = await db.begin();
          try {
            await tx.execute(
              `UPDATE distributed_locks SET result = ? WHERE key = ? AND owner = ?`,
              [JSON.stringify({ error: e.message || 'Error' }), key, owner]
            );
            await tx.commit();
          } catch (err) {
            await tx.rollback();
            // We throw the original error, but log the transaction error
            logger.error(
              `Failed to write error result to lock for key ${key}:`,
              err
            );
          }
        });
        throw e;
      } finally {
        // This setTimeout is now safe because the update operation is complete.
        setTimeout(() => {
          logger.debug(`Releasing SQL lock for key: ${key}`);
          db.execute(
            `DELETE FROM distributed_locks WHERE key = ? AND owner = ?`,
            [key, owner]
          );
        }, 2000);
      }
      return { result, cached: false };
    }

    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const lock = await db.query(
        `SELECT result FROM distributed_locks WHERE key = ?`,
        [key]
      );
      if (lock.length > 0 && lock[0].result) {
        const storedResult: StoredResult<T> = JSON.parse(lock[0].result);
        if (storedResult.error) {
          logger.warn(`Polled error result for key: ${key} from SQL lock.`);
          throw new Error(storedResult.error);
        }
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
