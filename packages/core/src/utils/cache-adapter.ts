import { config as appConfig } from '../config/index.js';
import { RedisClientType, RESP_TYPES } from 'redis';
import { zstdCompress, zstdDecompress } from 'node:zlib';
import { promisify } from 'node:util';
import { REDIS_PREFIX } from './index.js';
import { createLogger } from '../logging/logger.js';
import { getTimeTakenSincePoint } from './time.js';
import { getDb } from '../db/db.js';
import type { DbDriver } from '../db/driver/types.js';
import { sql, join } from '../db/sql.js';
import { withTimeout } from './general.js';

const logger = createLogger('cache');

const REDIS_TIMEOUT = appConfig.bootstrap.redisTimeout;

const compress = promisify(zstdCompress);
const decompress = promisify(zstdDecompress);

/**
 * JSON at or above this many bytes is stored compressed. Below it the saving
 * does not pay for the round trip, and leaving small values as plain strings
 * keeps the format readable by a version that predates compression.
 */
const COMPRESS_THRESHOLD = 4096;
/** zstd frame magic, little-endian: bytes 28 B5 2F FD. */
const ZSTD_MAGIC = 0xfd2fb528;

/** JSON.stringify never emits `(`, so the magic alone identifies the format. */
const isCompressed = (raw: Buffer): boolean =>
  raw.length >= 4 && raw.readUInt32LE(0) === ZSTD_MAGIC;

async function encodeValue(value: unknown): Promise<string | Buffer> {
  const json = JSON.stringify(value);
  return json.length < COMPRESS_THRESHOLD
    ? json
    : compress(Buffer.from(json, 'utf8'));
}

async function decodeValue<V>(raw: Buffer): Promise<V> {
  const json = isCompressed(raw) ? await decompress(raw) : raw;
  return JSON.parse(json.toString('utf8')) as V;
}

const payloadBytes = (payload: string | Buffer): number =>
  typeof payload === 'string'
    ? Buffer.byteLength(payload, 'utf8')
    : payload.length;

/**
 * True when a value is too large to be worth storing. `bytes` is what actually
 * goes to the store, so on Redis that is the compressed size.
 */
function isOversized(bytes: number, prefix: string, key: string): boolean {
  const max = appConfig.resources.cache.maxValueBytes;
  if (!max) return false;
  if (bytes <= max) return false;
  logger.warn(
    { cache: prefix, key, bytes, max },
    'value exceeds the cache size limit, not caching it'
  );
  return true;
}

// Interface that both memory and Redis cache will implement
export interface CacheBackend<K, V> {
  /**
   * `updateTTL` re-arms the entry's expiry. Pass the TTL in seconds: only the
   * memory backend retains the original, so `true` slides nothing elsewhere.
   */
  get(key: K, updateTTL?: boolean | number): Promise<V | undefined>;
  getMany(keys: K[]): Promise<(V | undefined)[]>;
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

  private static instances: Set<MemoryCacheBackend<any, any>> = new Set();
  private static sweepInterval: NodeJS.Timeout | null = null;
  private static sweepIntervalTime: number = 60_000;
  private static sweepYieldEvery: number = 5000;

  constructor(maxSize: number) {
    this.cache = new Map<K, CacheItem<V>>();
    this.maxSize = maxSize;
    MemoryCacheBackend.instances.add(this);
    MemoryCacheBackend.startSweepInterval();
  }

  private static startSweepInterval() {
    if (MemoryCacheBackend.sweepInterval !== null) return;
    MemoryCacheBackend.sweepInterval = setInterval(() => {
      void MemoryCacheBackend.sweepExpired();
    }, MemoryCacheBackend.sweepIntervalTime);
    MemoryCacheBackend.sweepInterval.unref();
  }

