import express, { Router } from 'express';
import { z, ZodError } from 'zod';
import {
  config as appConfig,
  createLogger,
  formatZodError,
  ReleaseBlocklistRepository,
  ReleaseBlocklistRemoteService,
  decodeListBody,
  instanceBackbones,
  isUnsafeRemoteUrl,
  isValidReleaseKey,
  normalizeBackbone,
  parseNdjson,
  toNativeNdjson,
  toWardenNdjson,
  BLOCKLIST_VERDICTS,
  BLOCKLIST_TRUSTS,
  LOCAL_SOURCE_ID,
  MIN_REFRESH_SECONDS,
  MAX_REFRESH_SECONDS,
  type BlocklistVerdict,
  type ReleaseKeyKind,
} from '@aiostreams/core';
import { createResponse } from '../../utils/responses.js';

const router: Router = Router();
const logger = createLogger('dashboard:blocklist');

const IMPORT_BODY_LIMIT = '64mb';

const VerdictSchema = z.enum(
  BLOCKLIST_VERDICTS as [BlocklistVerdict, ...BlocklistVerdict[]]
);
const TrustSchema = z.enum(BLOCKLIST_TRUSTS as [string, ...string[]]);
const RefreshSecondsSchema = z
  .number()
  .int()
  .min(MIN_REFRESH_SECONDS)
  .max(MAX_REFRESH_SECONDS);

const RemoteSourceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  url: z.string().trim().min(1).max(2000),
  trust: TrustSchema.optional(),
  refreshSeconds: RefreshSecondsSchema.optional(),
});

const PatchSourceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  url: z.string().trim().min(1).max(2000).optional(),
  enabled: z.boolean().optional(),
  trust: TrustSchema.optional(),
  refreshSeconds: RefreshSecondsSchema.optional(),
});

const MarkSchema = z.object({
  key: z.string().trim().min(1),
  verdict: VerdictSchema,
  backbones: z.array(z.string().trim().min(1)).max(50).optional(),
});

const KeySchema = z.object({ key: z.string().trim().min(1) });

function badRequest(res: express.Response, message: string) {
  return res.status(400).json(
    createResponse({
      success: false,
      error: { code: 'BAD_REQUEST', message },
    })
  );
}

function zodMessage(err: unknown): string {
  return err instanceof ZodError
    ? formatZodError(err, { singleLine: true })
    : err instanceof Error
      ? err.message
      : String(err);
}

/** Rejects URLs with embedded credentials on top of the SSRF guard. */
function validateListUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      return 'URLs with embedded credentials are not allowed';
    }
  } catch {
    return 'invalid URL';
  }
  if (isUnsafeRemoteUrl(url)) {
    return 'URL refused (must be http(s) and not a private address)';
  }
  return null;
}

async function snapshot() {
  const [sources, counts, observed] = await Promise.all([
    ReleaseBlocklistRepository.getSources(),
    ReleaseBlocklistRepository.getCounts(),
    ReleaseBlocklistRepository.getDistinctBackbones(),
  ]);
  const settings = appConfig.releaseBlocklist;
  return {
    counts,
    sources: sources.map((s) => ({
      ...s,
      url: s.url ? s.url.replace(/\?.*$/, '?…') : s.url,
    })),
    settings: {
      quorum: settings.quorum,
      backboneScope: settings.backboneScope,
      backboneGrouping: settings.backboneGrouping,
      trustedBackbones: settings.trustedBackbones,
      publicExport: settings.publicExport,
      publicExportScope: settings.publicExportScope,
      publicExportPassword: settings.publicExport
        ? settings.publicExportPassword
        : '',
    },
    backbones: {
      mine: instanceBackbones(),
      observed,
    },
  };
}

