import { createHmac } from 'crypto';
import { getDb } from '../db/db.js';
import { sql, join } from '../db/sql.js';
import { config } from '../config/index.js';
import { createLogger } from '../logging/logger.js';
import { TaskManager } from '../tasks/index.js';

const logger = createLogger('analytics');

export type AnalyticsResource =
  | 'stream'
  | 'catalog'
  | 'addon_catalog'
  | 'meta'
  | 'subtitle'
  | 'manifest';

export type AnalyticsStatus = 'ok' | 'error' | 'empty';

export type AnalyticsErrorStage =
  | 'manifest'
  | 'catalog'
  | 'meta'
  | 'stream'
  | 'subtitle'
  | 'addon_catalog';

export type AnalyticsErrorKind =
  | 'timeout'
  | 'http_4xx'
  | 'http_5xx'
  | 'network'
  | 'parse'
  | 'empty';

export type AnalyticsDisposition =
  | 'merged'
  | 'cut_off'
  | 'not_started'
  | 'error';

export type AnalyticsServiceBreakdown = Record<
  string,
  { ok: number; cached: number; uncached: number }
>;

/** Privacy-safe stream-kind counters used only by aggregate addon metrics. */
export interface AnalyticsStreamBreakdown {
  cached: number;
  uncached: number;
  p2p: number;
  usenet: number;
}

export interface AnalyticsEvent {
  ts: number;
  event_type: string;
  resource?: AnalyticsResource | null;
  /** HMAC(SECRET_KEY, configUuid) — never the raw UUID. */
  uuid_hash?: string | null;
  addon_id?: string | null;
  addon_instance_hash?: string | null;
  preset_id?: string | null;
  url_overridden?: boolean;
  status?: AnalyticsStatus | null;
  error_stage?: AnalyticsErrorStage | null;
  error_kind?: AnalyticsErrorKind | null;
  latency_ms?: number | null;
  result_count?: number | null;
  final_count?: number | null;
  /** Per-user `addon_contribution`: how this addon's request ended (see {@link AnalyticsDisposition}). */
  disposition?: AnalyticsDisposition | null;
  /** Per-user `addon_contribution`: services attributed to this addon's surviving streams. */
  service_breakdown?: AnalyticsServiceBreakdown | null;
  /** Per-user `addon_contribution`: the addon's user-set display name at request time. */
  addon_name?: string | null;
  /** Aggregate-only numeric size evidence; never written to raw event rows. */
  size_sum_bytes?: number | null;
  size_count?: number | null;
  max_size_bytes?: number | null;
  top_rank_win?: boolean;
  largest_source_win?: boolean;
  stream_breakdown?: AnalyticsStreamBreakdown | null;
  /** Global `config_feature` events: which dimension is being sampled. */
  feature_dim?: 'service' | 'formatter' | 'preset' | null;
  /** Global `config_feature` events: dimension key (e.g. `realdebrid`, `custom`, `torrentio`). */
  feature_key?: string | null;
  /** Anonymised client IP — IPv4 first 3 octets / IPv6 first 3 hextets only. Never a full address. */
  ip_prefix?: string | null;
}

/**
 * Reduce a client IP to a coarse, non-identifying prefix: the first 3 octets
 * for IPv4 (`a.b.c.x`) or the first 3 hextets for IPv6 (`a:b:c::/48`). The host
 * portion is dropped so a single address can never be recovered.
 */
export function anonymizeIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const trimmed = ip.replace(/^::ffff:/i, '').trim();
  if (trimmed.includes('.')) {
    const parts = trimmed.split('.');
    if (parts.length !== 4 || parts.some((p) => p === '')) return null;
    return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
  }
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').filter(Boolean);
    if (parts.length === 0) return null;
    return parts.slice(0, 3).join(':') + '::/48';
  }
  return null;
}

const MAX_BUFFER = 50_000;
let buffer: AnalyticsEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let rollupTimer: NodeJS.Timeout | null = null;

function disabled(): boolean {
  return config.analytics.enabled === false;
}

export function userAnalyticsEnabled(): boolean {
  return !disabled() && config.analytics.userAnalyticsEnabled === true;
}

const featureSampledToday = new Set<string>();
let featureSampledDayKey = '';

function dayKeyFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function sampleConfigFeatures(args: {
  uuid: string;
  serviceIds: string[];
  formatterId: string | null;
  presetTypes: string[];
}): void {
  if (!userAnalyticsEnabled()) return;
  const { uuid, serviceIds, formatterId, presetTypes } = args;
  if (!uuid) return;

  let uuidHash: string;
  try {
    uuidHash = hmac(uuid);
  } catch {
    return;
  }

  const day = dayKeyFromMs(Date.now());
  if (day !== featureSampledDayKey) {
    featureSampledToday.clear();
    featureSampledDayKey = day;
  }

  const dedupKey = `${uuidHash}:${day}`;
  if (featureSampledToday.has(dedupKey)) return;
  featureSampledToday.add(dedupKey);

  const emitOne = (
    feature_dim: 'service' | 'formatter' | 'preset',
    feature_key: string
  ) => {
    track({
      event_type: 'config_feature',
      uuid_hash: uuidHash,
      feature_dim,
      feature_key,
    });
  };

  for (const id of new Set(serviceIds)) {
    if (id) emitOne('service', id);
  }
  if (formatterId) emitOne('formatter', formatterId);
  for (const t of new Set(presetTypes)) {
    if (t) emitOne('preset', t);
  }
}

/** HMAC a value with the session secret. Used for `uuid_hash`. */
export function hmac(value: string): string {
  return createHmac('sha256', config.bootstrap.secretKey)
    .update(value)
    .digest('hex')
    .slice(0, 32);
}

/** Hot path: enqueue an event. Never throws, never awaits. */
export function track(ev: Omit<AnalyticsEvent, 'ts'>): void {
  if (disabled()) return;
  if (buffer.length >= MAX_BUFFER) return; // shed load rather than grow unbounded
  buffer.push({ ...ev, ts: Date.now() });
}

/** Map a caught error at a resource stage to a consistent classification. */
export function classifyAddonError(
  stage: AnalyticsErrorStage,
  err: unknown
): { error_stage: AnalyticsErrorStage; error_kind: AnalyticsErrorKind } {
  let kind: AnalyticsErrorKind = 'network';
  const msg = (
    err instanceof Error ? err.message : String(err ?? '')
  ).toLowerCase();
  const status =
    (err as { status?: number; statusCode?: number })?.status ??
    (err as { statusCode?: number })?.statusCode;
  if (typeof status === 'number') {
    if (status >= 500) kind = 'http_5xx';
    else if (status >= 400) kind = 'http_4xx';
  } else if (msg.includes('timeout') || msg.includes('etimedout')) {
    kind = 'timeout';
  } else if (
    msg.includes('json') ||
    msg.includes('parse') ||
    msg.includes('unexpected token')
  ) {
    kind = 'parse';
  }
  return { error_stage: stage, error_kind: kind };
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  try {
    const db = getDb();
    const rows = batch.map((e) => {
      const serviceBreakdown =
        e.service_breakdown && Object.keys(e.service_breakdown).length > 0
          ? JSON.stringify(e.service_breakdown)
          : null;
      return sql`(${e.ts}, ${e.event_type}, ${e.resource ?? null}, ${e.uuid_hash ?? null}, ${e.addon_id ?? null}, ${e.addon_instance_hash ?? null}, ${e.preset_id ?? null}, ${e.url_overridden ?? false}, ${e.status ?? null}, ${e.error_stage ?? null}, ${e.error_kind ?? null}, ${e.latency_ms ?? null}, ${e.result_count ?? null}, ${e.final_count ?? null}, ${e.disposition ?? null}, ${serviceBreakdown}, ${e.addon_name ?? null}, ${e.feature_dim ?? null}, ${e.feature_key ?? null}, ${e.ip_prefix ?? null})`;
    });
    const performance = aggregateAddonPerformance(batch);
    // Keep raw event insertion and durable daily counters atomic. If either
    // side fails, neither is committed and the warning below is honest.
    await db.tx(async (tx) => {
      // Chunk to keep parameter counts sane.
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        await tx.exec(
          sql`INSERT INTO analytics_events
            (ts, event_type, resource, uuid_hash, addon_id, addon_instance_hash, preset_id, url_overridden, status, error_stage, error_kind, latency_ms, result_count, final_count, disposition, service_breakdown, addon_name, feature_dim, feature_key, ip_prefix)
            VALUES ${join(slice)}`
        );
      }
      for (const d of performance.values()) {
        await tx.exec(
          sql`INSERT INTO addon_performance_entities
            (preset_id, instance_hash, addon_name)
            VALUES (${d.presetId}, ${d.instanceHash}, ${d.addonName})
            ON CONFLICT (preset_id, instance_hash) DO UPDATE SET
              addon_name = excluded.addon_name`
        );
        const entity = await tx.query<{ id: number | string }>(
          sql`SELECT id FROM addon_performance_entities
              WHERE preset_id = ${d.presetId}
                AND instance_hash = ${d.instanceHash}`
        );
        const addonId = Number(entity[0]?.id);
        if (!Number.isFinite(addonId)) {
          throw new Error('failed to resolve addon performance entity');
        }
        await tx.exec(
          sql`INSERT INTO addon_performance_daily
            (day, addon_id, requests, with_results,
             merged, cut_off, not_started, errors, empty, raw_sum, final_sum,
             latency_sum, latency_count, sized_streams, size_sum_bytes,
             max_size_bytes, top_rank_wins, largest_source_wins,
             cached_streams, uncached_streams, p2p_streams, usenet_streams)
            VALUES
            (${d.day}, ${addonId}, ${d.requests}, ${d.withResults}, ${d.merged}, ${d.cutOff},
             ${d.notStarted}, ${d.errors}, ${d.empty}, ${d.rawSum},
             ${d.finalSum}, ${d.latencySum}, ${d.latencyCount},
             ${d.sizedStreams}, ${d.sizeSumBytes}, ${d.maxSizeBytes},
             ${d.topRankWins}, ${d.largestSourceWins}, ${d.cachedStreams},
             ${d.uncachedStreams}, ${d.p2pStreams}, ${d.usenetStreams})
            ON CONFLICT (day, addon_id) DO UPDATE SET
              requests = addon_performance_daily.requests + excluded.requests,
              with_results = addon_performance_daily.with_results + excluded.with_results,
              merged = addon_performance_daily.merged + excluded.merged,
              cut_off = addon_performance_daily.cut_off + excluded.cut_off,
              not_started = addon_performance_daily.not_started + excluded.not_started,
              errors = addon_performance_daily.errors + excluded.errors,
              empty = addon_performance_daily.empty + excluded.empty,
              raw_sum = addon_performance_daily.raw_sum + excluded.raw_sum,
              final_sum = addon_performance_daily.final_sum + excluded.final_sum,
              latency_sum = addon_performance_daily.latency_sum + excluded.latency_sum,
              latency_count = addon_performance_daily.latency_count + excluded.latency_count,
              sized_streams = addon_performance_daily.sized_streams + excluded.sized_streams,
              size_sum_bytes = addon_performance_daily.size_sum_bytes + excluded.size_sum_bytes,
              max_size_bytes = CASE
                WHEN addon_performance_daily.max_size_bytes > excluded.max_size_bytes
                THEN addon_performance_daily.max_size_bytes
                ELSE excluded.max_size_bytes
              END,
              top_rank_wins = addon_performance_daily.top_rank_wins + excluded.top_rank_wins,
              largest_source_wins = addon_performance_daily.largest_source_wins + excluded.largest_source_wins,
              cached_streams = addon_performance_daily.cached_streams + excluded.cached_streams,
              uncached_streams = addon_performance_daily.uncached_streams + excluded.uncached_streams,
              p2p_streams = addon_performance_daily.p2p_streams + excluded.p2p_streams,
              usenet_streams = addon_performance_daily.usenet_streams + excluded.usenet_streams`
        );
      }
    });
  } catch (err) {
    logger.warn({ err, dropped: batch.length }, 'analytics flush failed');
  }
}

