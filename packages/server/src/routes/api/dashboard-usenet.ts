import { Router, Request, Response } from 'express';
import {
  config as appConfig,
  createLogger,
  formatZodError,
  getUsenetStatsOverview,
  getUsenetLiveStats,
  killUsenetStream,
  getUsenetProviders,
  saveUsenetProviders,
  getUsenetSettings,
  saveUsenetSettings,
  PERFORMANCE_PROFILES,
  testUsenetProvider,
  runProviderSpeedTest,
  addUsenetNzb,
  requeueUsenetNzb,
  mintUsenetLibraryToken,
  exportUsenetLibraryNzb,
  UsenetLibraryRepository,
  usenetLibraryBus,
  ReleaseBlocklistRepository,
  blocklistEvalOptions,
  nzbContentKey,
  type UsenetStatsWindow,
  type UsenetLibraryStatusGroup,
  type UsenetLibraryStatus,
  type UsenetLibrarySort,
  type UsenetLibrarySortDir,
} from '@aiostreams/core';
import { ZodError } from 'zod';
import { createResponse } from '../../utils/responses.js';
import {
  nzbUpload,
  pickUploadedFile,
  isFileTooLargeError,
} from '../../middlewares/upload.js';

const router: Router = Router();
const logger = createLogger('dashboard:usenet');

const WINDOWS: UsenetStatsWindow[] = ['24h', '7d', '30d', 'all'];
const STATUS_GROUPS: UsenetLibraryStatusGroup[] = ['active', 'history', 'all'];
const LIBRARY_STATUSES: UsenetLibraryStatus[] = [
  'queued',
  'inspecting',
  'available',
  'degraded',
  'failed',
  'streaming',
];
const LIBRARY_SORTS: UsenetLibrarySort[] = [
  'activity',
  'added',
  'name',
  'size',
];
const LIBRARY_SORT_DIRS: UsenetLibrarySortDir[] = ['asc', 'desc'];

function username(req: { user?: { username?: string } }): string {
  return req.user?.username ?? 'admin';
}

