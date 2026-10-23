import type { GroupRequest } from '@aiostreams/core';

/** A token bucket, refilled as it is read, so it needs no timer. */
export class Bucket {
  private tokens: number;
  private at = Date.now();

  constructor(
    private readonly perSecond: number,
    private readonly burst: number
  ) {
    this.tokens = burst;
  }

  take(cost = 1): boolean {
    const now = Date.now();
    this.tokens = Math.min(
      this.burst,
      this.tokens + ((now - this.at) * this.perSecond) / 1000
    );
    this.at = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  get full(): boolean {
    this.take(0);
    return this.tokens >= this.burst;
  }
}

interface Address {
  connections: number;
  creates: Bucket;
  joins: Bucket;
}

/** What each address may do: connections held, parties started, joins tried. */
export class AddressBook {
  private readonly addresses = new Map<string, Address>();

  constructor(
    private readonly maxConnections: number,
    private readonly creates: [perSecond: number, burst: number],
    private readonly joins: [perSecond: number, burst: number]
  ) {}

  private entry(key: string): Address {
    let entry = this.addresses.get(key);
    if (!entry) {
      entry = {
        connections: 0,
        creates: new Bucket(...this.creates),
        joins: new Bucket(...this.joins),
      };
      this.addresses.set(key, entry);
    }
    return entry;
  }

  /** Whether another connection would still fit. */
  room(key: string): boolean {
    return (this.addresses.get(key)?.connections ?? 0) < this.maxConnections;
  }

  connect(key: string): boolean {
    const entry = this.entry(key);
    if (entry.connections >= this.maxConnections) return false;
    entry.connections++;
    return true;
  }

  disconnect(key: string): void {
    const entry = this.addresses.get(key);
    if (entry) entry.connections = Math.max(entry.connections - 1, 0);
  }

  create(key: string): boolean {
    return this.entry(key).creates.take();
  }

  join(key: string): boolean {
    return this.entry(key).joins.take();
  }

  /** Forgets addresses with nothing open and nothing left to refill. */
  prune(): void {
    for (const [key, entry] of this.addresses) {
      if (!entry.connections && entry.creates.full && entry.joins.full)
        this.addresses.delete(key);
    }
  }
}

export const withinQueue = (
  request: GroupRequest,
  size: number,
  max: number
): GroupRequest =>
  request.type === 'Queue'
    ? { ...request, items: request.items.slice(0, Math.max(max - size, 0)) }
    : request;