  private static async sweepExpired(): Promise<void> {
    const now = Date.now();
    let visited = 0;
    for (const backend of MemoryCacheBackend.instances) {
      for (const [key, item] of backend.cache) {
        if (now - item.createdAt > item.ttl) backend.cache.delete(key);
        if (++visited % MemoryCacheBackend.sweepYieldEvery === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
    }
  }

  async get(
    key: K,
    updateTTL: boolean | number = false
  ): Promise<V | undefined> {
    const item = this.cache.get(key);
    if (item) {
      const now = Date.now();
      item.lastAccessed = now;
      if (now - item.createdAt > item.ttl) {
        this.cache.delete(key);
        return undefined;
      }
      // Re-inserting keeps Map order as LRU order, so eviction is O(1).
      this.cache.delete(key);
      this.cache.set(key, item);
      if (updateTTL) {
        // A number re-arms with that TTL; `true` reuses the original.
        if (typeof updateTTL === 'number') item.ttl = updateTTL * 1000;
        item.createdAt = now;
      }

      return structuredClone(item.value);
    }
    return undefined;
  }

  async getMany(keys: K[]): Promise<(V | undefined)[]> {
    return Promise.all(keys.map((key) => this.get(key)));
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

  /** Drops the least recently used entry, which `get` keeps at the front. */
  private evict(): void {
    const oldest = this.cache.keys().next();
    if (!oldest.done) this.cache.delete(oldest.value);
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
  /** Same connection, replies as Buffers so compressed values survive. */
  private bufferClient: ReturnType<RedisClientType['withTypeMapping']>;
  private prefix: string;
  private maxSize: number;
  private timeout: number;

  private static writeBuffer: Map<
    string,
    { value: string | Buffer; ttl: number; attempts?: number }
  > = new Map();
  private static flushInterval: NodeJS.Timeout | null = null;
  /** The flush in progress, so a `forceWrite` can wait for it rather than skip. */
  private static flushing: Promise<void> | null = null;
  private static batchSize: number = 100;
  private static flushIntervalTime: number = 2000;
  private static retryAfter: number = 0;
  private static maxFlushAttempts: number = 3;
  private static maxBufferedWrites: number = 1000;
  private static maxBufferedBytes: number = 32 * 1024 * 1024;
  private static clientRef: RedisClientType | null = null;
  private static timeoutRef: number = REDIS_TIMEOUT;

  constructor(
    redisClient: RedisClientType,
    prefix: string = REDIS_PREFIX,
    maxSize: number = appConfig.resources.cache.defaultMaxSize,
    timeout: number = REDIS_TIMEOUT
  ) {
    this.client = redisClient;
    this.bufferClient = redisClient.withTypeMapping({
      [RESP_TYPES.BLOB_STRING]: Buffer,
    });
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
      void RedisCacheBackend.flushWriteBuffer().catch(() => undefined);
    }, RedisCacheBackend.flushIntervalTime);
  }

  async get(
    key: K,
    updateTTL: boolean | number = false
  ): Promise<V | undefined> {
    const redisKey = this.getKey(key);

    return withTimeout(
      async () => {
        const data = await this.bufferClient.get(redisKey);
        if (!data || data.length === 0) return undefined;

        // Only a caller-supplied TTL can slide this: the stored value
        // carries no TTL of its own.
        if (typeof updateTTL === 'number' && updateTTL > 0) {
          await this.client.expire(redisKey, updateTTL);
        }

        return decodeValue<V>(data as Buffer);
      },
      undefined,
      {
        timeout: this.timeout,
        shouldProceed: () => this.client.isOpen,
        getContext: () => `getting key ${String(key)} from Redis`,
      }
    );
  }

  async getMany(keys: K[]): Promise<(V | undefined)[]> {
    if (keys.length === 0) return [];
    return withTimeout<(V | undefined)[]>(
      async () => {
        const raws = (await this.bufferClient.mGet(
          keys.map((key) => this.getKey(key))
        )) as (Buffer | null)[];
        return Promise.all(
          raws.map((raw) =>
            raw && raw.length > 0
              ? decodeValue<V>(raw).catch(() => undefined)
              : undefined
          )
        );
      },
      keys.map(() => undefined),
      {
        timeout: this.timeout,
        shouldProceed: () => this.client.isOpen,
        getContext: () => `getting ${keys.length} keys from Redis`,
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
    const payload = await encodeValue(value);
    if (isOversized(payloadBytes(payload), this.prefix, String(key))) return;
    RedisCacheBackend.writeBuffer.set(redisKey, {
      value: payload,
      ttl,
    });

    // Checked before the batch size, or a write that has to be readable now
    // is downgraded to a fire-and-forget flush.
    if (forceWrite) {
      await RedisCacheBackend.flushWriteBuffer();
    } else if (
      RedisCacheBackend.writeBuffer.size >= RedisCacheBackend.batchSize &&
      (Date.now() >= RedisCacheBackend.retryAfter ||
        RedisCacheBackend.writeBuffer.size >=
          RedisCacheBackend.maxBufferedWrites)
    ) {
      void RedisCacheBackend.flushWriteBuffer().catch(() => undefined);
    }
  }

  /**
   * Serialises flushes; a caller arriving during one waits, then takes its own
   * turn, so a `forceWrite` is never left sitting in the buffer.
   */
  private static async flushWriteBuffer(): Promise<void> {
    while (RedisCacheBackend.flushing) {
      await RedisCacheBackend.flushing.catch(() => undefined);
    }
    if (RedisCacheBackend.writeBuffer.size === 0) return;
    const run = RedisCacheBackend.drainWriteBuffer();
    RedisCacheBackend.flushing = run;
    try {
      await run;
    } finally {
      RedisCacheBackend.flushing = null;
    }
  }

  private static async drainWriteBuffer(): Promise<void> {
    const bufferToFlush = new Map(RedisCacheBackend.writeBuffer);
    RedisCacheBackend.writeBuffer.clear();

    if (!RedisCacheBackend.clientRef) {
      logger.error(
        'Cannot flush Redis write buffer - no client reference available'
      );
      return;
    }

    const start = Date.now();

    const pipeline = RedisCacheBackend.clientRef.multi();
    for (const [key, item] of bufferToFlush.entries()) {
      pipeline.set(key, item.value, { EX: item.ttl });
    }

    const flushed = await withTimeout(
      async () => {
        await pipeline.exec();
        return true;
      },
      false,
      {
        timeout: RedisCacheBackend.timeoutRef,
        shouldProceed: () => RedisCacheBackend.clientRef?.isOpen ?? false,
        getContext: () => 'flushing Redis write buffer',
      }
    );
    if (!flushed) {
      RedisCacheBackend.requeue(bufferToFlush);
      return;
    }
    logger.debug('Flushed Redis write buffer', {
      items: bufferToFlush.size,
      timeTaken: getTimeTakenSincePoint(start),
    });
  }

  /** Size-triggered flushes wait for the interval, or retries burn out at once. */
  private static requeue(batch: typeof RedisCacheBackend.writeBuffer): void {
    RedisCacheBackend.retryAfter =
      Date.now() + RedisCacheBackend.flushIntervalTime;
    let bytes = 0;
    for (const item of RedisCacheBackend.writeBuffer.values()) {
      bytes += payloadBytes(item.value);
    }
    let dropped = 0;
    for (const [key, item] of batch) {
      if (RedisCacheBackend.writeBuffer.has(key)) continue;
      const attempts = (item.attempts ?? 0) + 1;
      const size = payloadBytes(item.value);
      if (
        attempts >= RedisCacheBackend.maxFlushAttempts ||
        RedisCacheBackend.writeBuffer.size >=
          RedisCacheBackend.maxBufferedWrites ||
        bytes + size > RedisCacheBackend.maxBufferedBytes
      ) {
        dropped++;
        continue;
      }
      RedisCacheBackend.writeBuffer.set(key, { ...item, attempts });
      bytes += size;
    }
    if (dropped > 0) {
      logger.warn(
        { dropped },
        'dropped redis cache writes after failed flushes'
      );
    }
  }

  async update(key: K, value: V): Promise<void> {
    const redisKey = this.getKey(key);
    const payload = await encodeValue(value);
    if (isOversized(payloadBytes(payload), this.prefix, String(key))) return;

    await withTimeout(
      async () => {
        // Get current TTL
        const ttl = await this.client.ttl(redisKey);
        if (ttl <= 0) return false; // Key doesn't exist or has no TTL

        // Update value but keep the same TTL
        await this.client.set(redisKey, payload, {
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
    const wasBuffered = RedisCacheBackend.writeBuffer.delete(redisKey);

    return withTimeout<boolean>(
      async () => {
        const result = await this.client.del(redisKey);
        return wasBuffered || result > 0;
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
  /** The flush in progress; see the Redis backend. */
  private static flushing: Promise<void> | null = null;
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
      void SQLCacheBackend.flushWriteBuffer().catch(() => undefined);
    }, SQLCacheBackend.flushIntervalTime);
  }

  /** See the Redis equivalent. */
  private static async flushWriteBuffer(): Promise<void> {
    while (SQLCacheBackend.flushing) {
      await SQLCacheBackend.flushing.catch(() => undefined);
    }
    if (SQLCacheBackend.writeBuffer.size === 0) return;
    const run = SQLCacheBackend.drainWriteBuffer();
    SQLCacheBackend.flushing = run;
    try {
      await run;
    } finally {
      SQLCacheBackend.flushing = null;
    }
  }

  private static async drainWriteBuffer(): Promise<void> {
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
        const serialised = JSON.stringify(item.value);
        if (isOversized(Buffer.byteLength(serialised, 'utf8'), 'sql', key))
          continue;
        placeholders.push('(?, ?, ?)');
        values.push(key, serialised, now + item.ttl * 1000);
      }
      if (placeholders.length === 0) return;
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

  async get(
    key: K,
    updateTTL: boolean | number = false
  ): Promise<V | undefined> {
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

      // The stored row carries no TTL, so only a supplied one can move this.
      if (typeof updateTTL === 'number' && updateTTL > 0) {
        await this.db.exec(
          sql`UPDATE cache
              SET expires_at = ${now + updateTTL * 1000},
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

  async getMany(keys: K[]): Promise<(V | undefined)[]> {
    if (keys.length === 0) return [];
    const sqlKeys = keys.map((key) => this.getKey(key));
    const inList = (list: string[]) => join(list.map((key) => sql`${key}`));
    const now = Date.now();

    try {
      const rows = await this.db.query<{
        key: string;
        value: string;
        expires_at: number | string;
      }>(
        sql`SELECT key, value, expires_at FROM cache WHERE key IN (${inList(sqlKeys)})`
      );

      const found = new Map<string, V>();
      const expired: string[] = [];
      for (const row of rows) {
        if (now > Number(row.expires_at)) expired.push(row.key);
        else found.set(row.key, JSON.parse(row.value) as V);
      }
      if (expired.length > 0) {
        await this.db.exec(
          sql`DELETE FROM cache WHERE key IN (${inList(expired)})`
        );
      }
      if (found.size > 0) {
        await this.db.exec(
          sql`UPDATE cache SET last_accessed = CURRENT_TIMESTAMP WHERE key IN (${inList([...found.keys()])})`
        );
      }
      return sqlKeys.map((key) => found.get(key));
    } catch (err) {
      logger.error(`Error getting ${keys.length} keys from SQL cache: ${err}`);
      return keys.map(() => undefined);
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

    if (forceWrite) {
      await SQLCacheBackend.flushWriteBuffer();
    } else if (SQLCacheBackend.writeBuffer.size >= SQLCacheBackend.batchSize) {
      void SQLCacheBackend.flushWriteBuffer().catch(() => undefined);
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
