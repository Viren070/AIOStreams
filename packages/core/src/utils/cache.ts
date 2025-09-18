import {
  CacheBackend,
  MemoryCacheBackend,
  RedisCacheBackend,
} from './cache-adapter.js';
import { createLogger, Env } from './index.js';
import { createClient, RedisClientType } from 'redis';

const logger = createLogger('cache');

function formatBytes(bytes: number, decimals: number = 2): string {
  if (!+bytes) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export class Cache<K, V> {
  private static instances: Map<string, any> = new Map();
  private static isStatsLoopRunning: boolean = false;
  private backend: CacheBackend<K, V>;
  private maxSize: number;
  private name: string;

  // Redis client singleton
  private static redisClient: RedisClientType | null = null;

  private constructor(name: string, maxSize: number, forceMemory: boolean) {
    this.name = name;
    this.maxSize = maxSize;

    // Initialize the appropriate backend based on environment configuration
    if (Env.REDIS_URI && !forceMemory) {
      this.backend = new RedisCacheBackend<K, V>(
        Cache.getRedisClient(),
        `${name}:`,
        maxSize
      );
      logger.debug(`Created Redis cache backend for ${name}`);
    } else {
      this.backend = new MemoryCacheBackend<K, V>(maxSize);
      Cache.startStatsLoop();
      logger.debug(`Created Memory cache backend for ${name}`);
    }
  }

  public static getRedisClient(): RedisClientType {
    if (!this.redisClient) {
      logger.info(`Initialising Redis client connection to ${Env.REDIS_URI}`);
      this.redisClient = createClient({
        url: Env.REDIS_URI,
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
    if (!Env.REDIS_URI) {
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

  private static startStatsLoop() {
    if (Cache.isStatsLoopRunning) {
      return;
    }
    Cache.isStatsLoopRunning = true;
    const interval = Env.LOG_CACHE_STATS_INTERVAL * 60 * 1000; // Convert minutes to ms
    const runAndReschedule = () => {
      Cache.stats();

      const delay = interval - (Date.now() % interval);
      setTimeout(runAndReschedule, delay).unref();
    };
    const initialDelay = interval - (Date.now() % interval);
    setTimeout(runAndReschedule, initialDelay).unref();
  }

  /**
   * Get an instance of the cache with a specific name
   * @param name Unique identifier for this cache instance
   * @param maxSize Maximum size of the cache (only used when creating a new instance)
   */
  public static getInstance<K, V>(
    name: string,
    maxSize: number = Env.DEFAULT_MAX_CACHE_SIZE,
    forceMemory: boolean = false
  ): Cache<K, V> {
    if (!this.instances.has(name)) {
      logger.debug(`Creating new cache instance: ${name}`);
      this.instances.set(name, new Cache<K, V>(name, maxSize, forceMemory));
    }
    return this.instances.get(name) as Cache<K, V>;
  }

  public static async close() {
    if (this.redisClient) {
      await this.redisClient.disconnect();
    }
  }

  /**
   * Gets the statistics of the cache in use by the program. returns a formatted string containing a list of all cache instances
   * and their currently held items, max items
   */
  public static async stats() {
    if (!this.instances || this.instances.size === 0) {
      return;
    }

    let grandTotalItems = 0;
    let grandTotalSize = 0;

    const header = [
      '╔══════════════════════╤══════════╤═════════════════╤═════════════════╗',
      '║      Cache Name      │  Items   │    Max Size     │  Estimated Size ║',
      '╠══════════════════════╪══════════╪═════════════════╪═════════════════╣',
    ];

    const bodyLines = [];

    for (const [name, cache] of this.instances.entries()) {
      let itemCount = 0;
      let instanceSize = 0;

      // push cache stats for memory cache only
      if (cache.backend instanceof MemoryCacheBackend) {
        itemCount = cache.backend.getSize();
        instanceSize = cache.backend.getMemoryUsageEstimate();

        const nameStr = name.padEnd(20);
        const itemsStr = String(itemCount).padEnd(8);
        const maxSizeStr = String(cache.maxSize ?? '-').padEnd(15);
        const estSizeStr = formatBytes(instanceSize).padEnd(15);
        grandTotalItems += itemCount;
        grandTotalSize += instanceSize;

        bodyLines.push(
          `║ ${nameStr} │ ${itemsStr} │ ${maxSizeStr} │ ${estSizeStr} ║`
        );
      }
    }

    const footer = [
      '╚══════════════════════╧══════════╧═════════════════╧═════════════════╝',
      `  Summary: ${this.instances.size} cache instance(s), ${grandTotalItems} total items, Est. Total Size: ${formatBytes(grandTotalSize)}`,
    ];

    const lines = [...header, ...bodyLines, ...footer];
    if (bodyLines.length > 0) {
      logger.verbose(lines.join('\n'));
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
  async set(key: K, value: V, ttl: number): Promise<void> {
    return this.backend.set(key, value, ttl);
  }

  /**
   * Update the value of an existing key in the cache without changing the TTL
   * @param key The key to update
   * @param value The new value
   */
  async update(key: K, value: V): Promise<void> {
    return this.backend.update(key, value);
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

  getType(): 'memory' | 'redis' {
    return this.backend instanceof MemoryCacheBackend ? 'memory' : 'redis';
  }
}
