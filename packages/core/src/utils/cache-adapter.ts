import { config as appConfig } from '../config/index.js';
import { RedisClientType } from 'redis';
import { REDIS_PREFIX } from './index.js';
import { createLogger } from '../logging/logger.js';
import { getTimeTakenSincePoint } from './time.js';
import { getDb } from '../db/db.js';
import type { DbDriver } from '../db/driver/types.js';
import { sql } from '../db/sql.js';
import { withTimeout } from './general.js';

const logger = createLogger('cache');

const REDIS_TIMEOUT = appConfig.bootstrap.redisTimeout;

// Interface that both memory and Redis cache will implement
export interface CacheBackend<K, V> {
  get(key: K, updateTTL?: boolean): Promise<V | undefined>;
  set(key: K, value: V, ttl: number, forceWrite?: boolean): Promise<void>;
  flush(): Promise<void>;
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

  async flush(): Promise<void> {
    // Memory writes are synchronous — nothing to flush
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
    maxSize: number = appConfig.resources.cache.defaultMaxSize,
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
        timeTaken: getTimeTakenSincePoint(start),
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
        // Delete all keys with this cache's prefix. Must include the global
        // `REDIS_PREFIX` because `getKey()` writes both, otherwise nothing
        // matches when REDIS_PREFIX is non-empty (the previous bug).
        //
        // SCAN instead of KEYS so a large keyspace doesn't block the Redis
        // event loop for the duration of the wipe — Redis serves other
        // commands between iterations.
        const pattern = `${REDIS_PREFIX}${this.prefix}*`;
        const batch: string[] = [];
        for await (const key of this.client.scanIterator({
          MATCH: pattern,
          COUNT: 500,
        })) {
          // node-redis v4 yields one key at a time; v5 yields chunks. Both
          // are handled by flattening Array.isArray to support either.
          if (Array.isArray(key)) batch.push(...key);
          else batch.push(key);
          if (batch.length >= 1000) {
            await this.client.del(batch.splice(0, batch.length));
          }
        }
        if (batch.length > 0) {
          await this.client.del(batch);
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

  async flush(): Promise<void> {
    await RedisCacheBackend.flushWriteBuffer();
  }
}

// SQL cache implementation
export class SQLCacheBackend<K, V> implements CacheBackend<K, V> {
  private prefix: string;
  static maintenanceStarted: boolean = false;

  private static writeBuffer: Map<string, { value: any; ttl: number }> =
    new Map();
  private static flushInterval: NodeJS.Timeout | null = null;
  private static isFlushing: boolean = false;
  private static batchSize: number = 100;
  private static flushIntervalTime: number = 2000;

  constructor(prefix: string = '', _: number) {
    this.prefix = prefix;
    this.startMaintenance();
    SQLCacheBackend.startFlushInterval();
  }

  private get db(): DbDriver {
    return getDb();
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

    let db: DbDriver;
    try {
      db = getDb();
    } catch (err) {
      // DB not yet ready — put items back and bail.
      for (const [key, value] of bufferToFlush.entries()) {
        SQLCacheBackend.writeBuffer.set(key, value);
      }
      SQLCacheBackend.isFlushing = false;
      return;
    }

    const start = Date.now();

    try {
      let currentSize = await db.count(
        sql`SELECT COUNT(*) AS count FROM cache`
      );
      let overflow =
        currentSize + bufferToFlush.size - appConfig.resources.cache.sqlMaxSize;
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
        // Works identically on SQLite and Postgres.
        await db.exec(
          sql`DELETE FROM cache WHERE key IN (
                SELECT key FROM cache ORDER BY last_accessed ASC LIMIT ${limit}
              )`
        );
      }

      if (bufferToFlush.size === 0) return;

      // Build a multi-row VALUES list and upsert. `ON CONFLICT ... DO
      // UPDATE` with `EXCLUDED` works identically on SQLite (3.24+) and
      // Postgres, so one query handles both dialects.
      const values: unknown[] = [];
      const placeholders: string[] = [];
      const now = Date.now();
      for (const [key, item] of bufferToFlush.entries()) {
        placeholders.push('(?, ?, ?)');
        values.push(key, JSON.stringify(item.value), now + item.ttl * 1000);
      }
      const valuesClause = placeholders.join(', ');

      await db.exec(
        `INSERT INTO cache (key, value, expires_at) VALUES ${valuesClause}
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value,
                 expires_at = EXCLUDED.expires_at,
                 last_accessed = CURRENT_TIMESTAMP`,
        values
      );

      logger.debug('Flushed SQL write buffer', {
        items: bufferToFlush.size,
        timeTaken: getTimeTakenSincePoint(start),
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

  private static async flushStaleEntries(db: DbDriver): Promise<number> {
    try {
      const result = await db.exec(
        sql`DELETE FROM cache WHERE expires_at < ${Date.now()}`
      );
      return result.rowCount;
    } catch {
      return 0;
    }
  }

  private startMaintenance() {
    if (SQLCacheBackend.maintenanceStarted) return;
    logger.debug('Starting SQL cache maintenance');
    SQLCacheBackend.maintenanceStarted = true;
    setInterval(
      () => {
        try {
          const db = getDb();
          SQLCacheBackend.flushStaleEntries(db)
            .then((removed) =>
              logger.debug(`${removed} stale entries removed from SQL cache`)
            )
            .catch((err) => {
              logger.error(`Error during SQL cache maintenance: ${err}`);
            });
        } catch {
          // DB not yet initialised — skip this tick.
        }
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
      const row = await this.db.maybeOne<{
        value: string;
        expires_at: number | string;
      }>(sql`SELECT value, expires_at FROM cache WHERE key = ${sqlKey}`);

      if (!row) return undefined;

      const expiresAt = Number(row.expires_at);
      if (now > expiresAt) {
        await this.db.exec(sql`DELETE FROM cache WHERE key = ${sqlKey}`);
        return undefined;
      }

      if (updateTTL) {
        const ttl = Math.max(0, expiresAt - now);
        await this.db.exec(
          sql`UPDATE cache
              SET expires_at = ${now + ttl},
                  last_accessed = CURRENT_TIMESTAMP
              WHERE key = ${sqlKey}`
        );
      } else {
        await this.db.exec(
          sql`UPDATE cache SET last_accessed = CURRENT_TIMESTAMP WHERE key = ${sqlKey}`
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
      const row = await this.db.maybeOne<{ expires_at: number | string }>(
        sql`SELECT expires_at FROM cache WHERE key = ${sqlKey}`
      );
      if (!row) return;

      if (Date.now() > Number(row.expires_at)) {
        await this.db.exec(sql`DELETE FROM cache WHERE key = ${sqlKey}`);
        return;
      }

      await this.db.exec(
        sql`UPDATE cache
            SET value = ${JSON.stringify(value)},
                last_accessed = CURRENT_TIMESTAMP
            WHERE key = ${sqlKey}`
      );
    } catch (err) {
      logger.error(`Error updating key ${String(key)} in SQL cache: ${err}`);
    }
  }

  async delete(key: K): Promise<boolean> {
    const sqlKey = this.getKey(key);

    try {
      const result = await this.db.exec(
        sql`DELETE FROM cache WHERE key = ${sqlKey}`
      );
      return result.rowCount > 0;
    } catch (err) {
      logger.error(`Error deleting key ${String(key)} from SQL cache: ${err}`);
      return false;
    }
  }

  async clear(): Promise<void> {
    try {
      if (this.prefix) {
        await this.db.exec(
          sql`DELETE FROM cache WHERE key LIKE ${`${this.prefix}%`}`
        );
      } else {
        await this.db.exec(sql`DELETE FROM cache`);
      }
    } catch (err) {
      logger.error(`Error clearing SQL cache: ${err}`);
    }
  }

  async getTTL(key: K): Promise<number> {
    const sqlKey = this.getKey(key);
    const now = Date.now();

    try {
      const row = await this.db.maybeOne<{ expires_at: number | string }>(
        sql`SELECT expires_at FROM cache WHERE key = ${sqlKey}`
      );
      if (!row) return 0;
      return Math.max(0, Math.floor((Number(row.expires_at) - now) / 1000));
    } catch (err) {
      logger.error(
        `Error getting TTL for key ${String(key)} from SQL cache: ${err}`
      );
      return 0;
    }
  }

  async waitUntilReady(): Promise<void> {
    // getDb() throws if not initialised. Calling it here turns that
    // into an early failure for any caller that awaits readiness.
    getDb();
  }

  async flush(): Promise<void> {
    await SQLCacheBackend.flushWriteBuffer();
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
