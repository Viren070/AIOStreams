import { Router } from 'express';
import {
  createLogger,
  logRingBuffer,
  settingsStore,
  describeSettings,
  SettingsRepository,
  AnalyticsRepository,
  AdminUsersRepository,
  TaskManager,
  Cache,
  describeDiskCaches,
  clearDiskCacheByName,
  config as appConfig,
  closeDb,
  stopAnalytics,
  formatZodError,
  type AnalyticsRange,
  type LogRecord,
  type LogQuery,
} from '@aiostreams/core';
import { ZodError } from 'zod';
import { requireAdmin } from '../../middlewares/auth.js';
import { createResponse } from '../../utils/responses.js';
import { getSystemMetrics } from '../../utils/system-metrics.js';
import usenetDashboard from './dashboard-usenet.js';

const router: Router = Router();
const logger = createLogger('dashboard');

// Every /dashboard/* route is admin-only.
router.use(requireAdmin);

// Native usenet engine: stats, providers, library.
router.use('/usenet', usenetDashboard);

function csv(v: unknown): string[] | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseQuery(q: Record<string, unknown>): LogQuery {
  const since = typeof q.since === 'string' ? Number(q.since) : undefined;
  const until = typeof q.until === 'string' ? Number(q.until) : undefined;
  const limit = typeof q.limit === 'string' ? Number(q.limit) : undefined;
  return {
    q: typeof q.q === 'string' && q.q ? q.q : undefined,
    regex: q.regex === 'true',
    levels: csv(q.level),
    modules: csv(q.module),
    since: Number.isFinite(since) ? since : undefined,
    until: Number.isFinite(until) ? until : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
    order: q.order === 'asc' ? 'asc' : 'desc',
  };
}

// GET /dashboard/logs — filtered snapshot from the in-memory ring.
router.get('/logs', (req, res) => {
  const query = parseQuery(req.query as Record<string, unknown>);
  const { records, nextSeq } = logRingBuffer.query(query);
  res.status(200).json(
    createResponse({
      success: true,
      data: {
        logs: records,
        nextSeq,
        bufferStats: logRingBuffer.stats(),
      },
    })
  );
});

// GET /dashboard/logs/stream — live tail (SSE).
router.get('/logs/stream', (req, res) => {
  const query = parseQuery(req.query as Record<string, unknown>);

  // Resume cursor: Last-Event-ID header (set by EventSource on reconnect)
  // takes precedence, then an explicit ?since=.
  const lastEventId = Number(req.headers['last-event-id']);
  if (Number.isFinite(lastEventId)) query.since = lastEventId;

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (rec: LogRecord) => {
    res.write(`id: ${rec.seq}\ndata: ${rec.line}\n\n`);
  };

  // Backfill anything the client missed (newest-capped, replayed oldest→newest).
  const backfill = logRingBuffer.query({ ...query, order: 'asc' });
  for (const rec of backfill.records) send(rec);

  let lastSeq = backfill.nextSeq;
  const onLine = (rec: LogRecord) => {
    if (rec.seq <= lastSeq) return;
    lastSeq = rec.seq;
    if (logRingBuffer.test(rec, { ...query, since: undefined })) send(rec);
  };
  logRingBuffer.bus.on('line', onLine);

  const heartbeat = setInterval(() => res.write(':hb\n\n'), 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    logRingBuffer.bus.off('line', onLine);
    res.end();
  });
});

