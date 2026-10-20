import { createLogger } from '../../logging/logger.js';
import { diff, indexOf, NO_INDEX, replicaId, type Index } from './helpers.js';
import {
  SharedTx,
  type CreateResult,
  type SharedBackend,
  type SharedKind,
  type SharedPresence,
  type SharedRecords,
} from './types.js';

const logger = createLogger('party');

const LAPSE_MS = 1_000;

/** Live objects changed in place; tags and refs are indexed as each change commits. */
class MemoryRecords<L> implements SharedRecords<L> {
  readonly live = new Map<string, L>();
  readonly due = new Map<string, number>();
  /** Records changed this turn, with what `settle` compares them to. */
  readonly turn = new Map<string, unknown>();
  private readonly logs = new Map<string, string[]>();
  private readonly indexed = new Map<string, Index>();
  private readonly byTag = new Map<string, Set<string>>();
  private readonly byRef = new Map<string, string>();

  constructor(
    readonly kind: SharedKind<L>,
    private readonly backend: MemoryBackend
  ) {}

  peek(id: string): L | undefined {
    return this.live.get(id);
  }

  get(id: string): L | undefined {
    return this.live.get(id);
  }

  create(id: string, make: (tx: SharedTx) => L, cap: number): CreateResult {
    if (this.live.has(id)) return 'exists';
    const count = this.kind.ownCap ? this.live.size : this.backend.count();
    if (cap > 0 && count >= cap) return 'busy';
    const tx = new SharedTx();
    const live = make(tx);
    this.live.set(id, live);
    this.commit(id, live, tx);
    return 'ok';
  }

  update<R>(id: string, change: (live: L, tx: SharedTx) => R): R | undefined {
    const live = this.live.get(id);
    if (live === undefined) return undefined;
    const tx = new SharedTx();
    if (this.kind.settle && !this.turn.has(id)) {
      this.turn.set(id, this.kind.before?.(live));
      this.backend.settleSoon(this);
    }
    try {
      return change(live, tx);
    } finally {
      this.commit(id, live, tx);
    }
  }

  settle(): void {
    for (const [id, before] of this.turn) {
      const live = this.live.get(id);
      if (live === undefined) continue;
      const tx = new SharedTx();
      this.kind.settle!(live, tx, before);
      this.reindex(id, live);
      this.kind.receive(id, tx.messages);
    }
    this.turn.clear();
  }

  private reindex(id: string, live: L | null): void {
    const before = this.indexed.get(id) ?? NO_INDEX;
    const after = live ? indexOf(this.kind, live) : NO_INDEX;
    diff(
      before.tags,
      after.tags,
      (tag) => {
        let ids = this.byTag.get(tag);
        if (!ids) this.byTag.set(tag, (ids = new Set()));
        ids.add(id);
      },
      (tag) => {
        const ids = this.byTag.get(tag);
        if (ids?.delete(id) && !ids.size) this.byTag.delete(tag);
      }
    );
    diff(
      before.refs,
      after.refs,
      (ref) => this.byRef.set(ref, id),
      (ref) => {
        if (this.byRef.get(ref) === id) this.byRef.delete(ref);
      }
    );
    if (live) this.indexed.set(id, after);
    else this.indexed.delete(id);
  }

  private commit(id: string, live: L, tx: SharedTx): void {
    this.reindex(id, tx.dropped ? null : live);
    if (tx.dropped) {
      this.live.delete(id);
      this.due.delete(id);
      this.turn.delete(id);
      this.logs.delete(id);
    } else {
      const due = this.kind.due(live);
      if (due === null) this.due.delete(id);
      else this.due.set(id, due);
    }
    this.kind.receive(id, tx.messages, () => (tx.dropped ? null : live));
  }

  publish(id: string, tx: SharedTx): void {
    this.kind.receive(id, tx.messages);
  }

  broadcast(tx: SharedTx): void {
    this.kind.receive('', tx.messages);
  }

  append(id: string, entry: string, keep: number, tx: SharedTx): void {
    if (!this.live.has(id)) return;
    let log = this.logs.get(id);
    if (!log) this.logs.set(id, (log = []));
    log.push(entry);
    if (log.length > keep) log.splice(0, log.length - keep);
    this.kind.receive(id, tx.messages);
  }

  log(id: string): string[] {
    return [...(this.logs.get(id) ?? [])];
  }

  tagged(tag: string): string[] {
    return [...(this.byTag.get(tag) ?? [])];
  }

  find(ref: string): string | undefined {
    return this.byRef.get(ref);
  }

  hold(): void {}

  release(): void {}
}

class MemoryPresence implements SharedPresence {
  private readonly here = new Set<string>();

  add(key: string): void {
    this.here.add(key);
  }

  remove(key: string): void {
    this.here.delete(key);
  }

  online(key: string): boolean {
    return this.here.has(key);
  }

  async of(): Promise<string[]> {
    return [];
  }
}

export class MemoryBackend implements SharedBackend {
  readonly replica = replicaId();
  readonly presence = new MemoryPresence();
  private readonly kinds: MemoryRecords<any>[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly settling = new Set<MemoryRecords<any>>();

  records<L>(kind: SharedKind<L>): SharedRecords<L> {
    const records = new MemoryRecords(kind, this);
    this.kinds.push(records);
    return records;
  }

  settleSoon(records: MemoryRecords<any>): void {
    if (!this.settling.size)
      setImmediate(() => {
        for (const records of this.settling) records.settle();
        this.settling.clear();
      });
    this.settling.add(records);
  }

  count(): number {
    let count = 0;
    for (const records of this.kinds)
      if (!records.kind.ownCap) count += records.live.size;
    return count;
  }

  async start(): Promise<void> {
    this.timer = setInterval(() => this.lapse(), LAPSE_MS);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
  }

  private lapse(): void {
    const now = Date.now();
    for (const records of this.kinds) {
      const due: string[] = [];
      for (const [id, at] of records.due) if (at <= now) due.push(id);
      for (const id of due) {
        try {
          const done = records.kind.lapse(id);
          if (done instanceof Promise) done.catch(failed);
        } catch (err) {
          failed(err);
        }
      }
    }
  }
}

const failed = (err: unknown) =>
  logger.warn(
    { err: err instanceof Error ? err.message : err },
    'party deadline failed'
  );
