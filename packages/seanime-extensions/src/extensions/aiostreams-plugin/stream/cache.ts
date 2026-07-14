import { ParsedId } from '../../../lib/aiostreams';
import { Context, StreamResult } from '../types';

interface CacheEntry {
  results: StreamResult[];
  ts: number;
}

type CacheStore = Record<string, CacheEntry>;

export class StreamCache {
  constructor(
    private readonly ctx: Context,
    private readonly storeKey: string
  ) {}

  private read(): CacheStore {
    return $storage.get<CacheStore>(this.storeKey) ?? {};
  }

  private write(store: CacheStore): void {
    $storage.set(this.storeKey, store);
  }

  static keyFor(parsedId: ParsedId): string {
    return `${parsedId.type}:${parsedId.value}:s${parsedId.season ?? 0}:e${parsedId.episode ?? 0}`;
  }

  get(key: string): StreamResult[] | null {
    const ttl = this.ctx.preferences.cacheTtl;
    if (ttl === 0) return null;
    const entry = this.read()[key];
    if (!entry) return null;
    if (Date.now() - entry.ts > ttl * 60 * 1000) return null;
    // Guard against malformed/partial entries coming back from $storage.
    if (!Array.isArray(entry.results)) return null;
    return entry.results;
  }

  set(key: string, results: StreamResult[]): void {
    const ttl = this.ctx.preferences.cacheTtl;
    if (ttl === 0) return;
    const store = this.read();
    store[key] = { results, ts: Date.now() };
    this.write(store);
  }

  invalidate(key: string): void {
    const store = this.read();
    delete store[key];
    this.write(store);
  }

  clear(): void {
    this.write({});
  }

  count(): number {
    return Object.keys(this.read()).length;
  }
}