interface AddonPerformanceDelta {
  day: string;
  presetId: string;
  instanceHash: string;
  addonName: string;
  requests: number;
  withResults: number;
  merged: number;
  cutOff: number;
  notStarted: number;
  errors: number;
  empty: number;
  rawSum: number;
  finalSum: number;
  latencySum: number;
  latencyCount: number;
  sizedStreams: number;
  sizeSumBytes: number;
  maxSizeBytes: number;
  topRankWins: number;
  largestSourceWins: number;
  cachedStreams: number;
  uncachedStreams: number;
  p2pStreams: number;
  usenetStreams: number;
}

function finiteNonNegative(value: number | null | undefined): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : 0;
}

/** Collapse hot-path contribution events into small, identity-free daily rows. */
function aggregateAddonPerformance(
  events: readonly AnalyticsEvent[]
): Map<string, AddonPerformanceDelta> {
  const out = new Map<string, AddonPerformanceDelta>();
  for (const e of events) {
    if (
      e.event_type !== 'addon_contribution' ||
      !e.preset_id ||
      !e.addon_instance_hash
    ) {
      continue;
    }
    const day = dayKey(e.ts);
    const key = `${day}|${e.preset_id}|${e.addon_instance_hash}`;
    const d =
      out.get(key) ??
      ({
        day,
        presetId: e.preset_id,
        instanceHash: e.addon_instance_hash,
        addonName: e.addon_name ?? e.preset_id,
        requests: 0,
        withResults: 0,
        merged: 0,
        cutOff: 0,
        notStarted: 0,
        errors: 0,
        empty: 0,
        rawSum: 0,
        finalSum: 0,
        latencySum: 0,
        latencyCount: 0,
        sizedStreams: 0,
        sizeSumBytes: 0,
        maxSizeBytes: 0,
        topRankWins: 0,
        largestSourceWins: 0,
        cachedStreams: 0,
        uncachedStreams: 0,
        p2pStreams: 0,
        usenetStreams: 0,
      } satisfies AddonPerformanceDelta);

    d.addonName = e.addon_name ?? d.addonName;
    d.requests += 1;
    const raw = finiteNonNegative(e.result_count);
    const final = finiteNonNegative(e.final_count);
    d.rawSum += raw;
    d.finalSum += final;
    if (raw > 0) d.withResults += 1;
    if (e.status === 'error' || e.disposition === 'error') d.errors += 1;
    if (e.status === 'empty') d.empty += 1;
    if (e.disposition === 'merged') d.merged += 1;
    if (e.disposition === 'cut_off') d.cutOff += 1;
    if (e.disposition === 'not_started') d.notStarted += 1;
    if (e.latency_ms != null && Number.isFinite(e.latency_ms)) {
      d.latencySum += Math.max(0, e.latency_ms);
      d.latencyCount += 1;
    }
    const sizeCount = finiteNonNegative(e.size_count);
    const sizeSum = finiteNonNegative(e.size_sum_bytes);
    const maxSize = finiteNonNegative(e.max_size_bytes);
    d.sizedStreams += sizeCount;
    d.sizeSumBytes += sizeSum;
    d.maxSizeBytes = Math.max(d.maxSizeBytes, maxSize);
    if (e.top_rank_win) d.topRankWins += 1;
    if (e.largest_source_win) d.largestSourceWins += 1;
    d.cachedStreams += finiteNonNegative(e.stream_breakdown?.cached);
    d.uncachedStreams += finiteNonNegative(e.stream_breakdown?.uncached);
    d.p2pStreams += finiteNonNegative(e.stream_breakdown?.p2p);
    d.usenetStreams += finiteNonNegative(e.stream_breakdown?.usenet);
    out.set(key, d);
  }
  return out;
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Nightly rollup: (re)compute daily aggregates for the last 2 days, then prune
 * raw events / daily rows past their retention settings.
 */
export async function runRollup(): Promise<void> {
  if (disabled()) return;
  const db = getDb();
  const now = Date.now();
  const dayMs = 86_400_000;
  const days = [dayKey(now), dayKey(now - dayMs)];

  for (const day of days) {
    const start = new Date(day + 'T00:00:00.000Z').getTime();
    const end = start + dayMs;

    // dimension=resource
    const byRes = await db.query<{
      key: string;
      c: number | string;
      ls: number | string;
      lc: number | string;
    }>(
      sql`SELECT resource AS key, COUNT(*) AS c,
                 COALESCE(SUM(latency_ms),0) AS ls,
                 COUNT(latency_ms) AS lc
          FROM analytics_events
          WHERE ts >= ${start} AND ts < ${end} AND resource IS NOT NULL
          GROUP BY resource`
    );
    // dimension=preset (marketplace defaults only)
    const byPreset = await db.query<{
      key: string;
      c: number | string;
      ls: number | string;
      lc: number | string;
    }>(
      sql`SELECT preset_id AS key, COUNT(*) AS c,
                 COALESCE(SUM(latency_ms),0) AS ls,
                 COUNT(latency_ms) AS lc
          FROM analytics_events
          WHERE ts >= ${start} AND ts < ${end}
            AND preset_id IS NOT NULL AND url_overridden = false
          GROUP BY preset_id`
    );
    // dimension=preset_error (kind)
    const byErr = await db.query<{ key: string; c: number | string }>(
      sql`SELECT (preset_id || '|' || error_kind) AS key, COUNT(*) AS c
          FROM analytics_events
          WHERE ts >= ${start} AND ts < ${end}
            AND preset_id IS NOT NULL AND url_overridden = false
            AND status = 'error' AND error_kind IS NOT NULL
          GROUP BY preset_id, error_kind`
    );
    // dimension=custom (overridden bucket)
    const custom = await db.query<{ c: number | string }>(
      sql`SELECT COUNT(*) AS c FROM analytics_events
          WHERE ts >= ${start} AND ts < ${end} AND url_overridden = true`
    );
    // dimension=feature:{service|formatter|preset} - counts unique users per
    // (day, feature_key).
    const byFeature = await db.query<{
      dim: string;
      key: string;
      c: number | string;
    }>(
      sql`SELECT ('feature:' || feature_dim) AS dim, feature_key AS key,
                 COUNT(DISTINCT uuid_hash) AS c
          FROM analytics_events
          WHERE ts >= ${start} AND ts < ${end}
            AND event_type = 'config_feature'
            AND feature_dim IS NOT NULL AND feature_key IS NOT NULL
          GROUP BY feature_dim, feature_key`
    );

    const upserts: Array<{
      dim: string;
      key: string;
      c: number;
      ls: number;
      lc: number;
    }> = [];
    for (const r of byRes)
      upserts.push({
        dim: 'resource',
        key: r.key,
        c: Number(r.c),
        ls: Number(r.ls),
        lc: Number(r.lc),
      });
    for (const r of byPreset)
      upserts.push({
        dim: 'preset',
        key: r.key,
        c: Number(r.c),
        ls: Number(r.ls),
        lc: Number(r.lc),
      });
    for (const r of byErr)
      upserts.push({
        dim: 'preset_error',
        key: r.key,
        c: Number(r.c),
        ls: 0,
        lc: 0,
      });
    if (Number(custom[0]?.c ?? 0) > 0)
      upserts.push({
        dim: 'custom',
        key: 'custom',
        c: Number(custom[0].c),
        ls: 0,
        lc: 0,
      });
    for (const r of byFeature)
      upserts.push({
        dim: r.dim,
        key: r.key,
        c: Number(r.c),
        ls: 0,
        lc: 0,
      });

    await db.tx(async (tx) => {
      await tx.exec(sql`DELETE FROM analytics_daily WHERE day = ${day}`);
      for (const u of upserts) {
        await tx.exec(
          sql`INSERT INTO analytics_daily (day, dimension, key, count, latency_sum, latency_count)
              VALUES (${day}, ${u.dim}, ${u.key}, ${u.c}, ${u.ls}, ${u.lc})
              ON CONFLICT (day, dimension, key) DO UPDATE SET
                count = excluded.count,
                latency_sum = excluded.latency_sum,
                latency_count = excluded.latency_count`
        );
      }
    });
  }

  // Prune by retention.
  const eventDays = Number(config.analytics.eventRetentionDays) || 7;
  const dailyDays = Number(config.analytics.dailyRetentionDays) || 90;
  const eventCutoff = now - eventDays * dayMs;
  const dailyCutoff = dayKey(now - dailyDays * dayMs);
  await db.exec(sql`DELETE FROM analytics_events WHERE ts < ${eventCutoff}`);
  await db.exec(sql`DELETE FROM analytics_daily WHERE day < ${dailyCutoff}`);
  logger.debug('analytics rollup complete');
}

/**
 * Register the flusher + nightly rollup with the central TaskManager. No
 * standalone setInterval is kept — the registry owns the schedule.
 */
export function startAnalytics(): void {
  TaskManager.register({
    id: 'analytics-flush',
    label: 'Analytics flush',
    description: 'Batch-insert buffered request analytics into the database.',
    category: 'analytics',
    kind: 'scheduled',
    intervalMs: 5000,
    enabled: true,
    destructive: false,
    multiReplica: 'all',
    run: async () => {
      await flush();
    },
  });
  TaskManager.register({
    id: 'analytics-rollup',
    label: 'Analytics rollup',
    description:
      'Aggregate raw events into daily rollups and prune by retention.',
    category: 'analytics',
    kind: 'scheduled',
    intervalMs: 6 * 60 * 60 * 1000,
    enabled: true,
    destructive: false,
    multiReplica: 'single',
    run: async () => {
      await runRollup();
    },
  });
  setTimeout(() => {
    void rollupIfDashboardEmpty().catch(() => undefined);
  }, 30_000).unref?.();
}

/**
 * Seed today's rollup at boot so a fresh instance's dashboard isn't empty.
 * Conditional because the rollup aggregates every event of the day: run
 * unconditionally, a restart loop starts one per boot until the pool is dry.
 */
async function rollupIfDashboardEmpty(): Promise<void> {
  if (disabled()) return;
  const today = dayKey(Date.now());
  const existing = await getDb().maybeOne(
    sql`SELECT 1 AS present FROM analytics_daily WHERE day = ${today} LIMIT 1`
  );
  if (existing) return;
  await TaskManager.runNow('analytics-rollup');
}

/** Flush remaining events (called on graceful shutdown). */
export async function stopAnalytics(): Promise<void> {
  flushTimer = rollupTimer = null;
  await flush();
}

export { flush as flushAnalyticsNow };
