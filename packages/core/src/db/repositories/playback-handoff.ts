import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import { config as appConfig } from '../../config/index.js';
import { deleteInBatches, type PruneResult } from '../prune.js';
import { join, raw, sql, type SqlFragment } from '../sql.js';
import type { WatchScope } from '../../watch-state/types.js';

/** `error` is a run of permanent failures; `auth_expired` needs the user. */
export type SinkStatus = 'connected' | 'auth_expired' | 'error';

/** A row stays `pending` while it still has attempts left. */
export type DeliveryStatus = 'pending' | 'delivered' | 'failed';

export interface SinkRow {
  id: string;
  uuid: string;
  persona: string;
  addonInstanceId: string;
  addonName: string | null;
  baseUrl: string;
  /** Absent when the addon declares no `pull` half. */
  pullUrl: string | null;
  /** Query string from the manifest URL, which carries the addon's config. */
  query: string;
  /** What the addon declared, so a background job can route without a config. */
  events: string[];
  types: string[];
  idPrefixes: string[] | null;
  status: SinkStatus;
  consecutiveFailures: number;
  lastPushAt: number | null;
  lastError: string | null;
  lastErrorKind: string | null;
  /** The opaque validator the addon last answered with. */
  pullVersion: string | null;
  lastPullAt: number | null;
  lastPullError: string | null;
  createdAt: number;
  updatedAt: number;
  /** Routing fields hashed; an unchanged hash skips the write. */
  routingHash: string | null;
  /** When `status` last changed; `updatedAt` moves for other reasons. */
  statusAt: number;
  /** Last time this configuration was seen using the addon. */
  activeAt: number;
  /** When this sink next has a delivery due; null when nothing is queued. */
  nextDeliveryAt: number | null;
  /** When this sink is next due a read; null when it answers no pull half. */
  nextPullAt: number | null;
  deliveryClaimedBy: string | null;
  deliveryClaimExpiresAt: number | null;
  pullClaimedBy: string | null;
  pullClaimExpiresAt: number | null;
  pullFailures: number;
  /** Set while no user syncs with it; background reads and idle stops skip it. */
  retiredAt: number | null;
}

export interface DeliveryRow {
  id: string;
  sinkId: string;
  idempotencyKey: string;
  event: string;
  itemKey: string;
  url: string;
  body: string;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  deliveredAt: number | null;
  /** Lower goes first within a sink. */
  priority: number;
  /** The item keys a bulk row stands for; null on a single event. */
  covers: string[] | null;
}

export interface QueuedEvent {
  idempotencyKey: string;
  event: string;
  itemKey: string;
  url: string;
  body: string;
  priority: number;
  covers?: string[];
  /** Kinds of older pending event, for the same items, that this one replaces. */
  replaces: readonly string[];
}

interface DbSink {
  id: string;
  uuid: string;
  persona: string;
  addon_instance_id: string;
  addon_name: string | null;
  base_url: string;
  pull_url: string | null;
  query: string | null;
  events: string | null;
  types: string | null;
  id_prefixes: string | null;
  status: string;
  consecutive_failures: number | string;
  last_push_at: number | string | null;
  last_error: string | null;
  last_error_kind: string | null;
  pull_version: string | null;
  last_pull_at: number | string | null;
  last_pull_error: string | null;
  created_at: number | string;
  updated_at: number | string;
  routing_hash: string | null;
  status_at: number | string;
  active_at: number | string;
  next_delivery_at: number | string | null;
  next_pull_at: number | string | null;
  delivery_claimed_by: string | null;
  delivery_claim_expires_at: number | string | null;
  pull_claimed_by: string | null;
  pull_claim_expires_at: number | string | null;
  pull_failures: number | string;
  retired_at: number | string | null;
  [k: string]: unknown;
}

interface DbDelivery {
  id: string;
  sink_id: string;
  idempotency_key: string;
  event: string;
  item_key: string;
  url: string;
  body: string;
  status: string;
  attempts: number | string;
  next_attempt_at: number | string;
  last_error: string | null;
  created_at: number | string;
  updated_at: number | string;
  delivered_at: number | string | null;
  priority: number | string | null;
  covers: string | null;
  [k: string]: unknown;
}

const CHUNK = 200;

