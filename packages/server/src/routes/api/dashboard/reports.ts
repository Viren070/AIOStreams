import { Router } from 'express';
import { AppReportRepository, formatReportCode } from '@aiostreams/core';
import { createResponse } from '../../../utils/responses.js';

const router: Router = Router();

const PAGE = 25;

/** A page of them, newest first. */
router.get('/', async (req, res) => {
  const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
  const { items, total } = await AppReportRepository.list(
    PAGE,
    (page - 1) * PAGE
  );
  res.json(
    createResponse({
      success: true,
      data: {
        items: items.map((r) => ({ ...r, code: formatReportCode(r.code) })),
        total,
        pageSize: PAGE,
      },
    })
  );
});

/** `{ codes }` deletes those, `{ all: true }` every report. */
router.delete('/', async (req, res) => {
  const codes: unknown = req.body?.codes;
  const removed =
    req.body?.all === true
      ? await AppReportRepository.clear()
      : await AppReportRepository.remove(
          Array.isArray(codes)
            ? codes
                .filter((c): c is string => typeof c === 'string')
                .slice(0, 500)
            : []
        );
  res.json(createResponse({ success: true, data: { removed } }));
});

router.get('/:code', async (req, res) => {
  const report = await AppReportRepository.get(req.params.code);
  if (!report) {
    res.status(404).json(
      createResponse({
        success: false,
        error: { code: 'NOT_FOUND', message: 'No report has that code' },
      })
    );
    return;
  }
  res.json(
    createResponse({
      success: true,
      data: { ...report, code: formatReportCode(report.code) },
    })
  );
});

router.delete('/:code', async (req, res) => {
  const removed = await AppReportRepository.remove([req.params.code]);
  res.json(createResponse({ success: true, data: { removed } }));
});

export default router;
