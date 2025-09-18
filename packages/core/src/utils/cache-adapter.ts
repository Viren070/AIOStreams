import { RedisClientType } from 'redis';
import { REDIS_PREFIX, Env } from './index.js';
import { createLogger } from './logger.js';

const logger = createLogger('cache');

const REDIS_TIMEOUT = Env.REDIS_TIMEOUT;

// Interface that both memory and Redis cache will implement
export interface CacheBackend<K, V> {
  get(key: K, updateTTL?: boolean): Promise<V | undefined>;
  set(key: K, value: V, ttl: number): Promise<void>;
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

  async set(key: K, value: V, ttl: number): Promise<void> {
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
  }

  private getKey(key: K): string {
    return `${REDIS_PREFIX}${this.prefix}${String(key)}`;
  }

  /**
   * Execute Redis operation with timeout
   * @param operation Function that performs the Redis operation
   * @param fallback Value to return if operation times out or fails
   * @param errorMessage Message to log if operation fails
   */
  private async withTimeout<T>(
    operation: () => Promise<T>,
    fallback: T,
    errorMessage: string
  ): Promise<T> {
    // check if the client is connected
    if (!this.client.isOpen) {
      logger.error(`${errorMessage}: Redis client is not open`);
      return fallback;
    }

    try {
      // Create a promise that rejects after timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        const id = setTimeout(() => {
          clearTimeout(id);
          reject(
            new Error(`Redis operation timed out after ${this.timeout}ms`)
          );
        }, this.timeout);
      });

      // Race the operation against the timeout
      return await Promise.race([operation(), timeoutPromise]);
    } catch (err) {
      logger.error(`${errorMessage}: ${err}`);
      return fallback;
    }
  }

  async get(key: K, updateTTL: boolean = false): Promise<V | undefined> {
    const redisKey = this.getKey(key);

    return this.withTimeout(
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
      `Error getting key ${String(key)} from Redis`
    );
  }

  async set(key: K, value: V, ttl: number): Promise<void> {
    if (ttl === 0) {
      return;
    }
    const redisKey = this.getKey(key);

    await this.withTimeout(
      async () => {
        await this.client.set(redisKey, JSON.stringify(value), {
          EX: ttl,
        });
        return true;
      },
      false,
      `Error setting key ${String(key)} in Redis`
    );
  }

  async update(key: K, value: V): Promise<void> {
    const redisKey = this.getKey(key);

    await this.withTimeout(
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
      `Error updating key ${String(key)} in Redis`
    );
  }

  async clear(): Promise<void> {
    await this.withTimeout(
      async () => {
        // Delete all keys with this prefix
        const keys = await this.client.keys(`${this.prefix}*`);
        if (keys && keys.length > 0) {
          await this.client.del(keys);
        }
        return true;
      },
      false,
      `Error clearing Redis cache`
    );
  }

  async getTTL(key: K): Promise<number> {
    return this.withTimeout(
      async () => {
        const ttl = await this.client.ttl(this.getKey(key));
        return ttl > 0 ? ttl : 0;
      },
      0,
      `Error getting TTL for key ${String(key)} from Redis`
    );
  }

  async waitUntilReady(): Promise<void> {
    while (!this.client.isOpen) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

// Item stored in memory cache
class CacheItem<T> {
  constructor(
    public value: T,
    public lastAccessed: number,
    public createdAt: number,
    public ttl: number // Time-To-Live in milliseconds
  ) {}
}