// GET /dashboard/logs/export — download filtered logs as .log or .json (ndjson).
router.get('/logs/export', (req, res) => {
  const query = parseQuery(req.query as Record<string, unknown>);
  const format = req.query.format === 'json' ? 'json' : 'log';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = format === 'json' ? 'json' : 'log';

  res.setHeader(
    'Content-Type',
    format === 'json' ? 'application/x-ndjson' : 'text/plain; charset=utf-8'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="aiostreams-${stamp}.${ext}"`
  );

  for (const rec of logRingBuffer.iterate(query)) {
    res.write(rec.line + '\n');
  }
  res.end();
  logger.info({ format }, 'logs exported');
});

// =============================================================================
// Settings — schema-driven config editor
// =============================================================================

const SECRET_MASK = '';

// GET /dashboard/settings — every runtime config key + metadata + value.
router.get('/settings', (_req, res) => {
  const hints = describeSettings();
  const keys = settingsStore.metadata
    // Fields with a bespoke editor (e.g. usenet.providers) are hidden here and
    // managed only via their dedicated dashboard; never serve their value.
    .filter((m) => !hints[m.key]?.hidden)
    .map((m) => {
      let value: unknown;
      try {
        value = settingsStore.getEffectiveValue(m.key);
      } catch {
        value = m.default;
      }
      const secretSet =
        m.secret && m.source !== 'default' && value !== '' && value != null;
      return {
        ...m,
        ui: hints[m.key] ?? { kind: 'json' },
        // Never echo secrets back to the browser.
        value: m.secret ? SECRET_MASK : value,
        secretSet,
      };
    });
  res.status(200).json(createResponse({ success: true, data: { keys } }));
});

// PATCH /dashboard/settings — { [dottedKey]: value }. Only changed keys.
router.patch('/settings', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const username =
    (req as { user?: { username?: string } }).user?.username ?? 'admin';

  if (typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json(
      createResponse({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Expected an object body' },
      })
    );
  }

  const updated: string[] = [];
  const errors: Record<string, string> = {};
  let requiresRestart = false;
  const meta = new Map(settingsStore.metadata.map((m) => [m.key, m]));
  const hints = describeSettings();

  for (const [key, value] of Object.entries(body)) {
    const m = meta.get(key);
    if (!m) {
      errors[key] = 'Unknown setting';
      continue;
    }
    if (hints[key]?.hidden) {
      // Managed by a bespoke editor (e.g. the usenet dashboard), not here.
      errors[key] = 'Managed via its dedicated editor';
      continue;
    }
    if (m.source === 'environment') {
      errors[key] = `Overridden by ${m.env}`;
      continue;
    }
    // A masked secret coming back unchanged ⇒ user didn't edit it; skip.
    if (m.secret && (value === SECRET_MASK || value === '')) continue;
    try {
      if (m.secret && value === null) {
        await settingsStore.delete(key);
      } else {
        await settingsStore.set(key, value, username);
      }
      updated.push(key);
      if (m.requiresRestart) requiresRestart = true;
    } catch (err) {
      errors[key] =
        err instanceof ZodError
          ? formatZodError(err, { singleLine: true })
          : err instanceof Error
            ? err.message
            : 'Invalid value';
    }
  }

  if (updated.length) logger.info({ updated, username }, 'settings updated');

  const ok = Object.keys(errors).length === 0;
  res.status(ok ? 200 : 422).json(
    createResponse({
      success: ok,
      data: { updated, requiresRestart },
      ...(ok
        ? {}
        : {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Some settings could not be saved',
              issues: errors,
            },
          }),
    })
  );
});

router.post('/settings/reset', async (req, res) => {
  const body = (req.body ?? {}) as { keys?: unknown };
  const keys = Array.isArray(body.keys)
    ? body.keys.filter((k): k is string => typeof k === 'string')
    : [];
  if (keys.length === 0) {
    return res.status(400).json(
      createResponse({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'keys[] is required' },
      })
    );
  }
  const username =
    (req as { user?: { username?: string } }).user?.username ?? 'admin';
  const meta = new Map(settingsStore.metadata.map((m) => [m.key, m]));

  const reset: string[] = [];
  const skipped: { key: string; reason: string }[] = [];
  let requiresRestart = false;

  for (const key of keys) {
    const m = meta.get(key);
    if (!m) {
      skipped.push({ key, reason: 'unknown' });
      continue;
    }
    if (m.source === 'environment') {
      skipped.push({ key, reason: 'env-locked' });
      continue;
    }
    if (m.source === 'default') {
      // No DB row to delete - silently a no-op so the modal's count is honest.
      skipped.push({ key, reason: 'already-default' });
      continue;
    }
    try {
      await settingsStore.delete(key);
      reset.push(key);
      if (m.requiresRestart) requiresRestart = true;
    } catch (err) {
      skipped.push({
        key,
        reason: err instanceof Error ? err.message : 'failed',
      });
    }
  }

  if (reset.length) logger.info({ reset, username }, 'settings reset');

  res.status(200).json(
    createResponse({
      success: true,
      data: { reset, skipped, requiresRestart },
    })
  );
});

// Copy env-overridden values into the
// DB so they persist after the env vars are removed. Skips values equal to
// the schema default. Bypasses settingsStore.set
// (which throws when env is set) by writing through SettingsRepository
// directly.
router.post('/settings/import/env', async (req, res) => {
  const username =
    (req as { user?: { username?: string } }).user?.username ?? 'admin';

  const candidates = settingsStore.metadata.filter(
    (m) => m.source === 'environment'
  );

  const imported: string[] = [];
  const skippedAsDefault: string[] = [];
  const failed: { key: string; reason: string }[] = [];

  for (const m of candidates) {
    let value: unknown;
    try {
      value = settingsStore.getEffectiveValue(m.key);
    } catch (err) {
      failed.push({
        key: m.key,
        reason: err instanceof Error ? err.message : 'unreadable',
      });
      continue;
    }
    if (JSON.stringify(value) === JSON.stringify(m.default)) {
      skippedAsDefault.push(m.key);
      continue;
    }
    try {
      await SettingsRepository.set(m.key, value, username);
      imported.push(m.key);
    } catch (err) {
      failed.push({
        key: m.key,
        reason: err instanceof Error ? err.message : 'write failed',
      });
    }
  }

  // Reload once so the in-memory snapshot/version reflect all the new rows
  // (effective values won't change while env still overrides, but storedKeys does).
  if (imported.length) await settingsStore.reload();

  logger.info(
    {
      imported: imported.length,
      skippedAsDefault: skippedAsDefault.length,
      username,
    },
    'env settings imported into db'
  );

  res.status(200).json(
    createResponse({
      success: true,
      data: {
        imported,
        skippedAsDefault,
        failed,
        totalEnvKeys: candidates.length,
      },
    })
  );
});

// accept the same JSON shape produced by
// `/settings/export` and persist each entry through the regular validated
// write path. Masked secrets (value === null for keys listed in
// maskedSecretKeys) are filtered client-side; anything else that arrives
// as null but isn't a nullable schema will fail validation and be reported.
router.post('/settings/import/json', async (req, res) => {
  const body = (req.body ?? {}) as { settings?: unknown };
  if (
    !body.settings ||
    typeof body.settings !== 'object' ||
    Array.isArray(body.settings)
  ) {
    return res.status(400).json(
      createResponse({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Expected a `settings` object mapping keys to values.',
        },
      })
    );
  }
  const username =
    (req as { user?: { username?: string } }).user?.username ?? 'admin';
  const meta = new Map(settingsStore.metadata.map((m) => [m.key, m]));

  const imported: string[] = [];
  const skipped: { key: string; reason: string }[] = [];
  const failed: { key: string; reason: string }[] = [];
  let requiresRestart = false;

  for (const [key, value] of Object.entries(
    body.settings as Record<string, unknown>
  )) {
    const m = meta.get(key);
    if (!m) {
      skipped.push({ key, reason: 'unknown' });
      continue;
    }
    if (m.source === 'environment') {
      skipped.push({ key, reason: 'env-locked' });
      continue;
    }
    try {
      await settingsStore.set(key, value, username);
      imported.push(key);
      if (m.requiresRestart) requiresRestart = true;
    } catch (err) {
      failed.push({
        key,
        reason: err instanceof Error ? err.message : 'invalid value',
      });
    }
  }

  if (imported.length)
    logger.info(
      { imported: imported.length, username },
      'settings imported from json'
    );

  res.status(200).json(
    createResponse({
      success: true,
      data: { imported, skipped, failed, requiresRestart },
    })
  );
});

// JSON dump of every DB-sourced setting.
// Secrets are masked (value=null) and listed in maskedSecretKeys so the
// consumer can re-enter them by hand.
router.get('/settings/export', (req, res) => {
  const username =
    (req as { user?: { username?: string } }).user?.username ?? 'admin';
  const settings: Record<string, unknown> = {};
  const maskedSecretKeys: string[] = [];
  for (const m of settingsStore.metadata) {
    if (m.source !== 'database') continue;
    if (m.secret) {
      settings[m.key] = null;
      maskedSecretKeys.push(m.key);
      continue;
    }
    try {
      settings[m.key] = settingsStore.getEffectiveValue(m.key);
    } catch {
      /* skip unreadable */
    }
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    version: settingsStore.currentVersion,
    settings,
    maskedSecretKeys,
  };
  logger.info(
    { count: Object.keys(settings).length, username },
    'settings exported'
  );

  if (req.query.download === '1') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="aiostreams-settings-${stamp}.json"`
    );
    return res.status(200).send(JSON.stringify(payload, null, 2));
  }

  res.status(200).json(createResponse({ success: true, data: payload }));
});