/** A sink waiting on a single event is claimed before one holding only bulk marks. */
const laneOf = (sinkId: string) =>
  sql`COALESCE((SELECT MIN(d.priority) FROM watch_deliveries d
                 WHERE d.sink_id = ${sinkId} AND d.status = 'pending'), 0)`;

/** A turn that ran out with work queued goes behind new events, unless more was queued during it. */
const BACKLOG_LANES = 2;
const backlogLaneOf = (sinkId: string, claimedAt: number) =>
  sql`${laneOf(sinkId)} + CASE WHEN EXISTS (
         SELECT 1 FROM watch_deliveries d
          WHERE d.sink_id = ${sinkId} AND d.status = 'pending'
            AND d.created_at >= ${claimedAt})
       THEN 0 ELSE ${raw(String(BACKLOG_LANES))} END`;

const FRESH_SHARE = 0.5;

function optionalNumber(v: number | string | null): number | null {
  return v == null ? null : Number(v);
}

function parseList(v: string | null): string[] | null {
  if (!v) return null;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null;
  }
}

function toSink(r: DbSink): SinkRow {
  return {
    id: r.id,
    uuid: r.uuid,
    persona: r.persona,
    addonInstanceId: r.addon_instance_id,
    addonName: r.addon_name,
    baseUrl: r.base_url,
    pullUrl: r.pull_url,
    query: r.query ?? '',
    events: parseList(r.events) ?? [],
    types: parseList(r.types) ?? [],
    idPrefixes: parseList(r.id_prefixes),
    status: r.status as SinkStatus,
    consecutiveFailures: Number(r.consecutive_failures),
    lastPushAt: optionalNumber(r.last_push_at),
    lastError: r.last_error,
    lastErrorKind: r.last_error_kind,
    pullVersion: r.pull_version,
    lastPullAt: optionalNumber(r.last_pull_at),
    lastPullError: r.last_pull_error,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    routingHash: r.routing_hash ?? null,
    statusAt: Number(r.status_at ?? 0),
    activeAt: Number(r.active_at ?? 0),
    nextDeliveryAt: optionalNumber(r.next_delivery_at),
    nextPullAt: optionalNumber(r.next_pull_at),
    deliveryClaimedBy: r.delivery_claimed_by ?? null,
    deliveryClaimExpiresAt: optionalNumber(r.delivery_claim_expires_at),
    pullClaimedBy: r.pull_claimed_by ?? null,
    pullClaimExpiresAt: optionalNumber(r.pull_claim_expires_at),
    pullFailures: Number(r.pull_failures ?? 0),
    retiredAt: optionalNumber(r.retired_at ?? null),
  };
}

function toDelivery(r: DbDelivery): DeliveryRow {
  return {
    id: r.id,
    sinkId: r.sink_id,
    idempotencyKey: r.idempotency_key,
    event: r.event,
    itemKey: r.item_key,
    url: r.url,
    body: r.body,
    status: r.status as DeliveryStatus,
    attempts: Number(r.attempts),
    nextAttemptAt: Number(r.next_attempt_at),
    lastError: r.last_error,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    deliveredAt: optionalNumber(r.delivered_at),
    priority: Number(r.priority ?? 0),
    covers: parseList(r.covers),
  };
}

export class PlaybackHandoffRepository {
  static async getSinkByAddon(
    scope: WatchScope,
    addonInstanceId: string
  ): Promise<SinkRow | null> {
    const row = await getDb().maybeOne<DbSink>(
      sql`SELECT * FROM watch_sinks
           WHERE uuid = ${scope.uuid} AND persona = ${scope.persona}
             AND addon_instance_id = ${addonInstanceId}`
    );
    return row ? toSink(row) : null;
  }

  /** Filtered on by {@link claimPullSinks}; one write per window at most. */
  static async touchActive(
    id: string,
    now: number,
    windowMs: number
  ): Promise<void> {
    await getDb().exec(
      sql`UPDATE watch_sinks SET active_at = ${now}
           WHERE id = ${id} AND active_at < ${now - windowMs}`
    );
  }

