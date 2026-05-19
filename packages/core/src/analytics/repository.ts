/**
 * Read side of analytics for the dashboard. Recent ranges (≤ event retention)
 * read raw `analytics_events`; longer ranges read the `analytics_daily`
 * rollup.
 */
import { getDb } from '../db/db.js';
import { sql, raw as sqlRaw } from '../db/sql.js';
import { config } from '../config/index.js';
import { createLogger } from '../logging/logger.js';
import type { AnalyticsServiceBreakdown } from './index.js';

export type AnalyticsRange = '24h' | '7d' | '30d' | 'all';

/** Per-user ranges are clamped to whatever raw window is currently retained. */
export type UserAnalyticsRange = '24h' | '7d';

const userRepoLogger = createLogger('analytics-user');

const DAY = 86_400_000;

function rangeStartMs(range: AnalyticsRange): number {
  const now = Date.now();
  switch (range) {
    case '24h':
      return now - DAY;
    case '7d':
      return now - 7 * DAY;
    case '30d':
      return now - 30 * DAY;
    case 'all':
      return 0;
  }
}

function n(v: unknown): number {
  return Number(v ?? 0);
}

function dayExpr(col: string) {
  return getDb().dialect === 'postgres'
    ? `to_char(${col}, 'YYYY-MM-DD')`
    : `strftime('%Y-%m-%d', ${col})`;
}