// =============================================================================
// Analytics
// =============================================================================

function parseRange(v: unknown): AnalyticsRange {
  return v === '24h' || v === '7d' || v === '30d' || v === 'all' ? v : '7d';
}

router.get('/analytics/overview', async (_req, res) => {
  res.status(200).json(
    createResponse({
      success: true,
      data: await AnalyticsRepository.overview(),
    })
  );
});

router.get('/analytics/users', async (req, res) => {
  const range = parseRange(req.query.range);
  const [growth, topUsers] = await Promise.all([
    AnalyticsRepository.userGrowth(range),
    AnalyticsRepository.topUsers(range),
  ]);
  res
    .status(200)
    .json(createResponse({ success: true, data: { growth, topUsers } }));
});

router.get('/analytics/users/:uuidHash', async (req, res) => {
  const range = parseRange(req.query.range);
  const data = await AnalyticsRepository.userActivity(
    req.params.uuidHash,
    range
  );
  res.status(200).json(createResponse({ success: true, data }));
});

router.get('/analytics/requests', async (req, res) => {
  const data = await AnalyticsRepository.requests(parseRange(req.query.range));
  res.status(200).json(createResponse({ success: true, data }));
});

router.get('/analytics/addons', async (req, res) => {
  const data = await AnalyticsRepository.addons(parseRange(req.query.range));
  res.status(200).json(createResponse({ success: true, data }));
});

