import { Router } from 'express';
import {
  createLogger,
  formatZodError,
  getArrInstances,
  saveArrInstances,
  testArrInstance,
  getQueueCleanupRules,
  saveQueueCleanupRules,
  processArrRepairs,
  repairArrEntryNow,
} from '@aiostreams/core';
import { ZodError } from 'zod';
import { createResponse } from '../../../utils/responses.js';

const router: Router = Router();
const logger = createLogger('dashboard:arr');

function username(req: { user?: { username?: string } }): string {
  return req.user?.username ?? 'admin';
}

// GET /dashboard/arr/instances: configured instances, API keys masked.
router.get('/instances', (_req, res, next) => {
  try {
    res.status(200).json(
      createResponse({
        success: true,
        data: { instances: getArrInstances() },
      })
    );
  } catch (err) {
    next(err);
  }
});

// PUT /dashboard/arr/instances: replace the instance list.
router.put('/instances', async (req, res) => {
  const body = (req.body ?? {}) as { instances?: unknown };
  if (!Array.isArray(body.instances)) {
    return res.status(400).json(
      createResponse({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'instances[] is required' },
      })
    );
  }
  try {
    await saveArrInstances(body.instances as never[], username(req));
    logger.info({ count: body.instances.length }, 'arr instances updated');
    res.status(200).json(
      createResponse({
        success: true,
        data: { instances: getArrInstances() },
      })
    );
  } catch (err) {
    const message =
      err instanceof ZodError
        ? formatZodError(err, { singleLine: true })
        : err instanceof Error
          ? err.message
          : 'Invalid instances';
    res.status(422).json(
      createResponse({
        success: false,
        error: { code: 'VALIDATION_ERROR', message },
      })
    );
  }
});

// POST /dashboard/arr/instances/test: reachability + credential check.
router.post('/instances/test', async (req, res, next) => {
  try {
    const result = await testArrInstance((req.body ?? {}) as never);
    res.status(200).json(createResponse({ success: true, data: result }));
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/arr/queue-rules: the catalogue plus the user's choices.
router.get('/queue-rules', (_req, res, next) => {
  try {
    res
      .status(200)
      .json(
        createResponse({
          success: true,
          data: { rules: getQueueCleanupRules() },
        })
      );
  } catch (err) {
    next(err);
  }
});

// PUT /dashboard/arr/queue-rules: enable/action choices only.
router.put('/queue-rules', async (req, res) => {
  const body = (req.body ?? {}) as { rules?: unknown };
  if (!Array.isArray(body.rules)) {
    return res.status(400).json(
      createResponse({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'rules[] is required' },
      })
    );
  }
  try {
    await saveQueueCleanupRules(body.rules as never[], username(req));
    res
      .status(200)
      .json(
        createResponse({
          success: true,
          data: { rules: getQueueCleanupRules() },
        })
      );
  } catch (err) {
    const message =
      err instanceof ZodError
        ? formatZodError(err, { singleLine: true })
        : err instanceof Error
          ? err.message
          : 'Invalid rules';
    res.status(422).json(
      createResponse({
        success: false,
        error: { code: 'VALIDATION_ERROR', message },
      })
    );
  }
});

// POST /dashboard/arr/repairs/run: work through queued replacements now.
router.post('/repairs/run', async (_req, res, next) => {
  try {
    const result = await processArrRepairs();
    res.status(200).json(createResponse({ success: true, data: result }));
  } catch (err) {
    next(err);
  }
});

// POST /dashboard/arr/repairs/:hash: replace one library entry now.
router.post('/repairs/:hash', async (req, res, next) => {
  try {
    const outcome = await repairArrEntryNow(String(req.params.hash));
    res.status(200).json(createResponse({ success: true, data: { outcome } }));
  } catch (err) {
    next(err);
  }
});

export default router;