  /** Leaves existing health alone. */
  static async ensureSink(
    scope: WatchScope,
    input: {
      addonInstanceId: string;
      addonName?: string;
      baseUrl: string;
      pullUrl?: string | null;
      query?: string;
      events?: string[];
      types?: string[];
      idPrefixes?: string[] | null;

      routingHash?: string;
    }
  ): Promise<SinkRow> {
    const now = Date.now();
    const name = input.addonName ?? null;
    const pullUrl = input.pullUrl ?? null;
    const query = input.query ?? '';
    const events = JSON.stringify(input.events ?? []);
    const types = JSON.stringify(input.types ?? []);
    const idPrefixes = input.idPrefixes?.length
      ? JSON.stringify(input.idPrefixes)
      : null;
    const routingHash = input.routingHash ?? null;
    /* 0 means due now, null means no pull half; the scheduler owns it after. */
    await getDb().exec(
      sql`INSERT INTO watch_sinks
            (id, uuid, persona, addon_instance_id, addon_name, base_url, pull_url,
             query, events, types, id_prefixes, status,
             consecutive_failures, created_at, updated_at,
             routing_hash, status_at, active_at, next_pull_at, pull_failures)
          VALUES (${randomUUID()}, ${scope.uuid}, ${scope.persona},
                  ${input.addonInstanceId}, ${name},
                  ${input.baseUrl}, ${pullUrl}, ${query}, ${events}, ${types},
                  ${idPrefixes}, 'connected', 0, ${now}, ${now},
                  ${routingHash}, ${now}, ${now}, ${pullUrl ? 0 : null}, 0)
          ON CONFLICT(uuid, persona, addon_instance_id) DO UPDATE SET
            addon_name = COALESCE(excluded.addon_name, watch_sinks.addon_name),
            base_url = excluded.base_url,
            pull_url = excluded.pull_url,
            query = excluded.query,
            events = excluded.events,
            types = excluded.types,
            id_prefixes = excluded.id_prefixes,
            routing_hash = excluded.routing_hash,
            retired_at = NULL,
            next_pull_at = CASE
              WHEN excluded.pull_url IS NULL THEN NULL
              WHEN watch_sinks.pull_url IS NULL THEN 0
              ELSE watch_sinks.next_pull_at END,
            updated_at = excluded.updated_at`
    );
    const row = await getDb().maybeOne<DbSink>(
      sql`SELECT * FROM watch_sinks
           WHERE uuid = ${scope.uuid} AND persona = ${scope.persona}
             AND addon_instance_id = ${input.addonInstanceId}`
    );
    if (!row) throw new Error('failed to persist playback sink');
    return toSink(row);
  }

  static async listSinks(scope: WatchScope): Promise<SinkRow[]> {
    const rows = await getDb().query<DbSink>(
      sql`SELECT * FROM watch_sinks
           WHERE uuid = ${scope.uuid} AND persona = ${scope.persona}
             AND retired_at IS NULL
           ORDER BY addon_name, addon_instance_id`
    );
    return rows.map(toSink);
  }

  static async retireSinksExcept(
    scope: WatchScope,
    keepInstanceIds: readonly string[],
    now: number
  ): Promise<number> {
    const keep = keepInstanceIds.length
      ? sql`AND addon_instance_id NOT IN (${join(keepInstanceIds.map((id) => sql`${id}`))})`
      : raw('');
    const res = await getDb().exec(
      sql`UPDATE watch_sinks SET retired_at = ${now}
           WHERE uuid = ${scope.uuid} AND persona = ${scope.persona}
             AND retired_at IS NULL ${keep}`
    );
    return res.rowCount ?? 0;
  }

  static async retireOtherPersonas(
    uuid: string,
    keepPersonaIds: readonly string[],
    now: number
  ): Promise<number> {
    const keep = keepPersonaIds.length
      ? sql`AND persona NOT IN (${join(keepPersonaIds.map((id) => sql`${id}`))})`
      : raw('');
    const res = await getDb().exec(
      sql`UPDATE watch_sinks SET retired_at = ${now}
           WHERE uuid = ${uuid} AND persona <> ''
             AND retired_at IS NULL ${keep}`
    );
    return res.rowCount ?? 0;
  }

  /** Every persona's sinks, for the configuration's own diagnostics. */
  static async listAllSinks(uuid: string): Promise<SinkRow[]> {
    const rows = await getDb().query<DbSink>(
      sql`SELECT * FROM watch_sinks WHERE uuid = ${uuid}
           ORDER BY persona, addon_name, addon_instance_id`
    );
    return rows.map(toSink);
  }

