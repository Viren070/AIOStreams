import type { RedisClientType } from 'redis';
import { createLogger } from '../../logging/logger.js';
import { REDIS_PREFIX } from '../../utils/constants.js';
import { diff, indexOf, NO_INDEX, replicaId, type Index } from './helpers.js';
import {
  SharedTx,
  type CreateResult,
  type SharedBackend,
  type SharedKind,
  type SharedMessage,
  type SharedPresence,
  type SharedRecords,
} from './types.js';

const logger = createLogger('party');

const PREFIX = `${REDIS_PREFIX}party:`;
/** Every record of every kind, which the cap counts. */
const ALL = `${PREFIX}all`;
const DUE = `${PREFIX}due`;
const REPLICAS = `${PREFIX}replicas`;
const inbox = (replica: string) => `${PREFIX}inbox:${replica}`;
const reapKey = (replica: string) => `${PREFIX}reap:${replica}`;
const onlineKey = (replica: string) => `${PREFIX}online:${replica}`;

const LAPSE_MS = 1_000;
/** A deadline claimed by a replica that then went comes round again after this. */
const LEASE_MS = 10_000;
const LAPSE_BATCH = 200;
const HEARTBEAT_MS = 5_000;
const GONE_MS = 20_000;
/** A replica tidying after one that went has this long before another may. */
const REAP_MS = 60_000;
/** Only for records nothing ended, as every kind ends its own. */
const RECORD_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_ATTEMPTS = 10;

/*
 * KEYS: record, all, due. ARGV: member, expected version (0: must not exist),
 * next version, data ('' ends it), bulk ('' when unchanged), ttl, cap, due
 * ('' for none), the envelope's head, middle and tail around the data and
 * bulk, the bulk version the caller has, then index and publish operations.
 * Replies {1} once done, {0, version, data, bulk, bulk version} with the
 * record as it is when the version moved on (the bulk left out when the
 * caller has it), {0} when it is gone, {-1} at the cap.
 */
const COMMIT = `
local v = redis.call('HGET', KEYS[1], 'v')
if (tonumber(v) or 0) ~= tonumber(ARGV[2]) then
  if not v then return {0} end
  local now = redis.call('HMGET', KEYS[1], 'v', 'd', 'bv')
  local bv = now[3] or '0'
  local b = ''
  if bv ~= ARGV[12] then b = redis.call('HGET', KEYS[1], 'b') or '' end
  return {0, now[1], now[2], b, bv}
end
local cap = tonumber(ARGV[7])
if not v and cap > 0 and redis.call('SCARD', KEYS[2]) >= cap then return {-1} end
if ARGV[4] == '' then
  redis.call('DEL', KEYS[1])
  redis.call('SREM', KEYS[2], ARGV[1])
  redis.call('ZREM', KEYS[3], ARGV[1])
else
  redis.call('HSET', KEYS[1], 'v', ARGV[3], 'd', ARGV[4])
  if ARGV[5] ~= '' then redis.call('HSET', KEYS[1], 'b', ARGV[5], 'bv', ARGV[3]) end
  redis.call('PEXPIRE', KEYS[1], ARGV[6])
  if not v then redis.call('SADD', KEYS[2], ARGV[1]) end
  if ARGV[8] == '' then redis.call('ZREM', KEYS[3], ARGV[1])
  else redis.call('ZADD', KEYS[3], ARGV[8], ARGV[1]) end
end
local envelope
local i = 13
while i <= #ARGV do
  local op = ARGV[i]
  if op == 'PUBLISH' then
    envelope = envelope or (ARGV[9] .. ARGV[4] .. ARGV[10] .. ARGV[5] .. ARGV[11])
    redis.call('PUBLISH', ARGV[i + 1], envelope)
    i = i + 2
  elseif op == 'HDELEQ' then
    if redis.call('HGET', ARGV[i + 1], ARGV[i + 2]) == ARGV[i + 3] then
      redis.call('HDEL', ARGV[i + 1], ARGV[i + 2])
    end
    i = i + 4
  elseif op == 'HSET' then
    redis.call('HSET', ARGV[i + 1], ARGV[i + 2], ARGV[i + 3])
    i = i + 4
  elseif op == 'DEL' then
    redis.call('DEL', ARGV[i + 1])
    i = i + 2
  else
    redis.call(op, ARGV[i + 1], ARGV[i + 2])
    i = i + 3
  end
end
return {1}
`;

