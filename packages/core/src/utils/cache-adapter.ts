import { RedisClientType } from 'redis';
import { REDIS_PREFIX, Env } from './index.js';
import { createLogger, getTimeTakenSincePoint } from './logger.js';
import { DB } from '../db/db.js';
import { withTimeout } from './general.js';

const logger = createLogger('cache');

const REDIS_TIMEOUT = Env.REDIS_TIMEOUT;

// Interface that both memory and Redis cache will implement
export interface CacheBackend<K, V> {
  get(key: K, updateTTL?: boolean): Promise<V | undefined>;
  set(key: K, value: V, ttl: number, forceWrite?: boolean): Promise<void>;
  delete(key: K): Promise<boolean>;
  update(key: K, value: V): Promise<void>;
  clear(): Promise<void>;
  getTTL(key: K): Promise<number>;
  waitUntilReady(): Promise<void>;
}

// Memory cache implementation
export class MemoryCacheBackend<K, V> implements CacheBackend<K, V> {
  private cache: Map<K, CacheItem<V>>;
  private maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map<K, CacheItem<V>>();
    this.maxSize = maxSize;
  }

  async get(key: K, updateTTL: boolean = false): Promise<V | undefined> {
    const item = this.cache.get(key);
    if (item) {
      const now = Date.now();
      item.lastAccessed = now;
      if (now - item.createdAt > item.ttl) {
        this.cache.delete(key);
        return undefined;
      }
      if (updateTTL) {
        item.createdAt = now;
      }

      return structuredClone(item.value);
    }
    return undefined;
  }

  async set(
    key: K,
    value: V,
    ttl: number,
    forceWrite?: boolean
  ): Promise<void> {
    if (this.cache.size >= this.maxSize) {
      this.evict();
    }
    this.cache.set(
      key,
      new CacheItem<V>(
        structuredClone(value),
        Date.now(),
        Date.now(),
        ttl * 1000
      )
    );
  }

  async update(key: K, value: V): Promise<void> {
    const item = this.cache.get(key);
    if (item) {
      item.value = value;
    }
  }

  async delete(key: K): Promise<boolean> {
    return this.cache.delete(key);
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  async getTTL(key: K): Promise<number> {
    const item = this.cache.get(key);
    if (item) {
      return Math.max(
        0,
        Math.floor((item.createdAt + item.ttl - Date.now()) / 1000)
      );
    }
    return 0;
  }

  private evict(): void {
    let oldestKey: K | undefined;
    let oldestTime = Infinity;

    for (const [key, item] of this.cache.entries()) {
      if (item.lastAccessed < oldestTime) {
        oldestTime = item.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey !== undefined) {
      this.cache.delete(oldestKey);
    }
  }

  getSize(): number {
    return this.cache.size;
  }

  getMemoryUsageEstimate(): number {
    let totalSize = 0;
    for (const item of this.cache.values()) {
      try {
        totalSize += Buffer.byteLength(JSON.stringify(item), 'utf8');
      } catch (e) {
        // In case of circular references
      }
    }
    return totalSize;
  }

  async waitUntilReady(): Promise<void> {
    return Promise.resolve();
  }
}

// Redis cache implementation with timeout handling
export class RedisCacheBackend<K, V> implements CacheBackend<K, V> {
  private client: RedisClientType;
  private prefix: string;
  private maxSize: number;
  private timeout: number;

  private static writeBuffer: Map<string, { value: any; ttl: number }> =
    new Map();
  private static flushInterval: NodeJS.Timeout | null = null;
  private static isFlushing: boolean = false;
  private static batchSize: number = 100;
  private static flushIntervalTime: number = 2000;
  private static clientRef: RedisClientType | null = null;
  private static timeoutRef: number = REDIS_TIMEOUT;

  constructor(
    redisClient: RedisClientType,
    prefix: string = REDIS_PREFIX,
    maxSize: number = Env.DEFAULT_MAX_CACHE_SIZE,
    timeout: number = REDIS_TIMEOUT
  ) {
    this.client = redisClient;
    this.prefix = prefix;
    this.maxSize = maxSize;
    this.timeout = timeout;

    // Store client reference for static operations
    RedisCacheBackend.clientRef = redisClient;
    RedisCacheBackend.timeoutRef = timeout;

    RedisCacheBackend.startFlushInterval();
  }

  private getKey(key: K): string {
    return `${REDIS_PREFIX}${this.prefix}${String(key)}`;
  }

  private static startFlushInterval() {
    if (RedisCacheBackend.flushInterval !== null) return;
    RedisCacheBackend.flushInterval = setInterval(() => {
      RedisCacheBackend.flushWriteBuffer();
    }, RedisCacheBackend.flushIntervalTime);
  }

  async get(key: K, updateTTL: boolean = false): Promise<V | undefined> {
    const redisKey = this.getKey(key);

    return withTimeout(
      async () => {
        const data = await this.client.get(redisKey);
        if (!data) return undefined;

        if (updateTTL) {
          // Update TTL if requested
          const ttl = await this.client.ttl(redisKey);
          if (ttl > 0) {
            await this.client.expire(redisKey, ttl);
          }
        }

        return JSON.parse(data) as V;
      },
      undefined,
      {
        timeout: this.timeout,
        shouldProceed: () => this.client.isOpen,
        getContext: () => `getting key ${String(key)} from Redis`,
      }
    );
  }

  async set(
    key: K,
    value: V,
    ttl: number,
    forceWrite?: boolean
  ): Promise<void> {
    if (ttl === 0) return;
    const redisKey = this.getKey(key);
    RedisCacheBackend.writeBuffer.set(redisKey, {
      value: JSON.stringify(value),
      ttl,
    });

    if (RedisCacheBackend.writeBuffer.size >= RedisCacheBackend.batchSize) {
      RedisCacheBackend.flushWriteBuffer();
    } else if (forceWrite) {
      await RedisCacheBackend.flushWriteBuffer();
    }
  }

  private static async flushWriteBuffer(): Promise<void> {
    if (
      RedisCacheBackend.isFlushing ||
      RedisCacheBackend.writeBuffer.size === 0
    )
      return;

    RedisCacheBackend.isFlushing = true;

    const bufferToFlush = new Map(RedisCacheBackend.writeBuffer);
    RedisCacheBackend.writeBuffer.clear();

    if (!RedisCacheBackend.clientRef) {
      logger.error(
        'Cannot flush Redis write buffer - no client reference available'
      );
      RedisCacheBackend.isFlushing = false;
      return;
    }

    const start = Date.now();

    const pipeline = RedisCacheBackend.clientRef.multi();
    for (const [key, item] of bufferToFlush.entries()) {
      pipeline.set(key, item.value, { EX: item.ttl });
    }

    try {
      await withTimeout(
        async () => {
          await pipeline.exec();
        },
        undefined,
        {
          timeout: RedisCacheBackend.timeoutRef,
          shouldProceed: () => RedisCacheBackend.clientRef?.isOpen ?? false,
          getContext: () => 'flushing Redis write buffer',
        }
      );
      logger.debug('Flushed Redis write buffer', {
        items: bufferToFlush.size,
        time: getTimeTakenSincePoint(start),
      });
    } catch (err) {
      logger.error(`Error flushing Redis write buffer: ${err}`);
    } finally {
      RedisCacheBackend.isFlushing = false;
    }
  }

  async update(key: K, value: V): Promise<void> {
    const redisKey = this.getKey(key);

    await withTimeout(
      async () => {
        // Get current TTL
        const ttl = await this.client.ttl(redisKey);
        if (ttl <= 0) return false; // Key doesn't exist or has no TTL

        // Update value but keep the same TTL
        await this.client.set(redisKey, JSON.stringify(value), {
          EX: ttl,
        });
        return true;
      },
      false,
      {
        timeout: this.timeout,
        shouldProceed: () => this.client.isOpen,
        getContext: () => `updating key ${String(key)} in Redis`,
      }
    );
  }

  async delete(key: K): Promise<boolean> {
    const redisKey = this.getKey(key);

    return withTimeout<boolean>(
      async () => {
        const result = await this.client.del(redisKey);
        return result > 0;
      },
      false,
      {
        timeout: this.timeout,
        shouldProceed: () => this.client.isOpen,
        getContext: () => `deleting key ${String(key)} from Redis`,
      }
    );
  }

  async clear(): Promise<void> {
    await withTimeout(
      async () => {
        // Delete all keys with this prefix
        const keys = await this.client.keys(`${this.prefix}*`);
        if (keys && keys.length > 0) {
          await this.client.del(keys);
        }
        return true;
      },
      false,
      {
        timeout: this.timeout,
        shouldProceed: () => this.client.isOpen,
        getContext: () => 'clearing Redis cache',
      }
    );
  }

  async getTTL(key: K): Promise<number> {
    return withTimeout(
      async () => {
        const ttl = await this.client.ttl(this.getKey(key));
        return ttl > 0 ? ttl : 0;
      },
      0,
      {
        timeout: this.timeout,
        shouldProceed: () => this.client.isOpen,
        getContext: () => `getting TTL for key ${String(key)} from Redis`,
      }
    );
  }

  async waitUntilReady(): Promise<void> {
    while (!this.client.isOpen) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

// SQL cache implementation
export class SQLCacheBackend<K, V> implements CacheBackend<K, V> {
  private db: DB;
  private prefix: string;
  static maintenanceStarted: boolean = false;

  private static writeBuffer: Map<string, { value: any; ttl: number }> =
    new Map();
  private static flushInterval: NodeJS.Timeout | null = null;
  private static isFlushing: boolean = false;
  private static batchSize: number = 100;
  private static flushIntervalTime: number = 2000;

  constructor(prefix: string = '', _: number) {
    this.db = DB.getInstance();
    this.prefix = prefix;
    this.startMaintenance();
    SQLCacheBackend.startFlushInterval();
  }

  private static startFlushInterval() {
    if (SQLCacheBackend.flushInterval !== null) return;
    SQLCacheBackend.flushInterval = setInterval(() => {
      SQLCacheBackend.flushWriteBuffer();
    }, SQLCacheBackend.flushIntervalTime);
  }

  private static async flushWriteBuffer() {
    if (SQLCacheBackend.isFlushing || SQLCacheBackend.writeBuffer.size === 0)
      return;

    SQLCacheBackend.isFlushing = true;

    const bufferToFlush = new Map(SQLCacheBackend.writeBuffer);
    SQLCacheBackend.writeBuffer.clear();

    const db = DB.getInstance();

    const start = Date.now();

    try {
      const countResult = await db.query('SELECT COUNT(*) as count FROM cache');
      let currentSize = Number(countResult[0].count);
      let overflow = currentSize + bufferToFlush.size - Env.SQL_CACHE_MAX_SIZE;
      if (overflow > 0) {
        const removed = await SQLCacheBackend.flushStaleEntries(db);
        logger.debug(
          `Removed ${removed} stale entries from SQL cache during flush.`
        );
        currentSize -= removed;
        overflow -= removed;
      }

      if (overflow > 0) {
        logger.debug(`Cache overflow detected. Evicting ${overflow} items.`);
        const limit = Math.ceil(overflow);
        if (db.isSQLite()) {
          await db.execute(
            `DELETE FROM cache WHERE key IN (SELECT key FROM cache ORDER BY last_accessed ASC LIMIT ${limit})`
          );
        } else {
          await db.execute(
            `DELETE FROM cache WHERE ctid IN (SELECT ctid FROM cache ORDER BY last_accessed ASC LIMIT ${limit})`
          );
        }
      }

      // Prepare for batch upsert
      const values: any[] = [];
      const now = Date.now();
      for (const [key, item] of bufferToFlush.entries()) {
        values.push(key, JSON.stringify(item.value), now + item.ttl * 1000);
      }

      if (values.length === 0) return;

      if (db.isSQLite()) {
        const placeholders = Array(bufferToFlush.size)
          .fill('(?, ?, ?)')
          .join(', ');
        const sql = `INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES ${placeholders}`;
        await db.execute(sql, values);
      } else {
        const placeholders = Array(bufferToFlush.size)
          .fill('(?, ?, ?)')
          .join(', ');
        const timestampFunc = 'NOW()';
        const sql = `INSERT INTO cache (key, value, expires_at) VALUES ${placeholders} ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at, last_accessed = ${timestampFunc}`;
        await db.execute(sql, values);
      }
      logger.debug('Flushed SQL write buffer', {
        items: bufferToFlush.size,
        time: getTimeTakenSincePoint(start),
      });
    } catch (err) {
      logger.error(`Error flushing SQL cache write buffer: ${err}`);
      for (const [key, value] of bufferToFlush.entries()) {
        this.writeBuffer.set(key, value);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  private static async flushStaleEntries(db: DB): Promise<number> {
    return db
      .execute('DELETE FROM cache WHERE expires_at < ?', [Date.now()])
      .then((result) => {
        const count = result.changed || result.rowCount || 0;
        if (Number.isFinite(count)) return count;
        return 0;
      });
  }

  private startMaintenance() {
    if (SQLCacheBackend.maintenanceStarted) return;
    logger.debug('Starting SQL cache maintenance');
    SQLCacheBackend.maintenanceStarted = true;
    setInterval(
      () => {
        SQLCacheBackend.flushStaleEntries(this.db)
          .then((removed) =>
            logger.debug(`${removed} stale entries removed from SQL cache`)
          )
          .catch((err) => {
            logger.error(`Error during SQL cache maintenance: ${err}`);
          });
      },
      1 * 60 * 60 * 1000 // hourly
    );
  }

  private getKey(key: K): string {
    return `${this.prefix}${String(key)}`;
  }

  async get(key: K, updateTTL: boolean = false): Promise<V | undefined> {
    const sqlKey = this.getKey(key);
    const now = Date.now();

    try {
      // Get the value and check expiration
      const result = await this.db.query(
        'SELECT value, expires_at FROM cache WHERE key = ?',
        [sqlKey]
      );

      if (!result.length) {
        return undefined;
      }

      const row = result[0];
      if (now > row.expires_at) {
        // Remove expired entry
        await this.db.execute('DELETE FROM cache WHERE key = ?', [sqlKey]);
        return undefined;
      }

      if (updateTTL) {
        const ttl = Math.max(0, row.expires_at - now);
        const timestampFunc = this.db.isSQLite()
          ? 'CURRENT_TIMESTAMP'
          : 'NOW()';
        await this.db.execute(
          `UPDATE cache SET expires_at = ?, last_accessed = ${timestampFunc} WHERE key = ?`,
          [now + ttl, sqlKey]
        );
      } else {
        const timestampFunc = this.db.isSQLite()
          ? 'CURRENT_TIMESTAMP'
          : 'NOW()';
        await this.db.execute(
          `UPDATE cache SET last_accessed = ${timestampFunc} WHERE key = ?`,
          [sqlKey]
        );
      }

      return JSON.parse(row.value) as V;
    } catch (err) {
      logger.error(`Error getting key ${String(key)} from SQL cache: ${err}`);
      return undefined;
    }
  }

  async set(
    key: K,
    value: V,
    ttl: number,
    forceWrite?: boolean
  ): Promise<void> {
    if (ttl === 0) return;

    const sqlKey = this.getKey(key);
    SQLCacheBackend.writeBuffer.set(sqlKey, {
      value: structuredClone(value),
      ttl,
    });

    if (SQLCacheBackend.writeBuffer.size >= SQLCacheBackend.batchSize) {
      SQLCacheBackend.flushWriteBuffer();
    } else if (forceWrite) {
      await SQLCacheBackend.flushWriteBuffer();
    }
  }

  async update(key: K, value: V): Promise<void> {
    const sqlKey = this.getKey(key);

    try {
      const result = await this.db.query(
        'SELECT expires_at FROM cache WHERE key = ?',
        [sqlKey]
      );

      if (!result.length) return;

      const row = result[0];
      if (Date.now() > row.expires_at) {
        await this.db.execute('DELETE FROM cache WHERE key = ?', [sqlKey]);
        return;
      }

      const timestampFunc = this.db.isSQLite() ? 'CURRENT_TIMESTAMP' : 'NOW()';
      await this.db.execute(
        `UPDATE cache SET value = ?, last_accessed = ${timestampFunc} WHERE key = ?`,
        [JSON.stringify(value), sqlKey]
      );
    } catch (err) {
      logger.error(`Error updating key ${String(key)} in SQL cache: ${err}`);
    }
  }

  async delete(key: K): Promise<boolean> {
    const sqlKey = this.getKey(key);

    try {
      const result = await this.db.execute('DELETE FROM cache WHERE key = ?', [
        sqlKey,
      ]);
      return (result.changes || result.rowCount || 0) > 0;
    } catch (err) {
      logger.error(`Error deleting key ${String(key)} from SQL cache: ${err}`);
      return false;
    }
  }

  async clear(): Promise<void> {
    try {
      if (this.prefix) {
        await this.db.execute('DELETE FROM cache WHERE key LIKE ?', [
          `${this.prefix}%`,
        ]);
      } else {
        await this.db.execute('DELETE FROM cache');
      }
    } catch (err) {
      logger.error(`Error clearing SQL cache: ${err}`);
    }
  }

  async getTTL(key: K): Promise<number> {
    const sqlKey = this.getKey(key);
    const now = Date.now();

    try {
      const result = await this.db.query(
        'SELECT expires_at FROM cache WHERE key = ?',
        [sqlKey]
      );

      if (!result.length) return 0;

      const ttl = Math.max(0, Math.floor((result[0].expires_at - now) / 1000));
      return ttl;
    } catch (err) {
      logger.error(
        `Error getting TTL for key ${String(key)} from SQL cache: ${err}`
      );
      return 0;
    }
  }

  async waitUntilReady(): Promise<void> {
    if (!this.db.isInitialised()) {
      throw new Error('Database is not initialized');
    }
    return Promise.resolve();
  }
}

class CacheItem<T> {
  constructor(
    public value: T,
    public lastAccessed: number,
    public createdAt: number,
    public ttl: number // Time-To-Live in milliseconds
  ) {}
}
