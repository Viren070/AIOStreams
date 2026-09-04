import { Router } from 'express';
import { createResponse } from '../../../utils/responses.js';
import { fuseStatus, startFuseMount, stopFuseMount } from '../../../fuse.js';

const router: Router = Router();

// GET /dashboard/shares/fuse/status: mount state, availability, stats.
router.get('/fuse/status', (_req, res) => {
  res.status(200).json(createResponse({ success: true, data: fuseStatus() }));
});

// POST /dashboard/shares/fuse/mount: mount now (the mount must be enabled).
router.post('/fuse/mount', async (_req, res, next) => {
  try {
    const status = await startFuseMount();
    res.status(200).json(createResponse({ success: true, data: status }));
  } catch (err) {
    next(err);
  }
});

// POST /dashboard/shares/fuse/unmount: unmount until asked again or restarted.
router.post('/fuse/unmount', async (_req, res, next) => {
  try {
    const status = await stopFuseMount();
    res.status(200).json(createResponse({ success: true, data: status }));
  } catch (err) {
    next(err);
  }
});

export default router;