/** Takes what fell due, putting it off by a lease in case this replica goes. */
const CLAIM = `
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[3])
for _, member in ipairs(due) do
  redis.call('ZADD', KEYS[1], ARGV[1] + ARGV[2], member)
end
return due
`;

class Script {
  private sha: string | undefined;

  constructor(private readonly source: string) {}

  async run(
    client: RedisClientType,
    keys: string[],
    args: (string | Buffer)[]
  ): Promise<unknown> {
    this.sha ??= await client.scriptLoad(this.source);
    try {
      return await client.evalSha(this.sha, { keys, arguments: args });
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith('NOSCRIPT'))
        throw err;
      this.sha = await client.scriptLoad(this.source);
      return client.evalSha(this.sha, { keys, arguments: args });
    }
  }
}

const commitScript = new Script(COMMIT);
const claimScript = new Script(CLAIM);

/*
 * What a commit tells the replicas that hear it: the record's new version and
 * data, its bulk when that changed, and its messages. A commit's envelope is
 * put together in Redis from a head, the data, a middle, the bulk and a tail,
 * so the data goes there once. Version 0 is messages without a change.
 */

interface Envelope {
  kind: string;
  id: string;
  version: number;
  json: string;
  /** The version the bulk last changed at, and the bulk when this is it. */
  bulkAt: number;
  bulk: string;
  messages: SharedMessage[];
}

function head(kind: string, id: string, version: number, json: string) {
  const kindLength = Buffer.byteLength(kind);
  const idLength = Buffer.byteLength(id);
  const buf = Buffer.allocUnsafe(1 + kindLength + 2 + idLength + 8 + 4);
  let at = buf.writeUInt8(kindLength, 0);
  at += buf.write(kind, at);
  at = buf.writeUInt16BE(idLength, at);
  at += buf.write(id, at);
  at = buf.writeDoubleBE(version, at);
  buf.writeUInt32BE(Buffer.byteLength(json), at);
  return buf;
}

function middle(bulkAt: number, bulk: string): Buffer {
  const buf = Buffer.allocUnsafe(12);
  buf.writeDoubleBE(bulkAt, 0);
  buf.writeUInt32BE(Buffer.byteLength(bulk), 8);
  return buf;
}

function tail(messages: readonly SharedMessage[]): Buffer {
  let size = 2;
  for (const m of messages) {
    size += 1 + 2 + 4 + m.data.length;
    for (const to of m.to) size += 2 + Buffer.byteLength(to);
  }
  const buf = Buffer.allocUnsafe(size);
  let at = buf.writeUInt16BE(messages.length, 0);
  for (const m of messages) {
    at = buf.writeUInt8(m.mark, at);
    at = buf.writeUInt16BE(m.to.length, at);
    for (const to of m.to) {
      at = buf.writeUInt16BE(Buffer.byteLength(to), at);
      at += buf.write(to, at);
    }
    at = buf.writeUInt32BE(m.data.length, at);
    at += m.data.copy(buf, at);
  }
  return buf;
}

/** Messages without a change, put together here. */
function bare(kind: string, id: string, messages: readonly SharedMessage[]) {
  return Buffer.concat([head(kind, id, 0, ''), middle(0, ''), tail(messages)]);
}