// GET /dashboard/usenet/stats?window=24h — full overview (live + providers + series).
router.get('/stats', async (req, res, next) => {
  try {
    const w = String(req.query.window ?? '24h') as UsenetStatsWindow;
    const window = WINDOWS.includes(w) ? w : '24h';
    const overview = await getUsenetStatsOverview(window);
    res.status(200).json(createResponse({ success: true, data: overview }));
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/usenet/live — one-shot live tiles + pool. Seeds the first
// render (and is the fallback where SSE can't get through); /live/stream is
// what keeps the dashboard current.
router.get('/live', (_req, res, next) => {
  try {
    res
      .status(200)
      .json(createResponse({ success: true, data: getUsenetLiveStats() }));
  } catch (err) {
    next(err);
  }
});

const LIVE_TICK_MS = 1_500;
const LIVE_HEARTBEAT_MS = 15_000;

router.get('/live/stream', (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let closed = false;
  let last = '';
  const tick = () => {
    if (closed) return;
    try {
      const frame = JSON.stringify({
        ...getUsenetLiveStats(),
        tickMs: LIVE_TICK_MS,
      });
      if (frame === last) return;
      last = frame;
      res.write(`data: ${frame}\n\n`);
    } catch {
      /* skip a frame */
    }
  };
  tick();
  const timer = setInterval(tick, LIVE_TICK_MS);
  const hb = setInterval(() => res.write(':hb\n\n'), LIVE_HEARTBEAT_MS);

  req.on('close', () => {
    closed = true;
    clearInterval(timer);
    clearInterval(hb);
    res.end();
  });
});

// DELETE /dashboard/usenet/streams/:id — force-stop one live read stream.
router.delete('/streams/:id', (req, res, next) => {
  try {
    if (!killUsenetStream(req.params.id)) {
      return res.status(404).json(
        createResponse({
          success: false,
          error: { code: 'NOT_FOUND', message: 'stream not found' },
        })
      );
    }
    logger.info({ id: req.params.id }, 'stream stopped from the dashboard');
    res
      .status(200)
      .json(createResponse({ success: true, data: { stopped: true } }));
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/usenet/providers — provider list with passwords masked.
router.get('/providers', (_req, res, next) => {
  try {
    res.status(200).json(
      createResponse({
        success: true,
        data: { providers: getUsenetProviders() },
      })
    );
  } catch (err) {
    next(err);
  }
});

// PUT /dashboard/usenet/providers — replace the provider list.
router.put('/providers', async (req, res) => {
  const body = (req.body ?? {}) as { providers?: unknown };
  if (!Array.isArray(body.providers)) {
    return res.status(400).json(
      createResponse({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'providers[] is required' },
      })
    );
  }
  try {
    await saveUsenetProviders(body.providers as never[], username(req));
    logger.info({ count: body.providers.length }, 'usenet providers updated');
    res.status(200).json(
      createResponse({
        success: true,
        data: { providers: getUsenetProviders() },
      })
    );
  } catch (err) {
    const message =
      err instanceof ZodError
        ? formatZodError(err, { singleLine: true })
        : err instanceof Error
          ? err.message
          : 'Invalid providers';
    res.status(422).json(
      createResponse({
        success: false,
        error: { code: 'VALIDATION_ERROR', message },
      })
    );
  }
});

// GET /dashboard/usenet/settings — engine settings (incl. hidden) + values.
router.get('/settings', (_req, res, next) => {
  try {
    res.status(200).json(
      createResponse({
        success: true,
        data: { keys: getUsenetSettings(), profiles: PERFORMANCE_PROFILES },
      })
    );
  } catch (err) {
    next(err);
  }
});

// PATCH /dashboard/usenet/settings — { [dottedKey]: value } (changed keys only).
router.patch('/settings', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { updated, requiresRestart, errors } = await saveUsenetSettings(
      body,
      username(req)
    );
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
  } catch (err) {
    next(err);
  }
});

// POST /dashboard/usenet/providers/test — dial + auth + DATE probe.
router.post('/providers/test', async (req, res, next) => {
  try {
    const result = await testUsenetProvider(
      (req.body ?? {}) as Record<string, unknown>
    );
    res.status(200).json(createResponse({ success: true, data: result }));
  } catch (err) {
    next(err);
  }
});

// POST /dashboard/usenet/providers/:id/speedtest — measure download throughput
// by fanning a fixed test NZB out across the provider's whole connection pool.
router.post('/providers/:id/speedtest', async (req, res, next) => {
  try {
    const result = await runProviderSpeedTest({ id: req.params.id });
    res.status(200).json(createResponse({ success: true, data: result }));
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/usenet/library?status=active|history|all — library rows.
// GET /dashboard/usenet/library/stream — SSE: pushes a coalesced `change` event
// whenever a library entry is added, transitions, or is removed, so the
// dashboard list updates live without polling. Registered before the
// `/library/:hash/...` routes so `stream` isn't read as a hash.
router.get('/library/stream', (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let closed = false;
  let pending: NodeJS.Timeout | null = null;
  // Coalesce bursts (bulk drops, multi-file inspection) into one frame per tick.
  const onChange = () => {
    if (closed || pending) return;
    pending = setTimeout(() => {
      pending = null;
      if (!closed) res.write('data: {"type":"change"}\n\n');
    }, 250);
  };
  usenetLibraryBus.on('change', onChange);
  const hb = setInterval(() => res.write(':hb\n\n'), 15000);

  req.on('close', () => {
    closed = true;
    usenetLibraryBus.off('change', onChange);
    if (pending) clearTimeout(pending);
    clearInterval(hb);
    res.end();
  });
});

/**
 * Annotate library rows with whether the release blocklist currently flags
 * them (under the wd1 fingerprint and/or nh1 content-hash key)
 */
async function annotateBlocked<
  T extends { nzbHash: string; releaseKey?: string },
>(entries: T[]): Promise<Array<T & { blocked: boolean }>> {
  const keysFor = (e: T) =>
    [e.releaseKey, nzbContentKey(e.nzbHash)].filter((k): k is string => !!k);
  try {
    const keys = [...new Set(entries.flatMap(keysFor))];
    if (keys.length === 0) {
      return entries.map((e) => ({ ...e, blocked: false }));
    }
    const verdicts = await ReleaseBlocklistRepository.evaluateKeys(
      keys,
      blocklistEvalOptions()
    );
    return entries.map((e) => ({
      ...e,
      blocked: keysFor(e).some((k) => verdicts.get(k)?.filtered),
    }));
  } catch (err) {
    logger.warn({ err }, 'blocklist annotation of library entries failed');
    return entries.map((e) => ({ ...e, blocked: false }));
  }
}

router.get('/library', async (req, res, next) => {
  try {
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const statusParam = String(req.query.status ?? 'all');
    const group = STATUS_GROUPS.includes(
      statusParam as UsenetLibraryStatusGroup
    )
      ? (statusParam as UsenetLibraryStatusGroup)
      : 'all';
    // Optional explicit status filter (CSV), e.g. ?statuses=failed,queued.
    const statuses = String(req.query.statuses ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is UsenetLibraryStatus =>
        LIBRARY_STATUSES.includes(s as UsenetLibraryStatus)
      );
    const search = String(req.query.q ?? '').trim();
    const sortParam = String(req.query.sort ?? '') as UsenetLibrarySort;
    const sort = LIBRARY_SORTS.includes(sortParam) ? sortParam : undefined;
    const dirParam = String(req.query.dir ?? '') as UsenetLibrarySortDir;
    const dir = LIBRARY_SORT_DIRS.includes(dirParam) ? dirParam : undefined;
    const data = await UsenetLibraryRepository.list({
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
      group,
      statuses,
      search: search || undefined,
      sort,
      dir,
    });
    res.status(200).json(
      createResponse({
        success: true,
        data: { ...data, entries: await annotateBlocked(data.entries) },
      })
    );
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/usenet/library/:hash/files — file/folder tree for browsing.
router.get('/library/:hash/files', async (req, res, next) => {
  try {
    const entry = (await UsenetLibraryRepository.getResolved(req.params.hash))
      ?.entry;
    if (!entry) {
      return res.status(404).json(
        createResponse({
          success: false,
          error: { code: 'NOT_FOUND', message: 'library entry not found' },
        })
      );
    }
    res.status(200).json(
      createResponse({
        success: true,
        data: { hash: entry.nzbHash, name: entry.name, files: entry.files },
      })
    );
  } catch (err) {
    next(err);
  }
});

// POST /dashboard/usenet/library — manual add by URL ({ url, name? }).
router.post('/library', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { url?: unknown; name?: unknown };
    if (typeof body.url !== 'string' || !body.url.trim()) {
      return res.status(400).json(
        createResponse({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'url is required' },
        })
      );
    }
    const entry = await addUsenetNzb({
      url: body.url.trim(),
      name: typeof body.name === 'string' ? body.name : undefined,
      owner: username(req),
    });
    logger.info(
      { nzbHash: entry.nzbHash, status: entry.status },
      'manual nzb add'
    );
    res.status(200).json(createResponse({ success: true, data: entry }));
  } catch (err) {
    next(err);
  }
});

// POST /dashboard/usenet/library/upload — import a raw .nzb upload as multipart
// (file field `file`). The size cap (usenet.maxNzbSize) is enforced by the
// shared upload middleware; oversize uploads surface as a 413 below.
const UPLOAD_FIELDS = ['file'];
router.post(
  '/library/upload',
  nzbUpload(UPLOAD_FIELDS),
  async (req, res, next) => {
    try {
      const file = pickUploadedFile(req, UPLOAD_FIELDS);
      if (!file || file.buffer.length === 0) {
        return res.status(400).json(
          createResponse({
            success: false,
            error: { code: 'BAD_REQUEST', message: 'an .nzb file is required' },
          })
        );
      }
      const name =
        (typeof req.body?.name === 'string' && req.body.name) ||
        file.originalname ||
        undefined;
      const entry = await addUsenetNzb({
        xml: file.buffer,
        name,
        owner: username(req),
      });
      logger.info(
        { nzbHash: entry.nzbHash, status: entry.status },
        'uploaded nzb add'
      );
      res.status(200).json(createResponse({ success: true, data: entry }));
    } catch (err) {
      next(err);
    }
  }
);

// POST /dashboard/usenet/library/requeue — re-import entries ({ hashes: [...] }):
// each source NZB is re-fetched and pushed back through the inspect queue,
// replacing the existing row. A single-entry requeue is a batch of one.
const MAX_REQUEUE = 200;
// Each requeue grabs its NZB from the indexer, so the batch is throttled rather
// than firing every grab at once.
const REQUEUE_CONCURRENCY = 4;

router.post('/library/requeue', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { hashes?: unknown };
    const hashes = [
      ...new Set(
        (Array.isArray(body.hashes) ? body.hashes : [])
          .filter((h): h is string => typeof h === 'string')
          .map((h) => h.trim())
          .filter(Boolean)
      ),
    ];
    if (hashes.length === 0) {
      return res.status(400).json(
        createResponse({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'hashes is required' },
        })
      );
    }
    if (hashes.length > MAX_REQUEUE) {
      return res.status(400).json(
        createResponse({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: `at most ${MAX_REQUEUE} entries can be requeued at once`,
          },
        })
      );
    }

    let cursor = 0;
    let requeued = 0;
    const errors: string[] = [];
    await Promise.all(
      Array.from(
        { length: Math.min(REQUEUE_CONCURRENCY, hashes.length) },
        async () => {
          while (cursor < hashes.length) {
            const hash = hashes[cursor++];
            try {
              await requeueUsenetNzb(hash);
              requeued++;
            } catch (err) {
              errors.push(
                err instanceof Error ? err.message : 'failed to requeue'
              );
            }
          }
        }
      )
    );
    logger.info(
      { username: username(req), requeued, failed: errors.length },
      'library entries requeued'
    );
    res.status(200).json(
      createResponse({
        success: true,
        data: { requeued, failed: errors.length, error: errors[0] },
      })
    );
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/usenet/library/:hash/play/:fileSel? — minted stream URL.
// GET /dashboard/usenet/library/:hash/download/:fileSel? — same, as attachment.
async function mintAndRespond(
  req: { params: { hash: string; fileSel?: string } },
  res: import('express').Response,
  next: import('express').NextFunction,
  download: boolean
): Promise<void> {
  try {
    const minted = await mintUsenetLibraryToken(
      req.params.hash,
      req.params.fileSel
    );
    if (!minted) {
      res.status(404).json(
        createResponse({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'no playable source for this entry',
          },
        })
      );
      return;
    }
    const url = `/api/v1/usenet/stream/${minted.token}${
      download ? '?download=1' : ''
    }`;
    res.status(200).json(
      createResponse({
        success: true,
        data: { url, filename: minted.filename },
      })
    );
  } catch (err) {
    next(err);
  }
}

router.get('/library/:hash/play{/:fileSel}', (req, res, next) =>
  mintAndRespond(req as never, res, next, false)
);
router.get('/library/:hash/download{/:fileSel}', (req, res, next) =>
  mintAndRespond(req as never, res, next, true)
);

// GET /dashboard/usenet/library/:hash/nzb — download the raw NZB for an entry.
// Useful for entries that failed because their articles are missing on every
// provider: the user can export the NZB and try it elsewhere.
router.get('/library/:hash/nzb', async (req, res, next) => {
  try {
    const exported = await exportUsenetLibraryNzb(req.params.hash);
    if (!exported) {
      res.status(404).json(
        createResponse({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'no NZB available for this entry',
          },
        })
      );
      return;
    }
    res.setHeader('Content-Type', 'application/x-nzb');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(exported.filename)}"`
    );
    res.status(200).send(exported.xml);
  } catch (err) {
    next(err);
  }
});

// DELETE /dashboard/usenet/library — remove every entry.
router.delete('/library', async (_req, res, next) => {
  try {
    await UsenetLibraryRepository.clear();
    res
      .status(200)
      .json(createResponse({ success: true, data: { cleared: true } }));
  } catch (err) {
    next(err);
  }
});

// DELETE /dashboard/usenet/library/:hash — remove one entry.
router.delete('/library/:hash', async (req, res, next) => {
  try {
    const resolved = await UsenetLibraryRepository.getResolved(req.params.hash);
    await UsenetLibraryRepository.delete(
      resolved?.entry.nzbHash ?? req.params.hash
    );
    res
      .status(200)
      .json(createResponse({ success: true, data: { deleted: true } }));
  } catch (err) {
    next(err);
  }
});

// Translate the upload middleware's oversize-file error into a 413.
router.use(
  (
    err: unknown,
    _req: Request,
    res: Response,
    next: (err?: unknown) => void
  ) => {
    if (isFileTooLargeError(err)) {
      const maxMb = Math.floor(appConfig.usenet.maxNzbSize / 1_000_000);
      res.status(413).json(
        createResponse({
          success: false,
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: `NZB exceeds the ${maxMb}MB limit`,
          },
        })
      );
      return;
    }
    next(err);
  }
);

export default router;