export const AnalyticsRepository = {
  async overview() {
    const db = getDb();
    const totalUsers = await db.count(sql`SELECT COUNT(*) AS count FROM users`);
    const count = async (frag: ReturnType<typeof sql>) => db.count(frag);

    const [new24, new7, new30, act24, act7] = await Promise.all([
      count(
        sql`SELECT COUNT(*) AS count FROM users WHERE created_at >= ${db.intervalAgo(1, 'days')}`
      ),
      count(
        sql`SELECT COUNT(*) AS count FROM users WHERE created_at >= ${db.intervalAgo(7, 'days')}`
      ),
      count(
        sql`SELECT COUNT(*) AS count FROM users WHERE created_at >= ${db.intervalAgo(30, 'days')}`
      ),
      count(
        sql`SELECT COUNT(*) AS count FROM users WHERE accessed_at >= ${db.intervalAgo(1, 'days')}`
      ),
      count(
        sql`SELECT COUNT(*) AS count FROM users WHERE accessed_at >= ${db.intervalAgo(7, 'days')}`
      ),
    ]);

    const reqs24 = await db.query<{ c: number | string }>(
      sql`SELECT COUNT(*) AS c FROM analytics_events WHERE ts >= ${Date.now() - DAY}`
    );

    return {
      totalUsers,
      newUsers: { d1: new24, d7: new7, d30: new30 },
      activeUsers: { d1: act24, d7: act7 },
      requests24h: n(reqs24[0]?.c),
    };
  },

  /** User growth from users.created_at - independent of event retention. */
  async userGrowth(range: AnalyticsRange) {
    const db = getDb();
    const since = rangeStartMs(range);
    const expr = dayExpr('created_at');
    const where =
      range === 'all'
        ? sql``
        : sql`WHERE created_at >= ${db.intervalAgo(
            range === '24h' ? 1 : range === '7d' ? 7 : 30,
            'days'
          )}`;
    const rows = await db.query<{ day: string; c: number | string }>(
      sql`SELECT ${sqlRaw(expr)} AS day, COUNT(*) AS c
          FROM users ${where}
          GROUP BY ${sqlRaw(expr)} ORDER BY day ASC`
    );
    // cumulative
    let total = await db.count(
      sql`SELECT COUNT(*) AS count FROM users WHERE created_at < ${new Date(
        since
      ).toISOString()}`
    );
    return rows.map((r) => {
      total += n(r.c);
      return { day: r.day, new: n(r.c), total };
    });
  },

  async requests(range: AnalyticsRange) {
    const db = getDb();
    if (range === '24h' || range === '7d') {
      const since = rangeStartMs(range);
      const expr = dayExpr(
        db.dialect === 'postgres'
          ? 'to_timestamp(ts/1000.0)'
          : "datetime(ts/1000,'unixepoch')"
      );
      const rows = await db.query<{
        day: string;
        resource: string;
        c: number | string;
      }>(
        sql`SELECT ${sqlRaw(expr)} AS day, resource, COUNT(*) AS c
            FROM analytics_events
            WHERE ts >= ${since} AND resource IS NOT NULL
            GROUP BY day, resource ORDER BY day ASC`
      );
      return pivotResource(rows);
    }
    const rows = await db.query<{
      day: string;
      key: string;
      count: number | string;
    }>(
      sql`SELECT day, key, count FROM analytics_daily
          WHERE dimension = 'resource' ORDER BY day ASC`
    );
    return pivotResource(
      rows.map((r) => ({ day: r.day, resource: r.key, c: r.count }))
    );
  },

  /** Addon usage/errors - non-overridden only + a custom bucket. */
  async addons(range: AnalyticsRange) {
    const db = getDb();
    const useEvents = range === '24h' || range === '7d';
    if (useEvents) {
      const since = rangeStartMs(range);
      const usage = await db.query<{
        preset_id: string;
        c: number | string;
        ls: number | string;
        lc: number | string;
      }>(
        sql`SELECT preset_id, COUNT(*) AS c,
                   COALESCE(SUM(latency_ms),0) AS ls, COUNT(latency_ms) AS lc
            FROM analytics_events
            WHERE ts >= ${since} AND preset_id IS NOT NULL AND url_overridden = false
            GROUP BY preset_id ORDER BY c DESC`
      );
      const errors = await db.query<{
        preset_id: string;
        error_kind: string;
        c: number | string;
      }>(
        sql`SELECT preset_id, error_kind, COUNT(*) AS c
            FROM analytics_events
            WHERE ts >= ${since} AND preset_id IS NOT NULL AND url_overridden = false
              AND status = 'error' AND error_kind IS NOT NULL
            GROUP BY preset_id, error_kind`
      );
      const custom = await db.query<{ c: number | string }>(
        sql`SELECT COUNT(*) AS c FROM analytics_events
            WHERE ts >= ${since} AND url_overridden = true`
      );
      return shapeAddons(usage, errors, n(custom[0]?.c));
    }
    const usage = await db.query<{
      key: string;
      count: number | string;
      latency_sum: number | string;
      latency_count: number | string;
    }>(
      sql`SELECT key, SUM(count) AS count, SUM(latency_sum) AS latency_sum,
                 SUM(latency_count) AS latency_count
          FROM analytics_daily WHERE dimension = 'preset'
          GROUP BY key ORDER BY count DESC`
    );
    const errors = await db.query<{ key: string; count: number | string }>(
      sql`SELECT key, SUM(count) AS count FROM analytics_daily
          WHERE dimension = 'preset_error' GROUP BY key`
    );
    const custom = await db.query<{ c: number | string }>(
      sql`SELECT COALESCE(SUM(count),0) AS c FROM analytics_daily WHERE dimension='custom'`
    );
    return shapeAddons(
      usage.map((u) => ({
        preset_id: u.key,
        c: u.count,
        ls: u.latency_sum,
        lc: u.latency_count,
      })),
      errors.map((e) => {
        const [preset_id, error_kind] = e.key.split('|');
        return { preset_id, error_kind, c: e.count };
      }),
      n(custom[0]?.c)
    );
  },

  /** Top active uuid_hash by request count (recent window). */
  async topUsers(range: AnalyticsRange) {
    const db = getDb();
    const since = rangeStartMs(range);
    const rows = await db.query<{ uuid_hash: string; c: number | string }>(
      sql`SELECT uuid_hash, COUNT(*) AS c FROM analytics_events
          WHERE ts >= ${since} AND uuid_hash IS NOT NULL
          GROUP BY uuid_hash ORDER BY c DESC LIMIT 20`
    );
    return rows.map((r) => ({ uuidHash: r.uuid_hash, requests: n(r.c) }));
  },

  /**
   * Per-user contribution breakdown for the configure-page "Stats" tab.
   *
   */
  async userBreakdown(uuidHash: string, range: UserAnalyticsRange) {
    const db = getDb();
    const retentionDays = Math.max(
      1,
      Number(config.analytics.eventRetentionDays) || 7
    );
    const requestedDays = range === '24h' ? 1 : 7;
    const effectiveDays = Math.min(requestedDays, retentionDays);
    const windowMs = effectiveDays * DAY;
    const since = Date.now() - windowMs;

    const rows = await db.query<{
      preset_id: string | null;
      addon_instance_hash: string | null;
      addon_name: string | null;
      disposition: string | null;
      status: string | null;
      error_kind: string | null;
      latency_ms: number | string | null;
      result_count: number | string | null;
      final_count: number | string | null;
      service_breakdown: string | null;
    }>(
      sql`SELECT preset_id, addon_instance_hash, addon_name, disposition,
                 status, error_kind, latency_ms, result_count, final_count,
                 service_breakdown
          FROM analytics_events
          WHERE uuid_hash = ${uuidHash}
            AND event_type = 'addon_contribution'
            AND ts >= ${since}
          ORDER BY ts DESC
          LIMIT 200000`
    );

    type AddonAgg = {
      presetType: string;
      instanceHash: string;
      /** Latest non-null `addon_name` seen for this (preset, instance). */
      addonName: string | null;
      requests: number;
      merged: number;
      cutOff: number;
      notStarted: number;
      errors: number;
      empty: number;
      latencySum: number;
      latencyCount: number;
      rawSum: number;
      rawCount: number;
      finalSum: number;
      mergedFinalSum: number;
    };
    const perAddon = new Map<string, AddonAgg>();

    type ServiceAgg = {
      serviceId: string;
      finalCount: number;
      cachedCount: number;
      uncachedCount: number;
      contributingAddons: Set<string>;
    };
    const perService = new Map<string, ServiceAgg>();

    let totalRequests = 0;
    let totalFinal = 0;
    let totalCutOff = 0;
    let totalErrors = 0;
    let totalMerged = 0;

    for (const r of rows) {
      const presetType = r.preset_id ?? 'unknown';
      const instanceHash = r.addon_instance_hash ?? presetType;
      const key = `${presetType}|${instanceHash}`;
      const a =
        perAddon.get(key) ??
        ({
          presetType,
          instanceHash,
          addonName: null,
          requests: 0,
          merged: 0,
          cutOff: 0,
          notStarted: 0,
          errors: 0,
          empty: 0,
          latencySum: 0,
          latencyCount: 0,
          rawSum: 0,
          rawCount: 0,
          finalSum: 0,
          mergedFinalSum: 0,
        } satisfies AddonAgg);

      // Rows are ordered DESC by ts, so the first non-null value we see is
      // also the freshest — capture once and skip on every subsequent row.
      if (a.addonName === null && r.addon_name) {
        a.addonName = r.addon_name;
      }
      a.requests += 1;
      totalRequests += 1;
      const latency = r.latency_ms != null ? Number(r.latency_ms) : null;
      if (latency != null) {
        a.latencySum += latency;
        a.latencyCount += 1;
      }
      const raw = r.result_count != null ? Number(r.result_count) : null;
      if (raw != null) {
        a.rawSum += raw;
        a.rawCount += 1;
      }
      const fc = r.final_count != null ? Number(r.final_count) : 0;
      a.finalSum += fc;
      totalFinal += fc;

      switch (r.disposition) {
        case 'merged':
          a.merged += 1;
          a.mergedFinalSum += fc;
          totalMerged += 1;
          break;
        case 'cut_off':
          a.cutOff += 1;
          totalCutOff += 1;
          break;
        case 'not_started':
          a.notStarted += 1;
          break;
        case 'error':
          a.errors += 1;
          totalErrors += 1;
          break;
      }
      if (r.status === 'error') {
        if (r.disposition !== 'error') totalErrors += 1;
      } else if (r.status === 'empty') {
        a.empty += 1;
      }

      if (r.disposition === 'merged' && r.service_breakdown) {
        let parsed: AnalyticsServiceBreakdown | null = null;
        try {
          parsed = JSON.parse(r.service_breakdown) as AnalyticsServiceBreakdown;
        } catch (err) {
          userRepoLogger.debug({ err }, 'invalid service_breakdown json');
        }
        if (parsed) {
          for (const [sid, counts] of Object.entries(parsed)) {
            const s =
              perService.get(sid) ??
              ({
                serviceId: sid,
                finalCount: 0,
                cachedCount: 0,
                uncachedCount: 0,
                contributingAddons: new Set<string>(),
              } satisfies ServiceAgg);
            s.finalCount += counts.ok ?? 0;
            s.cachedCount += counts.cached ?? 0;
            s.uncachedCount += counts.uncached ?? 0;
            s.contributingAddons.add(presetType);
            perService.set(sid, s);
          }
        }
      }

      perAddon.set(key, a);
    }

    const totalMergedFinal = [...perAddon.values()].reduce(
      (s, a) => s + a.mergedFinalSum,
      0
    );

    const perAddonOut = [...perAddon.values()]
      .map((a) => {
        const avgLatencyMs = a.latencyCount
          ? Math.round(a.latencySum / a.latencyCount)
          : null;
        const avgRawCount = a.rawCount
          ? +(a.rawSum / a.rawCount).toFixed(1)
          : 0;
        const avgFinalContribution = a.merged
          ? +(a.mergedFinalSum / a.merged).toFixed(2)
          : 0;
        const finalShare = totalMergedFinal
          ? +((a.mergedFinalSum / totalMergedFinal) * 100).toFixed(1)
          : 0;
        const cutOffRate = a.requests
          ? +((a.cutOff / a.requests) * 100).toFixed(1)
          : 0;
        const errorRate = a.requests
          ? +((a.errors / a.requests) * 100).toFixed(1)
          : 0;
        const emptyRate = a.requests
          ? +((a.empty / a.requests) * 100).toFixed(1)
          : 0;
        return {
          presetType: a.presetType,
          instanceHash: a.instanceHash,
          addonName: a.addonName,
          requests: a.requests,
          status: { ok: a.merged - a.errors, error: a.errors, empty: a.empty },
          avgLatencyMs,
          avgRawCount,
          avgFinalContribution,
          finalShare,
          cutOffRate,
          errorRate,
          emptyRate,
          redundant: a.merged >= 5 && finalShare < 1,
          slow: a.requests >= 5 && cutOffRate > 30,
        };
      })
      .sort((a, b) => b.requests - a.requests);

    const perServiceOut = [...perService.values()]
      .map((s) => {
        const total = s.finalCount || 1;
        return {
          serviceId: s.serviceId,
          finalCount: s.finalCount,
          cachedCount: s.cachedCount,
          uncachedCount: s.uncachedCount,
          cachedShare: +((s.cachedCount / total) * 100).toFixed(1),
          contributingAddons: [...s.contributingAddons],
        };
      })
      .sort((a, b) => b.finalCount - a.finalCount);

    const latencyLeaderboard = [...perAddon.values()]
      .filter((a) => a.latencyCount >= 3)
      .map((a) => ({
        presetType: a.presetType,
        instanceHash: a.instanceHash,
        addonName: a.addonName,
        avgLatencyMs: Math.round(a.latencySum / a.latencyCount),
      }))
      .sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)
      .slice(0, 5);

    return {
      range,
      windowMs,
      generatedAt: Date.now(),
      totals: {
        requests: totalRequests,
        finalCountAvg: totalRequests
          ? +(totalFinal / totalRequests).toFixed(2)
          : 0,
        cutOffRate: totalRequests
          ? +((totalCutOff / totalRequests) * 100).toFixed(1)
          : 0,
        errorRate: totalRequests
          ? +((totalErrors / totalRequests) * 100).toFixed(1)
          : 0,
        mergedRequests: totalMerged,
      },
      perAddon: perAddonOut,
      perService: perServiceOut,
      latencyLeaderboard,
    };
  },

  /**
   * Global feature usage rollups for the admin dashboard. Reads
   * `analytics_daily` rows where dimension is `feature:service` /
   * `feature:formatter` / `feature:preset` — counts are `COUNT(DISTINCT
   * uuid_hash)` per day per key.
   */
  async features(range: AnalyticsRange) {
    const db = getDb();
    const now = Date.now();
    const days =
      range === '24h' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : null;
    const since = days != null ? now - days * DAY : 0;
    const sinceDay = new Date(since).toISOString().slice(0, 10);
    const where = days != null ? sql`AND day >= ${sinceDay}` : sql``;

    const rows = await db.query<{
      dimension: string;
      day: string;
      key: string;
      count: number | string;
    }>(
      sql`SELECT dimension, day, key, count FROM analytics_daily
          WHERE dimension IN ('feature:service','feature:formatter','feature:preset')
            ${where}
          ORDER BY day ASC`
    );

    const grouped = {
      service: new Map<string, number>(),
      formatter: new Map<string, number>(),
      preset: new Map<string, number>(),
      serviceSeries: [] as Array<{ day: string; key: string; count: number }>,
    };
    for (const r of rows) {
      const dim = r.dimension.split(':')[1] as
        | 'service'
        | 'formatter'
        | 'preset';
      const bucket = grouped[dim];
      bucket.set(r.key, (bucket.get(r.key) ?? 0) + n(r.count));
      if (dim === 'service') {
        grouped.serviceSeries.push({
          day: r.day,
          key: r.key,
          count: n(r.count),
        });
      }
    }
    const toEntries = (m: Map<string, number>) =>
      [...m.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count);
    return {
      service: toEntries(grouped.service),
      formatter: toEntries(grouped.formatter),
      preset: toEntries(grouped.preset),
      serviceSeries: grouped.serviceSeries,
    };
  },
};

