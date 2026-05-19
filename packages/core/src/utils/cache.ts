import {
  CacheBackend,
  MemoryCacheBackend,
  RedisCacheBackend,
  SQLCacheBackend,
} from './cache-adapter.js';
import { createLogger } from './index.js';
import { config as appConfig } from '../config/index.js';
import { getDb } from '../db/db.js';
import { sql } from '../db/sql.js';
import { createClient, RedisClientType } from 'redis';

const logger = createLogger('cache');

export interface CacheInstanceInfo {
  name: string;
  backend: 'memory' | 'redis' | 'sql';
  maxSize: number | null;
  items: number | null;
  estBytes: number | null;
  expired?: number;
}

export interface CacheDescription {
  instances: CacheInstanceInfo[];
  totals: {
    instances: number;
    items: number | null;
    estBytes: number | null;
    redisDbSize?: number;
  };
}

export class Cache<K, V> {
  private static instances: Map<string, any> = new Map();
  /**
   * Backend is created lazily on first access so that {@link getInstance}
   * calls at module-load time don't read runtime config (`appConfig.resources.
   * cache.defaultMaxSize`). The actual store/maxSize resolution happens
   * inside {@link createBackend}, which runs after `initialiseConfig()` has
   * resolved.
   */
  private _backend: CacheBackend<K, V> | null = null;
  private explicitMaxSize:
    | number
    | (() => number | null | undefined)
    | undefined;
  private storePreference: 'redis' | 'sql' | 'memory' | undefined;
  private name: string;

  // Redis client singleton
  private static redisClient: RedisClientType | null = null;

  private constructor(
    name: string,
    maxSize: number | (() => number | null | undefined) | undefined,
    store?: 'redis' | 'sql' | 'memory'
  ) {
    this.name = name;
    this.explicitMaxSize = maxSize;
    this.storePreference = store;
  }

  /** Resolved max size — falls back to the runtime-config default. */
  private get maxSize(): number {
    const raw =
      typeof this.explicitMaxSize === 'function'
        ? this.explicitMaxSize()
        : this.explicitMaxSize;
    return raw ?? appConfig.resources.cache.defaultMaxSize;
  }

  private get backend(): CacheBackend<K, V> {
    if (this._backend) return this._backend;
    const { storePreference: store, maxSize, name } = this;
    if (store === 'sql') {
      this._backend = new SQLCacheBackend<K, V>(`${name}:`, maxSize);
    } else if (appConfig.bootstrap.redisUri && (!store || store === 'redis')) {
      this._backend = new RedisCacheBackend<K, V>(
        Cache.getRedisClient(),
        `${name}:`,
        maxSize
      );
    } else {
      this._backend = new MemoryCacheBackend<K, V>(maxSize);
    }
    return this._backend;
  }

  public static getRedisClient(): RedisClientType {
    if (!this.redisClient) {
      logger.info(
        `Initialising Redis client connection to ${appConfig.bootstrap.redisUri}`
      );
      this.redisClient = createClient({
        url: appConfig.bootstrap.redisUri,
      });
      this.redisClient.on('connect', () => {
        logger.info('Connected to Redis server');
      });
      this.redisClient
        .connect()
        .then(() => {
          if (!this.redisClient) {
            throw new Error('Redis client not initialized');
          }

          this.redisClient.on('reconnecting', () => {
            logger.warn('Reconnecting to Redis server');
          });

          this.redisClient.on('error', (err: any) => {
            logger.error(`Redis client error: ${err}`);
          });
        })
        .catch((err: any) => {
          throw new Error(`Failed to connect to Redis server: ${err}`);
        });
    }

    return this.redisClient;
  }

  /**
   * Tests the Redis connection by attempting to set and get a test value
   * @throws Error if Redis connection test fails
   */
  public static async testRedisConnection(): Promise<void> {
    if (!appConfig.bootstrap.redisUri) {
      return;
    }

    try {
      const client = this.getRedisClient();
      const startTime = Date.now();
      while (Date.now() - startTime < 10000) {
        if (client.isReady) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!client.isReady) {
        throw new Error('Redis connection test timed out');
      }

      const testKey = 'redis:connection:test';
      const testValue = 'test-' + Date.now();

      await client.set(testKey, testValue, {
        expiration: {
          type: 'EX',
          value: 10,
        },
      });

      const retrievedValue = await client.get(testKey);

      if (retrievedValue !== testValue) {
        throw new Error('Redis get/set test failed: values do not match');
      }

      await client.del(testKey);

      logger.info('Redis connection test successful');
    } catch (err: any) {
      throw new Error(`Redis connection test failed: ${err.message}`);
    }
  }

  /**
   * Get an instance of the cache with a specific name
   * @param name Unique identifier for this cache instance
   * @param maxSize Maximum size of the cache (only used when creating a new instance)
   */
  public static getInstance<K, V>(
    name: string,
    maxSize?: number | (() => number | null | undefined),
    store?: 'redis' | 'sql' | 'memory'
  ): Cache<K, V> {
    if (!this.instances.has(name)) {
      this.instances.set(name, new Cache<K, V>(name, maxSize, store));
    }
    return this.instances.get(name) as Cache<K, V>;
  }

  public static async close() {
    if (this.redisClient) {
      await this.redisClient.disconnect();
    }
  }