  static async setSinkStatus(
    id: string,
    status: SinkStatus,
    opts: { error?: string; errorKind?: string; failures?: number } = {}
  ): Promise<void> {
    const now = Date.now();
    const error = opts.error ?? null;
    const kind = opts.errorKind ?? null;
    const failures = opts.failures ?? null;
    await getDb().exec(
      sql`UPDATE watch_sinks SET
            status = ${status},
            status_at = CASE WHEN status = ${status} THEN status_at ELSE ${now} END,
            last_error = ${error},
            last_error_kind = ${kind},
            consecutive_failures = COALESCE(${failures}, consecutive_failures),
            updated_at = ${now}
          WHERE id = ${id}`
    );
  }

  /**
   * Returns how many were new. Pending events these replace are dropped, and a
   * bulk row loses the items they cover.
   */
  static async enqueueMany(
    sinkId: string,
    events: QueuedEvent[]
  ): Promise<number> {
    if (!events.length) return 0;
    const now = Date.now();
    /* One transaction: the scheduler reads only the pointer, so a row
     * committed without one is never picked up. */
    return getDb().tx(async (tx) => {
      const replacedBy = new Map<string, Set<string>>();
      const byKinds = new Map<string, { kinds: string[]; keys: string[] }>();
      for (const e of events) {
        if (!e.replaces.length) continue;
        const covered = e.covers ?? [e.itemKey];
        for (const kind of e.replaces) {
          const keys = replacedBy.get(kind) ?? new Set<string>();
          for (const key of covered) keys.add(key);
          replacedBy.set(kind, keys);
        }
        const kinds = [...e.replaces].sort();
        const group = byKinds.get(kinds.join()) ?? { kinds, keys: [] };
        group.keys.push(...covered);
        byKinds.set(kinds.join(), group);
      }

      for (const { kinds, keys } of byKinds.values()) {
        for (let i = 0; i < keys.length; i += CHUNK) {
          await tx.exec(
            sql`DELETE FROM watch_deliveries
                 WHERE sink_id = ${sinkId} AND status = 'pending'
                   AND covers IS NULL
                   AND event IN (${join(kinds.map((k) => sql`${k}`))})
                   AND item_key IN (${join(keys.slice(i, i + CHUNK).map((k) => sql`${k}`))})`
          );
        }
      }

      if (replacedBy.size) {
        const bulk = await tx.query<DbDelivery>(
          sql`SELECT * FROM watch_deliveries
               WHERE sink_id = ${sinkId} AND status = 'pending'
                 AND covers IS NOT NULL`
        );
        for (const row of bulk.map(toDelivery)) {
          const replaced = replacedBy.get(row.event);
          const covers = row.covers ?? [];
          if (!replaced || !covers.some((key) => replaced.has(key))) continue;
          const keep = covers.map((key) => !replaced.has(key));
          if (!keep.includes(true)) {
            await tx.exec(
              sql`DELETE FROM watch_deliveries WHERE id = ${row.id}`
            );
            continue;
          }
          const body = JSON.parse(row.body);
          body.videos = (body.videos ?? []).filter(
            (_: unknown, i: number) => keep[i]
          );
          await tx.exec(
            sql`UPDATE watch_deliveries
                   SET body = ${JSON.stringify(body)},
                       covers = ${JSON.stringify(covers.filter((_, i) => keep[i]))},
                       updated_at = ${now}
                 WHERE id = ${row.id}`
          );
        }
      }

      let queued = 0;
      for (let i = 0; i < events.length; i += CHUNK) {
        const values = events.slice(i, i + CHUNK).map(
          (e) =>
            sql`(${randomUUID()}, ${sinkId}, ${e.idempotencyKey}, ${e.event},
                   ${e.itemKey}, ${e.url}, ${e.body}, 'pending', 0, ${now},
                   ${now}, ${now}, ${e.priority},
                   ${e.covers ? JSON.stringify(e.covers) : null})`
        );
        const res = await tx.exec(
          sql`INSERT INTO watch_deliveries
                (id, sink_id, idempotency_key, event, item_key, url, body, status,
                 attempts, next_attempt_at, created_at, updated_at, priority,
                 covers)
              VALUES ${join(values)}
              ON CONFLICT (sink_id, idempotency_key) DO NOTHING`
        );
        queued += res.rowCount;
      }
      if (!queued) return 0;
      await tx.exec(
        sql`UPDATE watch_sinks
               SET next_delivery_at = CASE
                     WHEN next_delivery_at IS NULL OR next_delivery_at > ${now}
                     THEN ${now} ELSE next_delivery_at END,
                   delivery_lane = ${laneOf(sinkId)}
             WHERE id = ${sinkId}`
      );
      return queued;
    });
  }

