import { Router } from 'express';
import {
  appReportBodySchema,
  AppReportsDisabledError,
  receiveAppReport,
} from '@aiostreams/core';
import { createResponse } from '../../utils/responses.js';

const router: Router = Router();

/** A report another server passed on, kept where this one takes them from anyone. */
router.post('/', async (req, res) => {
  const parsed = appReportBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(
      createResponse({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'A report needs a platform and a summary',
        },
      })
    );
    return;
  }
  const origin = typeof req.body?.origin === 'string' ? req.body.origin : null;
  try {
    const code = await receiveAppReport(parsed.data, origin);
    res.json(createResponse({ success: true, data: { code } }));
  } catch (error) {
    if (!(error instanceof AppReportsDisabledError)) throw error;
    res.status(404).json(
      createResponse({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'This server takes no reports from other servers',
        },
      })
    );
  }
});

export default router;