// GET /dashboard/blocklist - full snapshot for the dashboard page.
router.get('/', async (_req, res, next) => {
  try {
    res
      .status(200)
      .json(createResponse({ success: true, data: await snapshot() }));
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/blocklist/entries - paged combined browser.
router.get('/entries', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(req.query.pageSize) || 25)
    );
    const verdict = String(req.query.verdict ?? '');
    const kind = String(req.query.kind ?? '');
    const result = await ReleaseBlocklistRepository.listEntries({
      search:
        typeof req.query.search === 'string' && req.query.search.trim()
          ? req.query.search.trim()
          : undefined,
      sourceId:
        typeof req.query.source === 'string' && req.query.source
          ? req.query.source
          : undefined,
      verdict: (BLOCKLIST_VERDICTS as readonly string[]).includes(verdict)
        ? (verdict as BlocklistVerdict)
        : undefined,
      kind:
        kind === 'torrent' || kind === 'usenet'
          ? (kind as ReleaseKeyKind)
          : undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const grouping = appConfig.releaseBlocklist.backboneGrouping;
    const entries = result.entries.map((entry) => ({
      ...entry,
      backbones: [
        ...new Set(
          entry.sources
            .flatMap((s) => s.backbones)
            .map((b) => normalizeBackbone(b, grouping))
            .filter((b) => b !== 'unknown')
        ),
      ],
    }));
    res.status(200).json(
      createResponse({
        success: true,
        data: { entries, total: result.total, page, pageSize },
      })
    );
  } catch (err) {
    next(err);
  }
});

// POST /dashboard/blocklist/sources/remote - subscribe to a list URL.
router.post('/sources/remote', async (req, res, next) => {
  try {
    const body = RemoteSourceSchema.parse(req.body ?? {});
    const urlError = validateListUrl(body.url);
    if (urlError) return badRequest(res, urlError);
    const source = await ReleaseBlocklistRepository.addSource({
      kind: 'remote',
      name: body.name ?? new URL(body.url).hostname,
      url: body.url,
      trust: (body.trust ?? 'full') as never,
      refreshSeconds: body.refreshSeconds,
    });
    await ReleaseBlocklistRemoteService.refreshByIds([source.id]);
    res
      .status(200)
      .json(createResponse({ success: true, data: await snapshot() }));
  } catch (err) {
    if (err instanceof ZodError) return badRequest(res, zodMessage(err));
    next(err);
  }
});

// PATCH /dashboard/blocklist/sources/:id - edit a source.
router.patch('/sources/:id', async (req, res, next) => {
  try {
    const body = PatchSourceSchema.parse(req.body ?? {});
    if (body.url !== undefined) {
      const urlError = validateListUrl(body.url);
      if (urlError) return badRequest(res, urlError);
    }
    await ReleaseBlocklistRepository.updateSource(req.params.id, {
      name: body.name,
      url: body.url,
      enabled: body.enabled,
      trust: body.trust as never,
      refreshSeconds: body.refreshSeconds,
    });
    res
      .status(200)
      .json(createResponse({ success: true, data: await snapshot() }));
  } catch (err) {
    if (err instanceof ZodError) return badRequest(res, zodMessage(err));
    if (err instanceof Error && /local source/.test(err.message)) {
      return badRequest(res, err.message);
    }
    next(err);
  }
});

// DELETE /dashboard/blocklist/sources/:id - remove a source and its entries.
router.delete('/sources/:id', async (req, res, next) => {
  try {
    await ReleaseBlocklistRepository.removeSource(req.params.id);
    res
      .status(200)
      .json(createResponse({ success: true, data: await snapshot() }));
  } catch (err) {
    if (err instanceof Error && /local source/.test(err.message)) {
      return badRequest(res, err.message);
    }
    next(err);
  }
});

// POST /dashboard/blocklist/sources/:id/clear - drop a source's entries.
router.post('/sources/:id/clear', async (req, res, next) => {
  try {
    await ReleaseBlocklistRepository.clearSource(req.params.id);
    res
      .status(200)
      .json(createResponse({ success: true, data: await snapshot() }));
  } catch (err) {
    next(err);
  }
});

// POST /dashboard/blocklist/sources/:id/refresh - refetch now.
router.post('/sources/:id/refresh', async (req, res, next) => {
  try {
    await ReleaseBlocklistRemoteService.refreshByIds([req.params.id]);
    res
      .status(200)
      .json(createResponse({ success: true, data: await snapshot() }));
  } catch (err) {
    next(err);
  }
});

// POST /dashboard/blocklist/import?name=&trust= - upload a list file/text.
// Accepts the raw file bytes (plain or gzipped NDJSON, either dialect) or a
// JSON body { content }. Always lands in a NEW imported source, never local.
router.post(
  '/import',
  express.raw({
    type: ['application/octet-stream', 'application/gzip', 'text/*'],
    limit: IMPORT_BODY_LIMIT,
  }),
  async (req, res, next) => {
    try {
      let text: string;
      if (Buffer.isBuffer(req.body)) {
        text = decodeListBody(req.body);
      } else if (
        typeof (req.body as { content?: unknown })?.content === 'string'
      ) {
        text = (req.body as { content: string }).content;
      } else {
        return badRequest(res, 'expected list content');
      }
      const { records, invalid } = parseNdjson(text);
      if (records.length === 0) {
        return badRequest(res, 'the list contained no valid records');
      }
      const trust = String(req.query.trust ?? 'full');
      const source = await ReleaseBlocklistRepository.addSource({
        kind: 'imported',
        name:
          typeof req.query.name === 'string' && req.query.name.trim()
            ? req.query.name.trim().slice(0, 120)
            : `Import ${new Date().toISOString().slice(0, 10)}`,
        trust: ((BLOCKLIST_TRUSTS as readonly string[]).includes(trust)
          ? trust
          : 'full') as never,
      });
      const stored = await ReleaseBlocklistRepository.bulkReplace(
        source.id,
        records
      );
      await ReleaseBlocklistRepository.setSourceStatus(source.id, {
        status: `imported (${stored} entries${invalid ? `, ${invalid} invalid lines skipped` : ''})`,
        lastUpdated: Math.floor(Date.now() / 1000),
      });
      logger.info(
        `imported blocklist source "${source.name}": ${stored} entries`
      );
      res
        .status(200)
        .json(createResponse({ success: true, data: await snapshot() }));
    } catch (err) {
      next(err);
    }
  }
);

// GET /dashboard/blocklist/export?format=native|warden&scope=local|all
router.get('/export', async (req, res, next) => {
  try {
    const format = req.query.format === 'warden' ? 'warden' : 'native';
    const scope = req.query.scope === 'all' ? 'all' : 'local';
    const records = await ReleaseBlocklistRepository.getEntries(
      scope === 'local' ? [LOCAL_SOURCE_ID] : undefined,
      scope === 'all'
    );
    const body =
      format === 'warden' ? toWardenNdjson(records) : toNativeNdjson(records);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="blocklist-${scope}${format === 'warden' ? '-warden' : ''}.ndjson"`
    );
    res.status(200).send(body);
  } catch (err) {
    next(err);
  }
});

// POST /dashboard/blocklist/mark - manual local verdict.
router.post('/mark', async (req, res, next) => {
  try {
    const body = MarkSchema.parse(req.body ?? {});
    if (!isValidReleaseKey(body.key)) {
      return badRequest(
        res,
        'key must be a btih:<infohash> or wd1:<fingerprint> release key'
      );
    }
    await ReleaseBlocklistRepository.markVerdict(
      body.key,
      body.verdict,
      body.backbones ?? []
    );
    res
      .status(200)
      .json(createResponse({ success: true, data: await snapshot() }));
  } catch (err) {
    if (err instanceof ZodError) return badRequest(res, zodMessage(err));
    next(err);
  }
});

// DELETE /dashboard/blocklist/entries?key=… - remove this instance's own
// verdict for a release. No override: use unmark to also suppress remote
// verdicts.
router.delete('/entries', async (req, res, next) => {
  try {
    const key = typeof req.query.key === 'string' ? req.query.key : '';
    if (!isValidReleaseKey(key)) {
      return badRequest(res, 'invalid release key');
    }
    await ReleaseBlocklistRepository.deleteLocalEntry(key);
    res
      .status(200)
      .json(createResponse({ success: true, data: await snapshot() }));
  } catch (err) {
    next(err);
  }
});

// POST /dashboard/blocklist/unmark - allow a release on this instance:
// deletes any local verdict and writes an override suppressing remote ones.
router.post('/unmark', async (req, res, next) => {
  try {
    const body = KeySchema.parse(req.body ?? {});
    if (!isValidReleaseKey(body.key)) {
      return badRequest(res, 'invalid release key');
    }
    await ReleaseBlocklistRepository.retract(body.key);
    res
      .status(200)
      .json(createResponse({ success: true, data: await snapshot() }));
  } catch (err) {
    if (err instanceof ZodError) return badRequest(res, zodMessage(err));
    next(err);
  }
});

// GET /dashboard/blocklist/overrides - paged override list.
router.get('/overrides', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(req.query.pageSize) || 25)
    );
    const result = await ReleaseBlocklistRepository.listOverrides(
      pageSize,
      (page - 1) * pageSize
    );
    res.status(200).json(
      createResponse({
        success: true,
        data: { ...result, page, pageSize },
      })
    );
  } catch (err) {
    next(err);
  }
});

// DELETE /dashboard/blocklist/overrides?key=… - clear one (or all) overrides.
router.delete('/overrides', async (req, res, next) => {
  try {
    if (typeof req.query.key === 'string' && req.query.key) {
      await ReleaseBlocklistRepository.clearOverride(req.query.key);
    } else {
      await ReleaseBlocklistRepository.clearAllOverrides();
    }
    res
      .status(200)
      .json(createResponse({ success: true, data: await snapshot() }));
  } catch (err) {
    next(err);
  }
});

export default router;
