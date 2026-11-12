import { promisify } from 'node:util';
import { zstdCompress, zstdDecompress } from 'node:zlib';
import { Cache } from '../../utils/cache.js';
import {
  createLogger,
  DistributedLock,
  requestLockType,
} from '../../utils/index.js';

const logger = createLogger('xtream');
const compress = promisify(zstdCompress);
const decompress = promisify(zstdDecompress);

/**
 * Values in memory, backed by the database, which other replicas and restarts
 * read. Not Redis: values run to megabytes, and Redis holds them in memory.
 * The database keeps JSON as it is, so values go in compressed.
 */
export class TieredStore<V, S> {
  private readonly memory: Cache<string, V>;
  /** The value compressed, and when it expires, which saves the store a lookup. */
  private readonly shared: Cache<string, { until: number; data: string }>;
  private readonly revalidating = new Set<string>();
  private readonly loading = new Map<string, Promise<V>>();
  private readonly encode: (value: V) => S;
  private readonly decode: (stored: S) => V;

  constructor(
    private readonly name: string,
    opts: {
      memoryBytes: () => number;
      sizeOf: (value: V) => number;
      encode: (value: V) => S;
      decode: (stored: S) => V;
    }
  ) {
    this.memory = Cache.getInstance<string, V>(
      name,
      opts.memoryBytes,
      'memory',
      { clone: false, sizeOf: opts.sizeOf }
    );
    this.shared = Cache.getInstance<string, { until: number; data: string }>(
      `${name}-shared`,
      undefined,
      'sql'
    );
    this.encode = opts.encode;
    this.decode = opts.decode;
  }

  /** The value and its seconds left, read into memory from the shared store if need be. */
  async peek(key: string): Promise<[V, number] | undefined> {
    const value = await this.memory.get(key);
    if (value !== undefined) return [value, await this.memory.getTTL(key)];
    const stored = await this.shared.get(key).catch(() => undefined);
    const left = stored ? Math.floor((stored.until - Date.now()) / 1000) : 0;
    if (!stored || !(left > 0)) return undefined;
    let decoded: V;
    try {
      const json = await decompress(Buffer.from(stored.data, 'base64'));
      decoded = this.decode(JSON.parse(json.toString('utf8')) as S);
    } catch {
      // Written by another version, so fetched again as if missing.
      return undefined;
    }
    await this.memory.set(key, decoded, left);
    return [decoded, left];
  }

  async set(key: string, value: V, ttl: number): Promise<void> {
    await this.memory.set(key, value, ttl);
    try {
      const packed = await compress(
        Buffer.from(JSON.stringify(this.encode(value)))
      );
      await this.shared.set(
        key,
        { until: Date.now() + ttl * 1000, data: packed.toString('base64') },
        ttl
      );
    } catch (err) {
      logger.warn(
        { cache: this.name, err: err instanceof Error ? err.message : err },
        'xtream shared store write failed'
      );
    }
  }

  /** Kept in this replica only, as for a failure's marker. */
  async setLocal(key: string, value: V, ttl: number): Promise<void> {
    await this.memory.set(key, value, ttl);
  }

  /**
   * Fetches into both tiers once across replicas: the others wait for the
   * lock and read what it stored, or fetch for themselves if it couldn't be.
   */
  load(
    key: string,
    fetch: () => Promise<{ value: V; ttl: number }>,
    lockMs: number
  ): Promise<V> {
    let pending = this.loading.get(key);
    if (!pending) {
      pending = (async () => {
        await DistributedLock.getInstance().withLock(
          `${this.name}:${key}`,
          async () => {
            const { value, ttl } = await fetch();
            await this.set(key, value, ttl);
            return true;
          },
          { timeout: lockMs, ttl: lockMs, type: requestLockType() }
        );
        const stored = (await this.peek(key))?.[0];
        if (stored !== undefined) return stored;
        const { value, ttl } = await fetch();
        await this.setLocal(key, value, ttl);
        return value;
      })().finally(() => this.loading.delete(key));
      this.loading.set(key, pending);
    }
    return pending;
  }

  /** The value, refreshed behind it once fewer than `staleTtl` seconds are left. */
  async getOrRevalidate(
    key: string,
    load: () => Promise<V>,
    refresh: () => Promise<void>,
    staleTtl: number
  ): Promise<V> {
    const found = await this.peek(key);
    if (!found) return load();
    const [value, left] = found;
    if (left < staleTtl && !this.revalidating.has(key)) {
      this.revalidating.add(key);
      void refresh()
        .catch(() => undefined)
        .finally(() => this.revalidating.delete(key));
    }
    return value;
  }
}

/** Successive differences, which compress to little where values climb steadily. */
export const deltas = (values: ArrayLike<number>) => {
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++)
    out[i] = values[i] - (i ? values[i - 1] : 0);
  return out;
};

export function sums<T extends Float64Array | Int32Array | Uint32Array>(
  values: number[],
  Type: { new (length: number): T }
): T {
  const out = new Type(values.length);
  for (let i = 0; i < values.length; i++)
    out[i] = values[i] + (i ? out[i - 1] : 0);
  return out;
}