function pivotResource(
  rows: Array<{ day: string; resource: string; c: number | string }>
) {
  const days = new Map<string, Record<string, number>>();
  const resources = new Set<string>();
  for (const r of rows) {
    resources.add(r.resource);
    const d = days.get(r.day) ?? {};
    d[r.resource] = n(r.c);
    days.set(r.day, d);
  }
  return {
    resources: [...resources],
    series: [...days.entries()].map(([day, counts]) => ({ day, ...counts })),
  };
}

function shapeAddons(
  usage: Array<{
    preset_id: string;
    c: number | string;
    ls: number | string;
    lc: number | string;
  }>,
  errors: Array<{ preset_id: string; error_kind: string; c: number | string }>,
  customCount: number
) {
  const total = usage.reduce((s, u) => s + n(u.c), 0);
  const errByPreset = new Map<string, Record<string, number>>();
  for (const e of errors) {
    const m = errByPreset.get(e.preset_id) ?? {};
    m[e.error_kind] = n(e.c);
    errByPreset.set(e.preset_id, m);
  }
  return {
    total,
    customEndpoints: customCount,
    addons: usage.map((u) => {
      const errs = errByPreset.get(u.preset_id) ?? {};
      const errCount = Object.values(errs).reduce((s, v) => s + v, 0);
      const lc = n(u.lc);
      return {
        presetId: u.preset_id,
        requests: n(u.c),
        share: total ? +((n(u.c) / total) * 100).toFixed(1) : 0,
        errors: errCount,
        errorRate: n(u.c) ? +((errCount / n(u.c)) * 100).toFixed(1) : 0,
        errorKinds: errs,
        avgLatencyMs: lc ? Math.round(n(u.ls) / lc) : null,
      };
    }),
  };
}