router.get('/analytics/features', async (req, res) => {
  const data = await AnalyticsRepository.features(parseRange(req.query.range));
  res.status(200).json(createResponse({ success: true, data }));
});

// =============================================================================
// System — host/process metrics + (gated) lifecycle
// =============================================================================

router.get('/system', async (_req, res) => {
  res.status(200).json(
    createResponse({
      success: true,
      data: {
        ...(await getSystemMetrics()),
        lifecycleEnabled: appConfig.bootstrap.systemLifecycleEnabled === true,
      },
    })
  );
});

// GET /dashboard/system/stream — SSE, one metrics frame every 5s.
router.get('/system/stream', (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let closed = false;
  const tick = async () => {
    if (closed) return;
    try {
      const m = await getSystemMetrics();
      res.write(`data: ${JSON.stringify(m)}\n\n`);
    } catch {
      /* skip a frame */
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 5000);
  const hb = setInterval(() => res.write(':hb\n\n'), 15000);

  req.on('close', () => {
    closed = true;
    clearInterval(timer);
    clearInterval(hb);
    res.end();
  });
});

/**
 * Graceful exit of *this AIOStreams process only* (never the host). Recovery
 * is the supervisor's job. `restart` exits non-zero (42) so process managers
 * configured to restart bring it back; `stop` exits 0.
 */
async function lifecycleExit(action: 'restart' | 'stop', username: string) {
  logger.warn({ user: username, action }, 'lifecycle action requested');
  // best-effort drain
  try {
    await stopAnalytics();
  } catch {
    /* ignore */
  }
  try {
    await Cache.close();
  } catch {
    /* ignore */
  }
  try {
    await closeDb();
  } catch {
    /* ignore */
  }
  setTimeout(() => process.exit(action === 'restart' ? 42 : 0), 250);
}

function lifecycleRoute(action: 'restart' | 'stop') {
  return (req: import('express').Request, res: import('express').Response) => {
    if (appConfig.bootstrap.systemLifecycleEnabled !== true) {
      return res.status(403).json(
        createResponse({
          success: false,
          error: {
            code: 'LIFECYCLE_DISABLED',
            message:
              'System lifecycle is disabled. Set SYSTEM_LIFECYCLE_ENABLED=true to allow this.',
          },
        })
      );
    }
    const confirm = (req.body ?? {}).confirm;
    if (confirm !== action.toUpperCase()) {
      return res.status(400).json(
        createResponse({
          success: false,
          error: {
            code: 'CONFIRMATION_REQUIRED',
            message: `Type ${action.toUpperCase()} to confirm.`,
          },
        })
      );
    }
    const username =
      (req as { user?: { username?: string } }).user?.username ?? 'admin';
    res
      .status(200)
      .json(
        createResponse({ success: true, data: { action, accepted: true } })
      );
    void lifecycleExit(action, username);
  };
}

router.post('/system/stop', lifecycleRoute('stop'));

// =============================================================================
// Users — browse / inspect / delete configs (no secrets ever returned)
// =============================================================================

router.get('/users', async (req, res) => {
  const q = req.query as Record<string, string>;
  const data = await AdminUsersRepository.list({
    page: Number(q.page) || 1,
    limit: Number(q.limit) || 25,
    q: q.q?.trim() || undefined,
    sort: q.sort,
    dir: q.dir === 'asc' ? 'asc' : 'desc',
  });
  res.status(200).json(createResponse({ success: true, data }));
});

router.get('/users/:uuid', async (req, res) => {
  const u = await AdminUsersRepository.get(req.params.uuid);
  if (!u)
    return res.status(404).json(
      createResponse({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found' },
      })
    );
  res.status(200).json(createResponse({ success: true, data: u }));
});

router.delete('/users/:uuid', async (req, res) => {
  const ok = await AdminUsersRepository.remove(req.params.uuid);
  const username =
    (req as { user?: { username?: string } }).user?.username ?? 'admin';
  if (ok) logger.warn({ uuid: req.params.uuid, username }, 'user deleted');
  res.status(ok ? 200 : 404).json(
    ok
      ? createResponse({ success: true, data: { deleted: true } })
      : createResponse({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' },
        })
  );
});

/**
 * Batch delete. Body is either `{ uuids: string[] }` (explicit selection) or
 * `{ allMatching: true, q?: string }` (delete every row matching the search).
 * The latter is logged with a count and the search query for audit purposes.
 */
router.delete('/users', async (req, res) => {
  const body = (req.body ?? {}) as {
    uuids?: unknown;
    allMatching?: unknown;
    q?: unknown;
  };
  const username =
    (req as { user?: { username?: string } }).user?.username ?? 'admin';
  const allMatching = body.allMatching === true;
  const uuids = Array.isArray(body.uuids)
    ? body.uuids.filter((u): u is string => typeof u === 'string')
    : [];
  const q = typeof body.q === 'string' ? body.q.trim() || undefined : undefined;
  if (!allMatching && uuids.length === 0) {
    return res.status(400).json(
      createResponse({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Either uuids[] or allMatching=true must be supplied',
        },
      })
    );
  }
  const deleted = await AdminUsersRepository.bulkRemove({
    uuids,
    allMatching,
    q,
  });
  logger.warn(
    { username, deleted, allMatching, q, requested: uuids.length },
    'users batch deleted'
  );
  res.status(200).json(createResponse({ success: true, data: { deleted } }));
});