function decode(buf: Buffer): Envelope {
  let at = 0;
  const text = (width: 1 | 2 | 4) => {
    const length = buf.readUIntBE(at, width);
    at += width;
    const value = buf.toString('utf8', at, at + length);
    at += length;
    return value;
  };
  const kind = text(1);
  const id = text(2);
  const version = buf.readDoubleBE(at);
  at += 8;
  const json = text(4);
  const bulkAt = buf.readDoubleBE(at);
  at += 8;
  const bulk = text(4);
  const count = buf.readUInt16BE(at);
  at += 2;
  const messages: SharedMessage[] = [];
  for (let i = 0; i < count; i++) {
    const mark = buf.readUInt8(at);
    const recipients = buf.readUInt16BE(at + 1);
    at += 3;
    const to: string[] = [];
    for (let r = 0; r < recipients; r++) to.push(text(2));
    const length = buf.readUInt32BE(at);
    at += 4;
    messages.push({ to, mark, data: buf.subarray(at, at + length) });
    at += length;
  }
  return { kind, id, version, json, bulkAt, bulk, messages };
}

interface Entry<L> {
  version: number;
  /** Empty once the record ended. */
  json: string;
  /** The bulk as heard, until it is first parsed; empty without one. */
  bulkText?: string;
  /** Parsed once, and shared by every load. */
  bulk?: unknown;
  bulkAt: number;
  /** Missed while it changed; fetched again before it is relied on. */
  stale?: boolean;
  live?: L;
}

interface Held<L> extends Entry<L> {
  holds: number;
}

interface Pending<L> {
  change: (live: L, tx: SharedTx) => unknown;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

type Outcome = { value: unknown } | { err: unknown };

function settle<L>(batch: Pending<L>[], outcomes: Outcome[]): void {
  batch.forEach((p, i) => {
    const outcome = outcomes[i];
    if ('err' in outcome) p.reject(outcome.err);
    else p.resolve(outcome.value);
  });
}

function union(a: readonly string[], b: readonly string[]): string[] {
  const out = [...a];
  for (const value of b) if (!out.includes(value)) out.push(value);
  return out;
}

/** Lists of the very same things, which loads share, or else equal as JSON. */
function sameBulk(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((value, i) => value === b[i]);
  return JSON.stringify(a) === JSON.stringify(b);
}

interface Next<L> {
  live: L | null;
  json: string;
  bulk: unknown;
  bulkChanged: boolean;
}

type Committed<L> =
  { ok: true } | { ok: false; busy?: boolean; current: Entry<L> | null };

class RedisRecords<L> implements SharedRecords<L> {
  /** Records this replica has members in, kept as the replicas hear them. */
  private readonly held = new Map<string, Held<L>>();
  private readonly waiting = new Map<string, Pending<L>[]>();
  private readonly busy = new Set<string>();
  private readonly refsKey: string;

  constructor(
    readonly kind: SharedKind<L>,
    private readonly backend: RedisBackend
  ) {
    this.refsKey = `${PREFIX}${kind.name}:refs`;
  }

  private get client(): RedisClientType {
    return this.backend.client;
  }

  private key(id: string): string {
    return `${PREFIX}${this.kind.name}:${id}`;
  }

  private logKey(id: string): string {
    return `${PREFIX}${this.kind.name}:log:${id}`;
  }

  private tagKey(tag: string): string {
    return `${PREFIX}${this.kind.name}:tag:${tag}`;
  }

  private member(id: string): string {
    return `${this.kind.name}:${id}`;
  }

  private bulkOf(entry: Entry<L>): unknown {
    if (entry.bulkText !== undefined) {
      entry.bulk = entry.bulkText ? JSON.parse(entry.bulkText) : null;
      entry.bulkText = undefined;
    }
    return entry.bulk ?? null;
  }

  private liveOf(id: string, entry: Entry<L>): L | null {
    if (!entry.json) return null;
    return (entry.live ??= this.kind.load(
      JSON.parse(entry.json),
      this.bulkOf(entry),
      id
    ));
  }

