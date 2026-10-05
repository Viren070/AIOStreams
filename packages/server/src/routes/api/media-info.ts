import { Router } from 'express';
import { APIError, appConfig, constants, sharedRows } from '@aiostreams/core';
import { z } from 'zod';
import { createResponse } from '../../utils/responses.js';

const router: Router = Router();

const LookupSchema = z.object({
  keys: z.array(z.string().max(80)).min(1).max(100),
});

// POST /media-info/lookup: the stored media info for a list of release keys.
router.post('/lookup', async (req, res, next) => {
  if (!appConfig.mediaInfo.serve) {
    next(
      new APIError(
        constants.ErrorCode.FORBIDDEN,
        undefined,
        'This instance does not share its media info'
      )
    );
    return;
  }
  const parsed = LookupSchema.safeParse(req.body);
  if (!parsed.success) {
    next(
      new APIError(
        constants.ErrorCode.BAD_REQUEST,
        undefined,
        'keys must be a list of 1 to 100 release keys'
      )
    );
    return;
  }
  try {
    const rows = await sharedRows(parsed.data.keys);
    // Not res.json: a POST is never revalidated, so its ETag hash is wasted.
    res
      .status(200)
      .type('json')
      .end(JSON.stringify(createResponse({ success: true, data: { rows } })));
  } catch (err) {
    next(err);
  }
});

export default router;