// =============================================================================
// Tasks — registry + manual trigger
// =============================================================================

router.get('/tasks', (_req, res) => {
  res
    .status(200)
    .json(
      createResponse({ success: true, data: { tasks: TaskManager.list() } })
    );
});

router.post('/tasks/:id/run', async (req, res) => {
  const task = TaskManager.list().find((t) => t.id === req.params.id);
  if (!task)
    return res.status(404).json(
      createResponse({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Unknown task' },
      })
    );
  if (TaskManager.isRunning(task.id))
    return res.status(409).json(
      createResponse({
        success: false,
        error: { code: 'ALREADY_RUNNING', message: 'Task already running' },
      })
    );
  // Destructive tasks must be confirmed; don't trust the client skipped it.
  if (task.destructive && (req.body ?? {}).confirm !== true)
    return res.status(400).json(
      createResponse({
        success: false,
        error: {
          code: 'CONFIRMATION_REQUIRED',
          message: 'This task is destructive and requires confirmation.',
        },
      })
    );
  const username =
    (req as { user?: { username?: string } }).user?.username ?? 'admin';
  logger.info({ task: task.id, username }, 'task run requested');
  const result = await TaskManager.runNow(task.id);
  if (!result.ok) {
    return res.status(500).json(
      createResponse({
        success: false,
        error: {
          code: 'TASK_FAILED',
          message: result.message ?? 'Task failed',
        },
      })
    );
  }
  res.status(200).json(createResponse({ success: true, data: result }));
});