  /** Due rows, oldest first; an unhealthy sink only once past `probeBefore`. */
  /**
   * Leases the addons whose queues are due, so every instance can deliver.
   *
   * The lease is per addon, not per event: one in-flight request per addon is
   * what keeps a `stop` from overtaking its `start`.
   */
  static async claimDeliverySinks(
    token: string,
    now: number,
    leaseMs: number,
    limit: number
  ): Promise<SinkRow[]> {
    // Postgres re-runs the LIMIT subquery on a conflict; SQLite has one writer.
    const skipLocked =
      getDb().dialect === 'postgres' ? raw('FOR UPDATE SKIP LOCKED') : raw('');
    // Newest half so a fresh event does not wait for every first turn, oldest
    // half so a backlog still drains; one transaction so a failure leases nothing.
    const rows = await getDb().tx(async (tx) => {
      const claim = (order: SqlFragment, count: number, lane: SqlFragment) =>
        tx.exec(
          sql`UPDATE watch_sinks
                 SET delivery_claimed_by = ${token},
                     delivery_claim_expires_at = ${now + leaseMs}
               WHERE id IN (
                 SELECT id FROM watch_sinks
                  WHERE next_delivery_at IS NOT NULL
                    AND next_delivery_at <= ${now}
                    AND (delivery_claim_expires_at IS NULL
                         OR delivery_claim_expires_at <= ${now})
                    ${lane}
                  ORDER BY ${order}
                  LIMIT ${count} ${skipLocked}
               )`
        );
      const newest = await claim(
        raw('next_delivery_at DESC'),
        Math.ceil(limit * FRESH_SHARE),
        raw('AND delivery_lane = 0')
      );
      await claim(
        raw('delivery_lane ASC, next_delivery_at ASC'),
        limit - (newest.rowCount ?? 0),
        raw('')
      );
      return tx.query<DbSink>(
        sql`SELECT * FROM watch_sinks WHERE delivery_claimed_by = ${token}`
      );
    });
    return rows.map(toSink);
  }

  static async dueDeliveries(
    sinkId: string,
    now: number,
    limit: number
  ): Promise<DeliveryRow[]> {
    const rows = await getDb().query<DbDelivery>(
      sql`SELECT * FROM watch_deliveries
           WHERE sink_id = ${sinkId} AND status = 'pending'
             AND next_attempt_at <= ${now}
           ORDER BY priority ASC, next_attempt_at ASC, created_at ASC
           LIMIT ${limit}`
    );
    return rows.map(toDelivery);
  }

  /**
   * Releases an addon and recomputes when it is next due.
   *
   * The pointer never lands earlier than `notBefore`, which is how a failing
   * addon is held back instead of filling every pass.
   */
  static async releaseDeliverySink(
    id: string,
    token: string,
    opts: {
      now: number;
      notBefore: number;
      status?: SinkStatus;
      failures?: number;
      lastPushAt?: number | null;
      error?: string | null;
      errorKind?: string | null;
      /** The turn ended with work still queued. */
      backlog?: boolean;
      claimedAt?: number;
    }
  ): Promise<void> {
    const { now, notBefore } = opts;
    const status = opts.status ?? null;
    await getDb().exec(
      sql`UPDATE watch_sinks
             SET delivery_claimed_by = NULL,
                 delivery_claim_expires_at = NULL,
                 next_delivery_at = (
                   SELECT CASE
                     WHEN MIN(d.next_attempt_at) IS NULL THEN NULL
                     WHEN MIN(d.next_attempt_at) < ${notBefore} THEN ${notBefore}
                     ELSE MIN(d.next_attempt_at) END
                     FROM watch_deliveries d
                    WHERE d.sink_id = watch_sinks.id AND d.status = 'pending'
                 ),
                 delivery_lane = ${opts.backlog ? backlogLaneOf(id, opts.claimedAt ?? now) : laneOf(id)},
                 consecutive_failures = COALESCE(${opts.failures ?? null}, consecutive_failures),
                 status = COALESCE(${status}, status),
                 status_at = CASE WHEN CAST(${status} AS TEXT) IS NOT NULL AND ${status} <> status
                                  THEN ${now} ELSE status_at END,
                 last_push_at = COALESCE(${opts.lastPushAt ?? null}, last_push_at),
                 last_error = ${opts.error ?? null},
                 last_error_kind = ${opts.errorKind ?? null},
                 updated_at = ${now}
           WHERE id = ${id} AND delivery_claimed_by = ${token}`
    );
  }