  /** A held record as last heard, when that can be relied on. */
  private current(id: string): Entry<L> | undefined {
    const held = this.held.get(id);
    return held?.version && !held.stale ? held : undefined;
  }

  /** Keeps a newer version of a held record, or a whole one of a stale. */
  private remember(id: string, entry: Entry<L>): void {
    const held = this.held.get(id);
    if (!held || entry.version < held.version) return;
    if (entry.version === held.version && (entry.stale || !held.stale)) return;
    held.version = entry.version;
    held.json = entry.json;
    held.bulkText = entry.bulkText;
    held.bulk = entry.bulk;
    held.bulkAt = entry.bulkAt;
    held.stale = entry.stale;
    held.live = entry.live;
  }

  private async fetch(id: string): Promise<Entry<L> | null> {
    const [version, json, bulk, bulkAt] = await this.client.hmGet(
      this.key(id),
      ['v', 'd', 'b', 'bv']
    );
    if (!version || !json) return null;
    const entry: Entry<L> = {
      version: Number(version),
      json,
      bulkText: bulk ?? '',
      bulkAt: Number(bulkAt ?? 0),
    };
    this.remember(id, entry);
    return entry;
  }

  peek(id: string): L | undefined {
    const held = this.held.get(id);
    return (held?.version && this.liveOf(id, held)) || undefined;
  }

  async get(id: string): Promise<L | undefined> {
    const entry = this.current(id) ?? (await this.fetch(id));
    return (entry && this.liveOf(id, entry)) ?? undefined;
  }

  async create(
    id: string,
    make: (tx: SharedTx) => L,
    cap: number
  ): Promise<CreateResult> {
    const tx = new SharedTx();
    const live = make(tx);
    const json = JSON.stringify(this.kind.save(live));
    const bulk = this.kind.bulk?.(live) ?? null;
    const next = { live, json, bulk, bulkChanged: bulk !== null };
    const done = await this.commit(id, null, next, tx, NO_INDEX, [], cap);
    if (done.ok) return 'ok';
    return done.busy ? 'busy' : 'exists';
  }