// =============================================================================
// Cache — describe / opt-in scan / clear
// =============================================================================

let lastScanAt = 0;

router.get('/cache', async (_req, res) => {
  const described = await Cache.describe();
  // Merge in the two-tier disk-backed caches (segment + grab caches) so they
  // appear alongside the memory/redis/sql instances.
  const diskInstances = describeDiskCaches().map((c) => ({
    name: c.name,
    backend: 'disk' as const,
    maxSize: c.maxDiskBytes || c.maxMemBytes || null,
    items: c.stats.memCount + c.stats.diskCount,
    estBytes: c.stats.memBytes + c.stats.diskBytes,
  }));
  const totalDiskBytes = diskInstances.reduce((n, c) => n + c.estBytes, 0);
  const data = {
    ...described,
    instances: [...described.instances, ...diskInstances],
    totals: {
      ...described.totals,
      instances: described.totals.instances + diskInstances.length,
      estBytes:
        described.totals.estBytes == null
          ? totalDiskBytes
          : described.totals.estBytes + totalDiskBytes,
    },
  };
  res.status(200).json(createResponse({ success: true, data }));
});

router.post('/cache/scan', async (req, res) => {
  const prefix = (req.body ?? {}).prefix;
  if (typeof prefix !== 'string' || !prefix)
    return res.status(400).json(
      createResponse({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'prefix is required' },
      })
    );
  // Rate-limit: one scan per 5s across the dashboard.
  if (Date.now() - lastScanAt < 5000)
    return res.status(429).json(
      createResponse({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Scans are rate-limited. Try again shortly.',
        },
      })
    );
  lastScanAt = Date.now();
  const result = await Cache.scanPrefix(prefix, { limit: 200_000 });
  res.status(200).json(createResponse({ success: true, data: result }));
});

router.post('/cache/clear', async (req, res) => {
  const body = req.body ?? {};
  if (body.confirm !== true)
    return res.status(400).json(
      createResponse({
        success: false,
        error: {
          code: 'CONFIRMATION_REQUIRED',
          message: 'Clearing cache is destructive and requires confirmation.',
        },
      })
    );
  const username =
    (req as { user?: { username?: string } }).user?.username ?? 'admin';
  if (typeof body.prefix === 'string' && body.prefix) {
    // Disk-backed caches are keyed by name, not a Cache prefix.
    if (await clearDiskCacheByName(body.prefix)) {
      logger.warn({ prefix: body.prefix, username }, 'disk cache cleared');
      return res
        .status(200)
        .json(
          createResponse({ success: true, data: { cleared: body.prefix } })
        );
    }
    const ok = await Cache.clearPrefix(body.prefix);
    logger.warn({ prefix: body.prefix, username }, 'cache prefix cleared');
    return res.status(ok ? 200 : 404).json(
      ok
        ? createResponse({ success: true, data: { cleared: body.prefix } })
        : createResponse({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Unknown cache prefix' },
          })
    );
  }
  logger.warn({ username }, 'all cache cleared');
  const result = await TaskManager.runNow('clear-all-cache');
  res
    .status(result.ok ? 200 : 500)
    .json(createResponse({ success: result.ok, data: result }));
});

export default router;