  /**
   * Re-points addons holding due events whose pointer disagrees.
   *
   * Enqueue writes both together, so this only catches a release and an enqueue
   * interleaving, and pointers written by a version that did not maintain them.
   */
  static async reconcileDeliveryPointers(
    now: number,
    limit: number
  ): Promise<number> {
    const res = await getDb().exec(
      sql`UPDATE watch_sinks
             SET next_delivery_at = ${now}
           WHERE id IN (
             SELECT s.id FROM watch_sinks s
              WHERE (s.next_delivery_at IS NULL OR s.next_delivery_at > ${now})
                AND (s.delivery_claim_expires_at IS NULL
                     OR s.delivery_claim_expires_at <= ${now})
                AND EXISTS (
                  SELECT 1 FROM watch_deliveries d
                   WHERE d.sink_id = s.id AND d.status = 'pending'
                     AND d.next_attempt_at <= ${now}
                )
              LIMIT ${limit}
           )`
    );
    return res.rowCount;
  }

  static async markDelivered(id: string, at: number): Promise<void> {
    await getDb().exec(
      sql`UPDATE watch_deliveries SET
            status = 'delivered', attempts = attempts + 1,
            delivered_at = ${at}, updated_at = ${at}, last_error = NULL
          WHERE id = ${id}`
    );
  }

  static async markRetry(
    id: string,
    nextAttemptAt: number,
    error: string
  ): Promise<void> {
    const now = Date.now();
    await getDb().exec(
      sql`UPDATE watch_deliveries SET
            attempts = attempts + 1, next_attempt_at = ${nextAttemptAt},
            last_error = ${error}, updated_at = ${now}
          WHERE id = ${id}`
    );
  }

  static async markFailed(id: string, error: string): Promise<void> {
    const now = Date.now();
    await getDb().exec(
      sql`UPDATE watch_deliveries SET
            status = 'failed', attempts = attempts + 1,
            last_error = ${error}, updated_at = ${now}
          WHERE id = ${id}`
    );
  }

  static async countPending(sinkId: string): Promise<number> {
    const row = await getDb().maybeOne<{ n: number | string }>(
      sql`SELECT COUNT(*) AS n FROM watch_deliveries
           WHERE sink_id = ${sinkId} AND status = 'pending'`
    );
    return row ? Number(row.n) : 0;
  }

  /**
   * Cuts a sink's queue back to `keep` rows.
   *
   * Pings go first: a `played` or `unplayed` is a user decision nothing else
   * carries, so it is only dropped when cutting the pings did not free enough.
   */
  static async trimPending(sinkId: string, keep: number): Promise<number> {
    // A subquery LIMIT: the drivers spell an unbounded OFFSET differently.
    const older = (events?: string[]) =>
      sql`DELETE FROM watch_deliveries
           WHERE sink_id = ${sinkId} AND status = 'pending'
             ${
               events
                 ? sql`AND event IN (${join(events.map((e) => sql`${e}`))})`
                 : sql``
             }
             AND created_at < (
               SELECT MIN(created_at) FROM (
                 SELECT created_at FROM watch_deliveries
                  WHERE sink_id = ${sinkId} AND status = 'pending'
                  ORDER BY created_at DESC
                  LIMIT ${keep}
               ) newest
             )`;
    const pings = await getDb().exec(older(['start', 'pause', 'stop']));
    if ((await this.countPending(sinkId)) <= keep) return pings.rowCount;
    const rest = await getDb().exec(older());
    return pings.rowCount + rest.rowCount;
  }