  update<R>(
    id: string,
    change: (live: L, tx: SharedTx) => R
  ): Promise<R | undefined> {
    return new Promise((resolve, reject) => {
      let queue = this.waiting.get(id);
      if (!queue) this.waiting.set(id, (queue = []));
      queue.push({
        change,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      if (this.busy.has(id)) return;
      // Changes made in this turn of the event loop commit together.
      this.busy.add(id);
      setImmediate(() => void this.run(id));
    });
  }

  /** One commit at a time per record here; what waits meanwhile commits together. */
  private async run(id: string): Promise<void> {
    try {
      for (
        let batch = this.waiting.get(id);
        batch;
        batch = this.waiting.get(id)
      ) {
        this.waiting.delete(id);
        try {
          await this.apply(id, batch);
        } catch (err) {
          for (const p of batch) p.reject(err);
        }
      }
    } finally {
      this.busy.delete(id);
    }
  }

  private async apply(id: string, batch: Pending<L>[]): Promise<void> {
    let entry = this.current(id) ?? (await this.fetch(id));
    for (let attempt = 1; ; attempt++) {
      if (!entry?.json) {
        if (!entry) void this.forget(id);
        for (const p of batch) p.resolve(undefined);
        return;
      }
      const had = this.bulkOf(entry);
      const live = this.kind.load(JSON.parse(entry.json), had, id);
      const before = indexOf(this.kind, live);
      const replicas = this.kind.replicas?.(live) ?? [];
      const mark = this.kind.before?.(live);
      const tx = new SharedTx();
      const outcomes = batch.map((p): Outcome => {
        try {
          return { value: p.change(live, tx) };
        } catch (err) {
          return { err };
        }
      });
      if (!tx.dropped) this.kind.settle?.(live, tx, mark);
      const json = tx.dropped ? '' : JSON.stringify(this.kind.save(live));
      const bulk = tx.dropped ? undefined : this.kind.bulk?.(live);
      const bulkChanged = bulk !== undefined && !sameBulk(had, bulk);
      if (!tx.messages.length && json === entry.json && !bulkChanged)
        return settle(batch, outcomes);
      const next: Next<L> = {
        live: tx.dropped ? null : live,
        json,
        bulk: bulkChanged ? bulk : had,
        bulkChanged,
      };
      const done = await this.commit(id, entry, next, tx, before, replicas, 0);
      if (done.ok) return settle(batch, outcomes);
      entry = done.current;
      if (attempt >= MAX_ATTEMPTS)
        throw new Error(`${this.kind.name} ${id} kept changing`);
    }
  }

  /** Clears what points at a record that is gone without having ended. */
  private async forget(id: string): Promise<void> {
    const member = this.member(id);
    await this.client
      .multi()
      .zRem(DUE, member)
      .sRem(ALL, member)
      .exec()
      .catch(() => undefined);
  }

  private async commit(
    id: string,
    was: Entry<L> | null,
    next: Next<L>,
    tx: SharedTx,
    before: Index,
    replicasBefore: readonly string[],
    cap: number
  ): Promise<Committed<L>> {
    const { live, json, bulk, bulkChanged } = next;
    const after = live ? indexOf(this.kind, live) : NO_INDEX;
    const ops: string[] = [];
    diff(
      before.tags,
      after.tags,
      (tag) => ops.push('SADD', this.tagKey(tag), id),
      (tag) => ops.push('SREM', this.tagKey(tag), id)
    );
    diff(
      before.refs,
      after.refs,
      (ref) => ops.push('HSET', this.refsKey, ref, id),
      (ref) => ops.push('HDELEQ', this.refsKey, ref, id)
    );
    if (!live) ops.push('DEL', this.logKey(id));
    // A new record's versions start past any it had before, which replicas may still hold.
    const version = was ? was.version + 1 : Date.now() * 1000;
    const bulkAt = bulkChanged ? version : (was?.bulkAt ?? 0);
    const sent = bulkChanged ? JSON.stringify(bulk) : '';
    const targets = this.kind.replicas
      ? union(replicasBefore, live ? this.kind.replicas(live) : [])
      : this.backend.live;
    for (const replica of targets) ops.push('PUBLISH', inbox(replica));
    const due = live ? this.kind.due(live) : null;
    const reply = (await commitScript.run(
      this.client,
      [this.key(id), ALL, DUE],
      [
        this.member(id),
        String(was?.version ?? 0),
        String(version),
        json,
        sent,
        String(RECORD_TTL_MS),
        String(cap),
        due === null ? '' : String(Math.ceil(due)),
        head(this.kind.name, id, version, json),
        middle(bulkAt, sent),
        tail(tx.messages),
        String(was?.bulkAt ?? 0),
        ...ops,
      ]
    )) as [number, string?, string?, string?, string?];
    if (reply[0] === 1) {
      this.remember(id, {
        version,
        json,
        bulk,
        bulkAt,
        live: live ?? undefined,
      });
      return { ok: true };
    }
    if (reply[0] === -1) return { ok: false, busy: true, current: null };
    if (!reply[1] || !reply[2]) return { ok: false, current: null };
    const current: Entry<L> = {
      version: Number(reply[1]),
      json: reply[2],
      bulkAt: Number(reply[4] ?? 0),
    };
    // Left out when it is still the one this replica has.
    if (reply[3]) current.bulkText = reply[3];
    else current.bulk = was ? this.bulkOf(was) : null;
    this.remember(id, current);
    return { ok: false, current };
  }

  /** A commit or message from any replica, this one's own included. */
  heard({ id, version, json, bulkAt, bulk, messages }: Envelope): void {
    if (!version) return this.kind.receive(id, messages);
    const held = this.held.get(id);
    const entry: Entry<L> = { version, json, bulkText: bulk, bulkAt };
    if (!bulk && this.kind.bulk && json) {
      // Unchanged since `bulkAt`: this replica's copy, if it heard that one.
      entry.bulkText = held?.bulkText;
      entry.bulk = held?.bulk;
      if (!held || held.bulkAt !== bulkAt || held.stale) {
        entry.stale = true;
        if (held) void this.fetch(id).catch(failed);
      }
    }
    this.remember(id, entry);
    this.kind.receive(id, messages, () =>
      this.liveOf(id, held && held.version >= version ? held : entry)
    );
  }

  private targets(id: string): readonly string[] {
    if (!this.kind.replicas) return this.backend.live;
    const live = this.peek(id);
    return live ? this.kind.replicas(live) : [];
  }

  /**
   * Messages without a change: this replica's members hear them at once, as
   * they need no order among commits, and the others' through Redis.
   */
  private send(
    multi: ReturnType<RedisClientType['multi']>,
    id: string,
    targets: readonly string[],
    tx: SharedTx
  ): boolean {
    if (!tx.messages.length) return false;
    let envelope: Buffer | undefined;
    for (const replica of targets) {
      if (replica === this.backend.replica) {
        this.kind.receive(id, tx.messages);
        continue;
      }
      envelope ??= bare(this.kind.name, id, tx.messages);
      multi.publish(inbox(replica), envelope);
    }
    return !!envelope;
  }

  publish(id: string, tx: SharedTx): void {
    const multi = this.client.multi();
    if (this.send(multi, id, this.targets(id), tx)) multi.exec().catch(failed);
  }

  broadcast(tx: SharedTx): void {
    const multi = this.client.multi();
    if (this.send(multi, '', this.backend.live, tx)) multi.exec().catch(failed);
  }

  append(id: string, entry: string, keep: number, tx: SharedTx): void {
    const key = this.logKey(id);
    const multi = this.client
      .multi()
      .rPush(key, entry)
      .lTrim(key, -keep, -1)
      .pExpire(key, RECORD_TTL_MS);
    this.send(multi, id, this.targets(id), tx);
    multi.exec().catch(failed);
  }

  log(id: string): Promise<string[]> {
    return this.client.lRange(this.logKey(id), 0, -1);
  }

  tagged(tag: string): Promise<string[]> {
    return this.client.sMembers(this.tagKey(tag));
  }

  async find(ref: string): Promise<string | undefined> {
    return (await this.client.hGet(this.refsKey, ref)) ?? undefined;
  }

  hold(id: string): void {
    const held = this.held.get(id);
    if (held) held.holds++;
    else this.held.set(id, { holds: 1, version: 0, json: '', bulkAt: 0 });
  }

  release(id: string): void {
    const held = this.held.get(id);
    if (held && --held.holds <= 0) this.held.delete(id);
  }
}

class RedisPresence implements SharedPresence {
  private readonly here = new Set<string>();

  constructor(private readonly backend: RedisBackend) {}

  private get key(): string {
    return onlineKey(this.backend.replica);
  }

  add(key: string): void {
    if (this.here.has(key)) return;
    this.here.add(key);
    this.backend.client.sAdd(this.key, key).catch(failed);
  }

  remove(key: string): void {
    if (!this.here.delete(key)) return;
    this.backend.client.sRem(this.key, key).catch(failed);
  }

  async online(key: string): Promise<boolean> {
    if (this.here.has(key)) return true;
    const others = this.backend.live.filter((r) => r !== this.backend.replica);
    if (!others.length) return false;
    const multi = this.backend.client.multi();
    for (const replica of others) multi.sIsMember(onlineKey(replica), key);
    const replies = (await multi.exec()) as unknown[];
    return replies.some((reply) => Number(reply) === 1);
  }

  of(replica: string): Promise<string[]> {
    return this.backend.client.sMembers(onlineKey(replica));
  }
}

export class RedisBackend implements SharedBackend {
  readonly replica = replicaId();
  readonly presence = new RedisPresence(this);
  /** Replicas that beat lately, this one included. */
  live: string[] = [this.replica];
  private readonly kinds = new Map<string, RedisRecords<any>>();
  private sub: RedisClientType | undefined;
  private timers: ReturnType<typeof setInterval>[] = [];
  private lapsing = false;

  constructor(private readonly connect: () => RedisClientType) {}

  get client(): RedisClientType {
    return this.connect();
  }

  records<L>(kind: SharedKind<L>): SharedRecords<L> {
    const records = new RedisRecords(kind, this);
    this.kinds.set(kind.name, records);
    return records;
  }

  async start(): Promise<void> {
    const sub = (this.sub = this.client.duplicate());
    let ready = false;
    sub.on('error', (err: Error) =>
      logger.warn({ err: err.message }, 'party subscriber error')
    );
    // Messages sent while it was away are gone.
    sub.on('ready', () => {
      if (ready)
        for (const records of this.kinds.values()) records.kind.lost?.();
      ready = true;
    });
    await sub.connect();
    await sub.subscribe(
      inbox(this.replica),
      (message: Buffer) => this.heard(message),
      true
    );
    await this.beat();
    this.timers = [
      setInterval(() => void this.lapse(), LAPSE_MS),
      setInterval(() => void this.beat().catch(failed), HEARTBEAT_MS),
    ];
    for (const timer of this.timers) timer.unref();
    logger.debug({ replica: this.replica }, 'parties kept in redis');
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer);
    await this.client
      .multi()
      .zRem(REPLICAS, this.replica)
      .del(onlineKey(this.replica))
      .exec()
      .catch(() => undefined);
    await this.sub?.quit().catch(() => undefined);
  }

  private heard(message: Buffer): void {
    try {
      const envelope = decode(message);
      this.kinds.get(envelope.kind)?.heard(envelope);
    } catch (err) {
      failed(err);
    }
  }

  private async beat(): Promise<void> {
    const now = Date.now();
    const [, live, gone] = (await this.client
      .multi()
      .zAdd(REPLICAS, { score: now, value: this.replica })
      .zRangeByScore(REPLICAS, now - GONE_MS, '+inf')
      .zRangeByScore(REPLICAS, '-inf', `(${now - GONE_MS}`)
      .exec()) as unknown as [number, string[], string[]];
    this.live = live.includes(this.replica) ? live : [...live, this.replica];
    for (const replica of gone) {
      const claimed = await this.client.set(reapKey(replica), this.replica, {
        condition: 'NX',
        expiration: { type: 'PX', value: REAP_MS },
      });
      if (claimed) await this.reap(replica);
    }
  }

  /** Forgets the replica only once tidied, so another tries if this one goes too. */
  private async reap(replica: string): Promise<void> {
    logger.info({ replica }, 'tidying parties after a replica that went');
    for (const records of this.kinds.values())
      await records.kind.orphaned?.(replica);
    await this.client
      .multi()
      .zRem(REPLICAS, replica)
      .del(onlineKey(replica))
      .exec();
  }

  private async lapse(): Promise<void> {
    if (this.lapsing) return;
    this.lapsing = true;
    try {
      const due = (await claimScript.run(
        this.client,
        [DUE],
        [String(Date.now()), String(LEASE_MS), String(LAPSE_BATCH)]
      )) as string[];
      await Promise.all(
        due.map(async (member) => {
          const at = member.indexOf(':');
          const records = this.kinds.get(member.slice(0, at));
          await records?.kind.lapse(member.slice(at + 1));
        })
      );
    } catch (err) {
      failed(err);
    } finally {
      this.lapsing = false;
    }
  }
}

const failed = (err: unknown) =>
  logger.warn(
    { err: err instanceof Error ? err.message : err },
    'party store failed'
  );
