import { Router } from 'express';
import {
  createLogger,
  mediaInfoProber,
  mediaInfoSummary,
  MediaInfoProbeRepository,
  mediaInfoFiles,
  MEDIA_INFO_PROBE_PATHS,
  type MediaInfoKind,
  type ProbeFinished,
  type ProbeOutcome,
  type ProbePath,
} from '@aiostreams/core';
import { createResponse } from '../../../utils/responses.js';

const router: Router = Router();
const logger = createLogger('dashboard:media-info');

const OUTCOMES: ProbeOutcome[] = [
  'stored',
  'applied',
  'empty',
  'failed',
  'timeout',
  'cancelled',
];
const NZB_HASH = /^[0-9a-f]{40}$/;
const INFO_HASH = /^[0-9a-f]{40}$/;
const KINDS: MediaInfoKind[] = ['usenet', 'torrent'];
const ORIGIN = /^[a-z0-9-]{1,32}$/;

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

function page(query: Record<string, unknown>) {
  const limit = Number(query.limit ?? 25);
  const offset = Number(query.offset ?? 0);
  return {
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 25,
    offset: Number.isFinite(offset) ? Math.max(offset, 0) : 0,
  };
}

// GET /dashboard/media-info: totals and recent timings.
router.get('/', async (_req, res, next) => {
  try {
    const data = await mediaInfoSummary();
    res.status(200).json(createResponse({ success: true, data }));
  } catch (err) {
    next(err);
  }
});

router.get('/live', (_req, res) => {
  res
    .status(200)
    .json(createResponse({ success: true, data: mediaInfoProber.snapshot() }));
});

const LIVE_TICK_MS = 1_000;
const LIVE_HEARTBEAT_MS = 15_000;

router.get('/live/stream', (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let last = '';
  const tick = () => {
    const frame = JSON.stringify(mediaInfoProber.snapshot());
    if (frame === last) return;
    last = frame;
    res.write(`data: ${frame}\n\n`);
  };
  // Tells the page to refetch the totals and logs.
  const onFinished = ({ outcome }: ProbeFinished) => {
    tick();
    res.write(`event: finished\ndata: ${JSON.stringify({ outcome })}\n\n`);
  };
  tick();
  const timer = setInterval(tick, LIVE_TICK_MS);
  const hb = setInterval(() => res.write(':hb\n\n'), LIVE_HEARTBEAT_MS);
  mediaInfoProber.on('finished', onFinished);
  req.on('close', () => {
    clearInterval(timer);
    clearInterval(hb);
    mediaInfoProber.off('finished', onFinished);
    res.end();
  });
});

// GET /dashboard/media-info/probes: the attempt log, newest first.
router.get('/probes', async (req, res, next) => {
  try {
    const data = await MediaInfoProbeRepository.list({
      ...page(req.query),
      outcome: oneOf(req.query.outcome, OUTCOMES),
      path: oneOf<ProbePath>(req.query.path, MEDIA_INFO_PROBE_PATHS),
      kind: oneOf(req.query.kind, KINDS),
      search: String(req.query.q ?? '').trim() || undefined,
    });
    res.status(200).json(createResponse({ success: true, data }));
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/media-info/files: stored files; `nzb` or `hash` picks one release.
router.get('/files', async (req, res, next) => {
  try {
    const nzb = String(req.query.nzb ?? '').toLowerCase();
    const hash = String(req.query.hash ?? '').toLowerCase();
    const origin = String(req.query.origin ?? '');
    const data = await mediaInfoFiles({
      ...page(req.query),
      search: String(req.query.q ?? '').trim() || undefined,
      nzbHash: NZB_HASH.test(nzb) ? nzb : undefined,
      infoHash: INFO_HASH.test(hash) ? hash : undefined,
      kind: oneOf(req.query.kind, KINDS),
      origin: ORIGIN.test(origin) ? origin : undefined,
    });
    res.status(200).json(createResponse({ success: true, data }));
  } catch (err) {
    next(err);
  }
});

router.post('/jobs/:id/cancel', (req, res) => {
  const cancelled = mediaInfoProber.cancel(req.params.id);
  if (!cancelled) {
    return res.status(404).json(
      createResponse({
        success: false,
        error: { code: 'NOT_FOUND', message: 'probe not found' },
      })
    );
  }
  logger.info({ id: req.params.id }, 'cancelled a media info probe');
  res.status(200).json(createResponse({ success: true, data: { cancelled } }));
});

export default router;