  /** Sinks with a pull half whose snapshot is older than `staleBefore`. */
  /**
   * Leases the addons due to be read from.
   *
   * `next_pull_at` carries staleness, health and eligibility in one number.
   * `activeSince` spends the budget on configurations someone is watching from;
   * the rest are read on demand when they come back.
   */
  static async claimPullSinks(
    token: string,
    now: number,
    leaseMs: number,
    limit: number,
    activeSince: number
  ): Promise<SinkRow[]> {
    const skipLocked =
      getDb().dialect === 'postgres' ? raw('FOR UPDATE SKIP LOCKED') : raw('');
    await getDb().exec(
      sql`UPDATE watch_sinks
             SET pull_claimed_by = ${token},
                 pull_claim_expires_at = ${now + leaseMs}
           WHERE id IN (
             SELECT id FROM watch_sinks
              WHERE next_pull_at IS NOT NULL
                AND next_pull_at <= ${now}
                AND active_at >= ${activeSince}
                AND retired_at IS NULL
                AND (pull_claim_expires_at IS NULL
                     OR pull_claim_expires_at <= ${now})
              ORDER BY next_pull_at ASC
              LIMIT ${limit} ${skipLocked}
           )`
    );
    const rows = await getDb().query<DbSink>(
      sql`SELECT * FROM watch_sinks WHERE pull_claimed_by = ${token}`
    );
    return rows.map(toSink);
  }

  /**
   * Takes one addon for an on-demand read, or reports that someone else has it.
   *
   * The staleness check and the claim must be one statement: `last_pull_at` is
   * written only when a read finishes, so concurrent shelves all read it stale.
   */
  static async claimPullSink(
    id: string,
    token: string,
    now: number,
    leaseMs: number,
    staleBefore: number
  ): Promise<boolean> {
    const res = await getDb().exec(
      sql`UPDATE watch_sinks
             SET pull_claimed_by = ${token},
                 pull_claim_expires_at = ${now + leaseMs}
           WHERE id = ${id}
             AND (pull_claim_expires_at IS NULL
                  OR pull_claim_expires_at <= ${now})
             AND (last_pull_at IS NULL OR last_pull_at < ${staleBefore})`
    );
    return res.rowCount > 0;
  }

  /**
   * Releases an addon after a read and says when it is next due.
   *
   * The version is only stored on a success, so a failure leaves the previous
   * one in place and the next run asks for the same window again.
   */
  static async finishPull(
    id: string,
    token: string | null,
    opts: {
      at: number;
      nextPullAt: number | null;
      version?: string | null;
      error?: string;
      status?: SinkStatus;
      failures?: number;
    }
  ): Promise<void> {
    const { at } = opts;
    const error = opts.error ?? null;
    const version = opts.version ?? null;
    const setVersion = opts.error ? 0 : 1;
    const status = opts.status ?? null;
    await getDb().exec(
      sql`UPDATE watch_sinks SET
            pull_claimed_by = NULL,
            pull_claim_expires_at = NULL,
            last_pull_at = ${at},
            next_pull_at = ${opts.nextPullAt},
            last_pull_error = ${error},
            pull_failures = COALESCE(${opts.failures ?? null}, pull_failures),
            status = COALESCE(${status}, status),
            status_at = CASE WHEN CAST(${status} AS TEXT) IS NOT NULL AND ${status} <> status
                             THEN ${at} ELSE status_at END,
            pull_version = CASE WHEN ${setVersion} = 1 THEN ${version} ELSE pull_version END,
            updated_at = ${at}
          WHERE id = ${id}
            ${token ? sql`AND pull_claimed_by = ${token}` : sql``}`
    );
  }

  static async getSink(id: string): Promise<SinkRow | null> {
    const row = await getDb().maybeOne<DbSink>(
      sql`SELECT * FROM watch_sinks WHERE id = ${id}`
    );
    return row ? toSink(row) : null;
  }

  static async pruneFinished(olderThan: number): Promise<PruneResult> {
    const batch = appConfig.watchState.pruneBatchSize;
    return deleteInBatches(async () => {
      // Enumerated, not `<> 'pending'`, so the index is usable.
      const res = await getDb().exec(
        sql`DELETE FROM watch_deliveries
             WHERE id IN (
               SELECT id FROM watch_deliveries
                WHERE status IN ('delivered', 'failed')
                  AND updated_at < ${olderThan}
                ORDER BY updated_at ASC
                LIMIT ${batch}
             )`
      );
      return res.rowCount;
    });
  }
}
