import { createLogger } from './logger';
import { Env } from './env';

const logger = createLogger('cache');

function formatBytes(bytes: number, decimals: number = 2): string {
  if (!+bytes) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

class CacheItem<T> {
  constructor(
    public value: T,
    public lastAccessed: number,
    public ttl: number // Time-To-Live in milliseconds
  ) {}
}

export class Cache<K, V> {
  private static instances: Map<string, any> = new Map();
  private cache: Map<K, CacheItem<V>>;
  private maxSize: number;
  private static isStatsLoopRunning: boolean = false;

  private constructor(maxSize: number) {
    this.cache = new Map<K, CacheItem<V>>();
    this.maxSize = maxSize;
    Cache.startStatsLoop();
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
    maxSize: number = Env.DEFAULT_MAX_CACHE_SIZE
  ): Cache<K, V> {
    if (!this.instances.has(name)) {
      logger.debug(`Creating new cache instance: ${name}`);
      this.instances.set(name, new Cache<K, V>(maxSize));
    }
    return this.instances.get(name) as Cache<K, V>;
  }

  /**
   * Gets the statistics of the cache in use by the program. returns a formatted string containing a list of all cache instances
   * and their currently held items, max items
   */
  public static stats() {
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

    const bodyLines = Array.from(this.instances.entries()).map(
      ([name, cache]) => {
        let instanceSize = 0;
        for (const item of cache.cache.values()) {
          try {
            // Estimate object size by getting the byte length of its JSON string representation.
            // This is an approximation but is effective for many use cases.
            instanceSize += Buffer.byteLength(JSON.stringify(item), 'utf8');
          } catch (e) {
            // Could fail on circular references. In that case, we add 0.
            instanceSize += 0;
          }
        }

        grandTotalItems += cache.cache.size;
        grandTotalSize += instanceSize;

        const nameStr = name.padEnd(20);
        const itemsStr = String(cache.cache.size).padEnd(8);
        const maxSizeStr = String(cache.maxSize ?? '-').padEnd(15);
        const estSizeStr = formatBytes(instanceSize).padEnd(15);

        return `║ ${nameStr} │ ${itemsStr} │ ${maxSizeStr} │ ${estSizeStr} ║`;
      }
    );

    const footer = [
      '╚══════════════════════╧══════════╧═════════════════╧═════════════════╝',
      `  Summary: ${this.instances.size} cache instance(s), ${grandTotalItems} total items, Est. Total Size: ${formatBytes(grandTotalSize)}`,
    ];

    const lines = [...header, ...bodyLines, ...footer];
    logger.verbose(lines.join('\n'));
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
    const cachedValue = this.get(key);
    if (cachedValue !== undefined) {
      return cachedValue as ReturnType<T>;
    }
    const result = await fn(...args);
    this.set(key, result, ttl);
    return result;
  }

  get(key: K, updateTTL: boolean = true): V | undefined {
    const item = this.cache.get(key);
    if (item) {
      const now = Date.now();
      if (now - item.lastAccessed > item.ttl) {
        this.cache.delete(key);
        return undefined;
      }
      if (updateTTL) {
        item.lastAccessed = now;
      }
      return item.value;
    }
    return undefined;
  }

  /**
   * Set a value in the cache with a specific TTL
   * @param key The key to set the value for
   * @param value The value to set
   * @param ttl The TTL in seconds
   */
  set(key: K, value: V, ttl: number): void {
    if (this.cache.size >= this.maxSize) {
      this.evict();
    }
    this.cache.set(key, new CacheItem<V>(value, Date.now(), ttl * 1000));
  }

  /**
   * Update the value of an existing key in the cache without changing the TTL
   * @param key The key to update
   * @param value The new value
   */
  update(key: K, value: V): void {
    const item = this.cache.get(key);
    if (item) {
      item.value = value;
    }
  }

  clear(): void {
    this.cache.clear();
  }

  getTTL(key: K): number {
    // return the time left in seconds until the item expires
    const item = this.cache.get(key);
    if (item) {
      return Math.max(
        0,
        Math.floor((item.lastAccessed + item.ttl - Date.now()) / 1000)
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
}