  /**
   * Cheap, on-demand snapshot of every registered cache instance. Replaces the
   * old box-drawing `stats()` log loop (see 04-logging). Redis per-prefix item
   * counts are NOT computed here (expensive) — use {@link scanPrefix}.
   */
  public static async describe(): Promise<CacheDescription> {
    const instances: CacheInstanceInfo[] = [];
    let totalItems: number | null = 0;
    let totalBytes: number | null = 0;

    for (const [name, cache] of this.instances.entries()) {
      const backend = cache.getType() as 'memory' | 'redis' | 'sql';
      const info: CacheInstanceInfo = {
        name,
        backend,
        maxSize: cache.maxSize ?? null,
        items: null,
        estBytes: null,
      };
      if (cache.backend instanceof MemoryCacheBackend) {
        info.items = cache.backend.getSize();
        info.estBytes = cache.backend.getMemoryUsageEstimate();
        if (totalItems !== null) totalItems += info.items as any;
        if (totalBytes !== null) totalBytes += info.estBytes as any;
      } else if (backend === 'sql') {
        try {
          const db = getDb();
          const c = await db.query<{ c: number | string }>(
            sql`SELECT COUNT(*) AS c FROM cache WHERE key LIKE ${`${name}:%`}`
          );
          const e = await db.query<{ c: number | string }>(
            sql`SELECT COUNT(*) AS c FROM cache WHERE key LIKE ${`${name}:%`} AND expires_at < ${Date.now()}`
          );
          info.items = Number(c[0]?.c ?? 0);
          info.expired = Number(e[0]?.c ?? 0);
          if (totalItems !== null) totalItems += info.items;
        } catch {
          totalItems = null;
        }
      } else {
        // redis — per-prefix is expensive; leave null (opt-in scan).
        totalItems = null;
        totalBytes = null;
      }
      instances.push(info);
    }

    let redisDbSize: number | undefined;
    if (appConfig.bootstrap.redisUri) {
      try {
        redisDbSize = await Cache.getRedisClient().dbSize();
      } catch {
        /* ignore */
      }
    }

    return {
      instances,
      totals: {
        instances: this.instances.size,
        items: totalItems,
        estBytes: totalBytes,
        redisDbSize,
      },
    };
  }

  /**
   * Opt-in, capped Redis key count for one prefix via a single non-blocking
   * SCAN cursor. May be slow on large Redis instances — never called
   * automatically.
   */
  public static async scanPrefix(
    name: string,
    opts: { limit?: number } = {}
  ): Promise<{ count: number; capped: boolean }> {
    if (!appConfig.bootstrap.redisUri) return { count: 0, capped: false };
    const cap = Math.min(Math.max(opts.limit ?? 50_000, 1), 500_000);
    const client = Cache.getRedisClient();
    let count = 0;
    let cursor: string = '0';
    do {
      const res = await client.scan(cursor, {
        MATCH: `*${name}:*`,
        COUNT: 1000,
      });
      cursor = String(res.cursor);
      count += res.keys.length;
      if (count >= cap) return { count, capped: true };
    } while (cursor !== '0');
    return { count, capped: false };
  }

  /** Clear every registered cache instance. Destructive. */
  public static async clearAll(): Promise<void> {
    for (const cache of this.instances.values()) {
      await cache.clear().catch(() => undefined);
    }
  }

  /** Clear one instance by name (prefix). */
  public static async clearPrefix(name: string): Promise<boolean> {
    const cache = this.instances.get(name);
    if (!cache) return false;
    await cache.clear();
    return true;
  }

  /** Delete expired SQL cache rows (memory/redis expire on their own). */
  public static async clearExpired(): Promise<number> {
    try {
      const db = getDb();
      const res = await db.exec(
        sql`DELETE FROM cache WHERE expires_at < ${Date.now()}`
      );
      return res.rowCount ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Wrap a function with caching logic by immediately executing it with the provided arguments.
   * @param fn The function to wrap
   * @param key A unique key for caching
   * @param ttl Time-To-Live in seconds for the cached value
   * @param args The arguments to pass to the function
   */
  async wrap<T extends (...args: any[]) => any>(
    fn: T,
    key: K,
    ttl: number,
    ...args: Parameters<T>
  ): Promise<ReturnType<T>> {
    const cachedValue = await this.get(key);
    if (cachedValue !== undefined) {
      return cachedValue as ReturnType<T>;
    }
    const result = await fn(...args);
    // do not cache empty arrays
    if (Array.isArray(result) && result.length === 0) {
      return result as ReturnType<T>;
    }
    await this.set(key, result, ttl);
    return result;
  }

  async get(key: K, updateTTL: boolean = false): Promise<V | undefined> {
    return this.backend.get(key, updateTTL);
  }

  /**
   * Set a value in the cache with a specific TTL
   * @param key The key to set the value for
   * @param value The value to set
   * @param ttl The TTL in seconds
   */
  async set(
    key: K,
    value: V,
    ttl: number,
    forceWrite?: boolean
  ): Promise<void> {
    return this.backend.set(key, value, ttl, forceWrite);
  }

  async flush(): Promise<void> {
    return this.backend.flush();
  }

  /**
   * Update the value of an existing key in the cache without changing the TTL
   * @param key The key to update
   * @param value The new value
   */
  async update(key: K, value: V): Promise<void> {
    return this.backend.update(key, value);
  }

  async delete(key: K): Promise<boolean> {
    return this.backend.delete(key);
  }

  async clear(): Promise<void> {
    return this.backend.clear();
  }

  async getTTL(key: K): Promise<number> {
    return this.backend.getTTL(key);
  }

  async waitUntilReady(): Promise<void> {
    return this.backend.waitUntilReady();
  }

  getType(): 'memory' | 'redis' | 'sql' {
    if (this.backend instanceof MemoryCacheBackend) return 'memory';
    if (this.backend instanceof RedisCacheBackend) return 'redis';
    return 'sql';
  }
}
