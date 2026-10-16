/*
 * Where parties and SyncPlay groups live: in this process, or in Redis for
 * replicas that share it. There, any replica changes a record by compare and
 * set, and the replicas holding its members hear the new record and what it
 * says to them, in the order the changes landed.
 */

export type MaybePromise<T> = T | Promise<T>;

export function andThen<T, U>(
  value: MaybePromise<T>,
  next: (value: T) => U
): MaybePromise<U> {
  return value instanceof Promise ? value.then(next) : next(value);
}

/** Bytes for some of a record's members; each replica hands its own theirs. */
export interface SharedMessage {
  to: readonly string[];
  data: Buffer;
  /** The kind's own mark, such as which messages are commands. */
  mark: number;
}

/** What a change says, and whether it ends the record. */
export class SharedTx {
  readonly messages: SharedMessage[] = [];
  dropped = false;

  send(to: readonly string[], data: Buffer, mark = 0): void {
    if (to.length) this.messages.push({ to, data, mark });
  }

  drop(): void {
    this.dropped = true;
  }
}

export interface SharedKind<L> {
  readonly name: string;
  save(live: L): unknown;
  /**
   * What weighs most and changes least, such as a queue's items, which is
   * stored and sent only when it changes. Loads share it, so `load` must not
   * change it in place.
   */
  bulk?(live: L): unknown;
  /** `bulk` is null for a kind without one. */
  load(saved: any, bulk: any, id: string): L;
  /** Taken before a run of changes to a record, for `settle`. */
  before?(live: L): unknown;
  /** What a run of changes amounts to, said once for them all. */
  settle?(live: L, tx: SharedTx, before: unknown): void;
  /** When `lapse` should next look at it. */
  due(live: L): number | null;
  /** Sets it is listed in. */
  tags(live: L): readonly string[];
  /** Keys that find it besides its id. */
  refs?(live: L): readonly string[];
  /** The replicas that hear it; every replica when absent. */
  replicas?(live: L): readonly string[];
  /**
   * On each replica that hears it. `record` is there when the record changed,
   * and gives null once it ended.
   */
  receive(
    id: string,
    messages: readonly SharedMessage[],
    record?: () => L | null
  ): void;
  lapse(id: string): MaybePromise<void>;
  /** A replica went without saying, leaving this kind's records to tidy. */
  orphaned?(replica: string): Promise<void>;
  /** This replica may have missed messages. */
  lost?(): void;
}

export type CreateResult = 'ok' | 'exists' | 'busy';

export interface SharedRecords<L> {
  /** As this replica last heard it, without asking; read only. */
  peek(id: string): L | undefined;
  get(id: string): MaybePromise<L | undefined>;
  /** Fails when the id is taken, or `cap` records of any kind exist. */
  create(
    id: string,
    make: (tx: SharedTx) => L,
    cap: number
  ): MaybePromise<CreateResult>;
  /**
   * What `change` returned, or undefined without such a record. `change` may
   * run more than once, so it acts only through the record and `tx`. Changes
   * made in one turn of the event loop settle as one, and in Redis so do those
   * made while a commit is under way.
   */
  update<R>(
    id: string,
    change: (live: L, tx: SharedTx) => R
  ): MaybePromise<R | undefined>;
  /** Messages without a change, to the replicas the record last named. */
  publish(id: string, tx: SharedTx): void;
  /** Messages to every replica, about no record. */
  broadcast(tx: SharedTx): void;
  /** Adds to the record's log, keeping the newest, and publishes `tx`. */
  append(id: string, entry: string, keep: number, tx: SharedTx): void;
  log(id: string): MaybePromise<string[]>;
  tagged(tag: string): MaybePromise<string[]>;
  find(ref: string): MaybePromise<string | undefined>;
  /** Keeps `peek` current while this replica has members in it. */
  hold(id: string): void;
  release(id: string): void;
}

/** Which clients are connected, on any replica. */
export interface SharedPresence {
  add(key: string): void;
  remove(key: string): void;
  online(key: string): MaybePromise<boolean>;
  /** The keys a gone replica had, for `orphaned`. */
  of(replica: string): Promise<string[]>;
}

export interface SharedBackend {
  /** This process, as other replicas know it. */
  readonly replica: string;
  records<L>(kind: SharedKind<L>): SharedRecords<L>;
  readonly presence: SharedPresence;
  start(): Promise<void>;
  stop(): Promise<void>;
}
