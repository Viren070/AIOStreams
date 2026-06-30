import { Router } from 'express';
import {
  APIError,
  constants,
  createLogger,
  ScreenerStore,
  ScreenerRemoteSourceService,
  parseNdjson,
  toNdjson,
  toDavexNdjson,
  isValidKey,
  type ScreenerSource,
} from '@aiostreams/core';
import { z } from 'zod';
import { requireAdmin } from '../../middlewares/auth.js';
import { createResponse } from '../../utils/responses.js';

const router: Router = Router();
const logger = createLogger('screener');

// The Screener store and its sources are instance-global and operator-managed.
router.use(requireAdmin);

const Trust = z.enum(['full', 'corroborate', 'observe']);
const Verdict = z.enum(['dead', 'fake', 'mislabeled']);

const badRequest = (message: string) =>
  new APIError(constants.ErrorCode.MISSING_REQUIRED_FIELDS, undefined, message);

const nowSec = () => Math.floor(Date.now() / 1000);

async function snapshot() {
  const [counts, sources] = await Promise.all([
    ScreenerStore.getCounts(),
    ScreenerStore.getSources(),
  ]);
  return { counts, sources };
}

// Current state: entry counts + every configured source.
router.get('/', async (_req, res, next) => {
  try {
    res.json(createResponse({ success: true, data: await snapshot() }));
  } catch (err) {
    next(err);
  }
});

// Subscribe to a remote list (and fetch it immediately).
const AddRemoteSchema = z.object({
  name: z.string().trim().optional(),
  url: z
    .url()
    .refine((u) => /^https?:\/\//i.test(u), 'URL must be http or https'),
  trust: Trust.optional(),
  refreshHours: z.number().int().min(1).max(720).optional(),
});
router.post('/sources/remote', async (req, res, next) => {
  const parsed = AddRemoteSchema.safeParse(req.body);
  if (!parsed.success) return next(badRequest('A valid url is required.'));
  const { name, url, trust, refreshHours } = parsed.data;
  try {
    const id = await ScreenerStore.addSource(
      'remote',
      name || new URL(url).host,
      url,
      trust ?? 'corroborate',
      refreshHours ?? 24
    );
    const source = (await ScreenerStore.getSources()).find((s) => s.id === id);
    const status = source
      ? await ScreenerRemoteSourceService.refreshOne(source)
      : 'error: not found';
    res.json(
      createResponse({ success: true, data: { id, status, ...(await snapshot()) } })
    );
  } catch (err) {
    next(err);
  }
});

const UpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    trust: Trust.optional(),
    refreshHours: z.number().int().min(1).max(720).optional(),
    name: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
router.patch('/sources/:id', async (req, res, next) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) return next(badRequest('Nothing valid to update.'));
  try {
    await ScreenerStore.updateSource(req.params.id, parsed.data);
    res.json(createResponse({ success: true, data: await snapshot() }));
  } catch (err) {
    next(err);
  }
});

// Remove a source, or empty it with ?action=clear.
router.delete('/sources/:id', async (req, res, next) => {
  try {
    if (req.query.action === 'clear') {
      const removed = await ScreenerStore.clearSource(req.params.id);
      res.json(
        createResponse({ success: true, data: { removed, ...(await snapshot()) } })
      );
      return;
    }
    const ok = await ScreenerStore.removeSource(req.params.id);
    if (!ok) return next(badRequest('The local source cannot be removed.'));
    res.json(createResponse({ success: true, data: await snapshot() }));
  } catch (err) {
    next(err);
  }
});

// Re-fetch a remote source now.
router.post('/sources/:id/refresh', async (req, res, next) => {
  try {
    const source = (await ScreenerStore.getSources()).find(
      (s: ScreenerSource) => s.id === req.params.id
    );
    if (!source || source.kind !== 'remote') {
      return next(badRequest('Not a remote source.'));
    }
    const status = await ScreenerRemoteSourceService.refreshOne(source);
    res.json(
      createResponse({ success: true, data: { status, ...(await snapshot()) } })
    );
  } catch (err) {
    next(err);
  }
});

// Import an NDJSON list (native or davex format), merged into local or kept
// as its own removable source.
const ImportSchema = z.object({
  content: z.string().min(1).max(16 * 1024 * 1024),
  target: z.enum(['merge', 'separate']).default('separate'),
  name: z.string().trim().optional(),
  trust: Trust.optional(),
});
router.post('/import', async (req, res, next) => {
  const parsed = ImportSchema.safeParse(req.body);
  if (!parsed.success) return next(badRequest('Import content is required.'));
  const { content, target, name, trust } = parsed.data;
  try {
    const { records, invalid } = parseNdjson(content);
    if (records.length === 0) {
      return next(badRequest('No valid entries found in the import.'));
    }
    let added: number;
    if (target === 'merge') {
      added = await ScreenerStore.bulkUpsert('local', records);
    } else {
      const id = await ScreenerStore.addSource(
        'imported',
        name || 'Imported list',
        null,
        trust ?? 'corroborate',
        24
      );
      try {
        added = await ScreenerStore.bulkUpsert(id, records, { replace: true });
        await ScreenerStore.setSourceStatus(
          id,
          null,
          nowSec(),
          nowSec(),
          `imported ${added}`
        );
      } catch (err) {
        // Don't leave an empty orphaned source behind if the import write fails.
        await ScreenerStore.removeSource(id).catch(() => {});
        throw err;
      }
    }
    res.json(
      createResponse({
        success: true,
        data: { added, invalid, ...(await snapshot()) },
      })
    );
  } catch (err) {
    next(err);
  }
});

// Export as NDJSON. scope=local|all, format=native|davex, dedup=1.
router.get('/export', async (req, res, next) => {
  try {
    const scope = req.query.scope === 'all' ? 'all' : 'local';
    const format = req.query.format === 'davex' ? 'davex' : 'native';
    const dedup = req.query.dedup !== '0';
    const ids =
      scope === 'all'
        ? (await ScreenerStore.getSources()).map((s) => s.id)
        : ['local'];
    const records = await ScreenerStore.getEntries(ids, dedup);
    const body =
      format === 'davex'
        ? toDavexNdjson(records, nowSec())
        : toNdjson(records, nowSec());
    res.type('application/x-ndjson');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="screener.${format === 'davex' ? 'warden.' : ''}ndjson"`
    );
    res.send(body);
  } catch (err) {
    next(err);
  }
});

// Manually contribute a verdict for a release key.
const MarkSchema = z.object({
  key: z.string(),
  verdict: Verdict,
  backbones: z.array(z.string()).optional(),
});
router.post('/mark', async (req, res, next) => {
  const parsed = MarkSchema.safeParse(req.body);
  if (!parsed.success || !isValidKey(parsed.data.key)) {
    return next(badRequest('A valid release key and verdict are required.'));
  }
  try {
    await ScreenerStore.markVerdict(
      parsed.data.key,
      parsed.data.verdict,
      parsed.data.backbones ?? []
    );
    res.json(createResponse({ success: true, data: await snapshot() }));
  } catch (err) {
    next(err);
  }
});

export default router;
