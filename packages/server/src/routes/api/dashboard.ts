import { Router } from 'express';
import {
  createLogger,
  logRingBuffer,
  settingsStore,
  describeSettings,
  AnalyticsRepository,
  AdminUsersRepository,
  TaskManager,
  Cache,
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

const router: Router = Router();
const logger = createLogger('dashboard');

// Every /dashboard/* route is admin-only.
router.use(requireAdmin);

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
  const keys = settingsStore.metadata.map((m) => {
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

  for (const [key, value] of Object.entries(body)) {
    const m = meta.get(key);
    if (!m) {
      errors[key] = 'Unknown setting';
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
  res
    .status(200)
    .json(createResponse({ success: true, data: await Cache.describe() }));
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
