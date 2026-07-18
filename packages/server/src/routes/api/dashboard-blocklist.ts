import express, { Router } from 'express';
import { z, ZodError } from 'zod';
import {
  config as appConfig,
  createLogger,
  formatZodError,
  ReleaseBlocklistRepository,
  ReleaseBlocklistRemoteService,
  ReleaseBlocklistPublishRepository,
  ReleaseBlocklistPublishService,
  decodeListBody,
  instanceBackbones,
  isUnsafeRemoteUrl,
  isValidReleaseKey,
  normalizeBackbone,
  parseNdjson,
  publicExportEnvLocks,
  savePublicExportSettings,
  splitPublishStatus,
  toNativeNdjson,
  toWardenNdjson,
  applyConfigPatch,
  artifactFilename,
  artifactKey,
  checkArtifactsAgainstCapabilities,
  decodePublishConfig,
  encodePublishConfig,
  getPublishProvider,
  listPublishProviders,
  BLOCKLIST_VERDICTS,
  BLOCKLIST_TRUSTS,
  LOCAL_SOURCE_ID,
  MIN_REFRESH_SECONDS,
  MAX_REFRESH_SECONDS,
  MIN_PUBLISH_INTERVAL_SECONDS,
  MAX_PUBLISH_INTERVAL_SECONDS,
  PUBLISH_FORMATS,
  PUBLISH_SCOPES,
  type BlocklistTrust,
  type BlocklistVerdict,
  type PublishTarget,
  type PublishTargetState,
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

const RemoteSourcesSchema = z.object({
  input: z.string().min(1).max(200_000),
  trust: TrustSchema.optional(),
  refreshSeconds: RefreshSecondsSchema.optional(),
});

const SourceIdsSchema = z
  .object({
    ids: z.array(z.string().trim().min(1)).min(1).max(200),
  })
  .refine((data) => new Set(data.ids).size === data.ids.length, {
    message: 'duplicate IDs are not allowed',
    path: ['ids'],
  });

const PatchSourcesSchema = z
  .object({
    ids: z.array(z.string().trim().min(1)).min(1).max(200),
    name: z.string().trim().min(1).max(120).optional(),
    url: z.string().trim().min(1).max(2000).optional(),
    enabled: z.boolean().optional(),
    trust: TrustSchema.optional(),
    refreshSeconds: RefreshSecondsSchema.optional(),
  })
  .refine((data) => new Set(data.ids).size === data.ids.length, {
    message: 'duplicate IDs are not allowed',
    path: ['ids'],
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.url !== undefined ||
      data.enabled !== undefined ||
      data.trust !== undefined ||
      data.refreshSeconds !== undefined,
    { message: 'at least one field to update must be provided', path: ['ids'] }
  )
  .refine(
    (data) =>
      (data.name === undefined && data.url === undefined) ||
      data.ids.length === 1,
    {
      message: 'name and url can only be set on a single source',
      path: ['ids'],
    }
  );

const PublishIntervalSchema = z
  .number()
  .int()
  .min(MIN_PUBLISH_INTERVAL_SECONDS)
  .max(MAX_PUBLISH_INTERVAL_SECONDS);

const ArtifactSchema = z.object({
  format: z.enum(PUBLISH_FORMATS),
  scope: z.enum(PUBLISH_SCOPES),
  gzip: z.boolean().default(false),
});

const ArtifactsSchema = z
  .array(ArtifactSchema)
  .min(1)
  .max(4)
  .refine(
    (artifacts) =>
      new Set(artifacts.map((a) => `${a.format}:${a.scope}`)).size ===
      artifacts.length,
    'duplicate format/scope artifact'
  );

// Provider-specific config is validated against the registry's schema after
// the provider lookup, so a new provider needs no route changes.
const CreateTargetSchema = z.object({
  provider: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  intervalSeconds: PublishIntervalSchema.optional(),
  enabled: z.boolean().optional(),
  artifacts: ArtifactsSchema,
  config: z.record(z.string(), z.unknown()),
});

const PatchTargetSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  intervalSeconds: PublishIntervalSchema.optional(),
  artifacts: ArtifactsSchema.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

// A release is known by several keys (wd1 fingerprint + nh1 content hash) and
// is marked under all of them, so a batch of releases is an array of key sets.
const MarkSchema = z.object({
  releases: z
    .array(z.array(z.string().trim().min(1)).min(1).max(8))
    .min(1)
    .max(200),
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

function notFound(res: express.Response, message: string) {
  return res.status(404).json(
    createResponse({
      success: false,
      error: { code: 'NOT_FOUND', message },
    })
  );
}

/** Key-order-independent serialization for config change detection. */
function stableJson(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
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

/**
 * Redacted view of a publish target for the SPA: never the config blob or
 * the token - only the provider's summary.
 */
function targetView(target: PublishTarget) {
  const provider = getPublishProvider(target.provider);
  const config = decodePublishConfig(target.configEnc);
  const { status, error } = splitPublishStatus(target.status);
  return {
    id: target.id,
    provider: target.provider,
    providerLabel: provider?.label ?? target.provider,
    name: target.name,
    enabled: target.enabled,
    intervalSeconds: target.intervalSeconds,
    lastPushed: target.lastPushed,
    lastChecked: target.lastChecked,
    status,
    error,
    hasCredential:
      provider && config ? provider.hasCredential(config as never) : false,
    ...(config ? {} : { configUnreadable: true }),
    summary: provider && config ? provider.summarize(config as never) : null,
    artifacts: target.artifacts.map((spec) => {
      const state = target.state[artifactKey(spec)];
      return {
        format: spec.format,
        scope: spec.scope,
        gzip: spec.gzip,
        filename: artifactFilename(spec),
        url: state?.url ?? null,
        pushedAt: state?.pushedAt ?? null,
      };
    }),
  };
}

async function snapshot() {
  const [sources, counts, observed, uniqueCounts, targets] = await Promise.all([
    ReleaseBlocklistRepository.getSources(),
    ReleaseBlocklistRepository.getCounts(),
    ReleaseBlocklistRepository.getDistinctBackbones(),
    ReleaseBlocklistRepository.getSourceUniqueCounts(),
    ReleaseBlocklistPublishRepository.getTargets(),
  ]);
  const settings = appConfig.releaseBlocklist;
  return {
    counts,
    sources: sources.map((s) => ({
      ...s,
      url: s.url ? s.url.replace(/\?.*$/, '?…') : s.url,
      uniqueCount: uniqueCounts.get(s.id) ?? 0,
    })),
    targets: targets.map(targetView),
    providers: listPublishProviders().map((p) => ({
      id: p.id,
      label: p.label,
      capabilities: p.capabilities,
      fields: p.fields,
    })),
    settings: {
      quorum: settings.quorum,
      backboneScope: settings.backboneScope,
      backboneGrouping: settings.backboneGrouping,
      trustedBackbones: settings.trustedBackbones,
      publicExport: settings.publicExport,
      publicExportScope: settings.publicExportScope,
      // The publishing page both edits this and builds the ?key= subscribe
      // URLs from it, so it is served in the clear to the (admin-only)
      // dashboard rather than masked as the generic settings API would.
      publicExportPassword: settings.publicExportPassword,
    },
    publicExportEnv: publicExportEnvLocks(),
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

const PublicExportSettingsSchema = z
  .object({
    publicExport: z.boolean(),
    publicExportScope: z.enum(['local', 'all']),
    publicExportPassword: z.string().trim().max(200),
  })
  .partial();

// PATCH /dashboard/blocklist/settings - the public export fields, which live on
// the publishing page rather than the generic settings page.
router.patch('/settings', async (req, res, next) => {
  try {
    const patch = PublicExportSettingsSchema.parse(req.body ?? {});
    const { updated, requiresRestart, errors } = await savePublicExportSettings(
      patch,
      (req as { user?: { username?: string } }).user?.username ?? 'admin'
    );
    const ok = Object.keys(errors).length === 0;
    res.status(ok ? 200 : 422).json(
      createResponse({
        success: ok,
        data: { updated, requiresRestart, settings: await snapshot() },
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
    if (err instanceof ZodError) {
      return res.status(422).json(
        createResponse({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: formatZodError(err, { singleLine: true }),
          },
        })
      );
    }
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

/** A source name from a list URL: owner/repo on github, else the hostname. */
function deriveSourceName(url: string): string {
  const parsed = new URL(url);
  if (
    parsed.hostname === 'github.com' ||
    parsed.hostname === 'raw.githubusercontent.com'
  ) {
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  }
  if (parsed.hostname === 'gist.githubusercontent.com') {
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length >= 1) return parts[0];
  }
  return parsed.hostname;
}

// POST /dashboard/blocklist/sources/remote - subscribe to one or more list
// URLs, one per line (blank and # lines ignored).
router.post('/sources/remote', async (req, res, next) => {
  try {
    const body = RemoteSourcesSchema.parse(req.body ?? {});
    const urls = [
      ...new Set(
        body.input
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#'))
      ),
    ];
    if (urls.length === 0) return badRequest(res, 'no URLs provided');

    const existing = new Set(
      (await ReleaseBlocklistRepository.getSources()).map((s) => s.url)
    );
    const errors: string[] = [];
    const newIds: string[] = [];
    let skipped = 0;
    for (const url of urls) {
      const urlError = validateListUrl(url);
      if (urlError) {
        errors.push(`${url}: ${urlError}`);
        continue;
      }
      if (existing.has(url)) {
        skipped++;
        continue;
      }
      try {
        const source = await ReleaseBlocklistRepository.addSource({
          kind: 'remote',
          name: deriveSourceName(url),
          url,
          trust: (body.trust ?? 'full') as BlocklistTrust,
          refreshSeconds: body.refreshSeconds,
        });
        newIds.push(source.id);
      } catch (err) {
        errors.push(
          `${url}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // A single subscribe reports its first fetch synchronously; larger
    // imports refresh in the background so the request is not held open.
    if (newIds.length === 1) {
      await ReleaseBlocklistRemoteService.refreshByIds(newIds);
    } else if (newIds.length > 1) {
      void ReleaseBlocklistRemoteService.refreshByIds(newIds).catch((err) =>
        logger.warn(
          `background refresh of new blocklist sources failed: ${err}`
        )
      );
    }

    res.status(200).json(
      createResponse({
        success: true,
        data: {
          ...(await snapshot()),
          import: { added: newIds.length, skipped, errors },
        },
      })
    );
  } catch (err) {
    if (err instanceof ZodError) return badRequest(res, zodMessage(err));
    next(err);
  }
});

// PATCH /dashboard/blocklist/sources - edit one or more sources. name/url are
// single-source only (see PatchSourcesSchema). The local source silently skips
// trust/enabled changes it does not allow.
router.patch('/sources', async (req, res, next) => {
  try {
    const body = PatchSourcesSchema.parse(req.body ?? {});
    if (body.url !== undefined) {
      const urlError = validateListUrl(body.url);
      if (urlError) return badRequest(res, urlError);
    }
    let affected = 0;
    let failed = 0;
    for (const id of body.ids) {
      if (
        id === LOCAL_SOURCE_ID &&
        (body.enabled !== undefined || body.trust !== undefined)
      ) {
        continue;
      }
      try {
        await ReleaseBlocklistRepository.updateSource(id, {
          name: body.name,
          url: body.url,
          enabled: body.enabled,
          trust: body.trust as never,
          refreshSeconds: body.refreshSeconds,
        });
        affected++;
      } catch (err) {
        failed++;
        logger.warn({ id, err }, 'patch source failed');
      }
    }
    res.status(200).json(
      createResponse({
        success: true,
        data: { affected, failed, ...(await snapshot()) },
      })
    );
  } catch (err) {
    if (err instanceof ZodError) return badRequest(res, zodMessage(err));
    next(err);
  }
});

// POST /dashboard/blocklist/sources/remove - remove one or more sources and
// their entries. The local source is always skipped.
router.post('/sources/remove', async (req, res, next) => {
  try {
    const { ids } = SourceIdsSchema.parse(req.body ?? {});
    let affected = 0;
    let failed = 0;
    for (const id of ids) {
      if (id === LOCAL_SOURCE_ID) continue;
      try {
        await ReleaseBlocklistRepository.removeSource(id);
        affected++;
      } catch (err) {
        failed++;
        logger.warn({ id, err }, 'remove source failed');
      }
    }
    res.status(200).json(
      createResponse({
        success: true,
        data: { affected, failed, ...(await snapshot()) },
      })
    );
  } catch (err) {
    if (err instanceof ZodError) return badRequest(res, zodMessage(err));
    next(err);
  }
});

// POST /dashboard/blocklist/sources/clear - drop the entries of one or more
// sources while keeping the sources themselves.
router.post('/sources/clear', async (req, res, next) => {
  try {
    const { ids } = SourceIdsSchema.parse(req.body ?? {});
    let affected = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await ReleaseBlocklistRepository.clearSource(id);
        affected++;
      } catch (err) {
        failed++;
        logger.warn({ id, err }, 'clear source failed');
      }
    }
    res.status(200).json(
      createResponse({
        success: true,
        data: { affected, failed, ...(await snapshot()) },
      })
    );
  } catch (err) {
    if (err instanceof ZodError) return badRequest(res, zodMessage(err));
    next(err);
  }
});

// POST /dashboard/blocklist/sources/refresh - refetch one or more remote
// sources now. Non-remote ids are skipped; concurrency is bounded in the
// service.
router.post('/sources/refresh', async (req, res, next) => {
  try {
    const { ids } = SourceIdsSchema.parse(req.body ?? {});
    const { refreshed, failed } =
      await ReleaseBlocklistRemoteService.refreshByIds(ids);
    res.status(200).json(
      createResponse({
        success: true,
        data: { affected: refreshed, failed, ...(await snapshot()) },
      })
    );
  } catch (err) {
    if (err instanceof ZodError) return badRequest(res, zodMessage(err));
    next(err);
  }
});

// POST /dashboard/blocklist/targets - add a publish target. Provider config
// is validated by the provider itself (may verify the token remotely).
router.post('/targets', async (req, res, next) => {
  try {
    const body = CreateTargetSchema.parse(req.body ?? {});
    const provider = getPublishProvider(body.provider);
    if (!provider) {
      return badRequest(res, `unknown provider "${body.provider}"`);
    }
    const capabilityProblem = checkArtifactsAgainstCapabilities(
      provider,
      body.artifacts
    );
    if (capabilityProblem) return badRequest(res, capabilityProblem);
    let config: Record<string, unknown>;
    try {
      config = (await provider.validateConfig(
        provider.configSchema.parse(body.config)
      )) as Record<string, unknown>;
    } catch (err) {
      return badRequest(res, zodMessage(err));
    }
    await ReleaseBlocklistPublishRepository.addTarget({
      provider: provider.id,
      name: body.name,
      configEnc: encodePublishConfig(config),
      artifacts: body.artifacts,
      intervalSeconds: body.intervalSeconds,
      enabled: body.enabled,
    });
    res
      .status(200)
      .json(createResponse({ success: true, data: await snapshot() }));
  } catch (err) {
    if (err instanceof ZodError) return badRequest(res, zodMessage(err));
    next(err);
  }
});

// PATCH /dashboard/blocklist/targets/:id - edit a publish target. The
// provider is immutable (delete and recreate to change it). Blank
// credential fields keep the stored values; a changed config resets the
// per-artifact push state so the next run pushes to the new destination.
router.patch('/targets/:id', async (req, res, next) => {
  try {
    const target = await ReleaseBlocklistPublishRepository.getTarget(
      req.params.id
    );
    if (!target) return notFound(res, 'no such publish target');
    const body = PatchTargetSchema.parse(req.body ?? {});
    const provider = getPublishProvider(target.provider);
    if (!provider) {
      return badRequest(res, `unknown provider "${target.provider}"`);
    }
    if (body.artifacts !== undefined) {
      const capabilityProblem = checkArtifactsAgainstCapabilities(
        provider,
        body.artifacts
      );
      if (capabilityProblem) return badRequest(res, capabilityProblem);
    }

    const fields: Parameters<
      typeof ReleaseBlocklistPublishRepository.updateTarget
    >[1] = {
      name: body.name,
      enabled: body.enabled,
      intervalSeconds: body.intervalSeconds,
      artifacts: body.artifacts,
    };

    let configChanged = false;
    if (body.config !== undefined) {
      const current = decodePublishConfig(target.configEnc);
      let validated: Record<string, unknown>;
      try {
        let merged: Record<string, unknown>;
        if (!current) {
          // SECRET_KEY rotation recovery: only a complete config can
          // replace an undecryptable blob.
          const full = provider.configSchema.safeParse(body.config);
          if (!full.success) {
            return badRequest(
              res,
              'stored config cannot be decrypted; re-enter the full configuration'
            );
          }
          merged = full.data as Record<string, unknown>;
        } else {
          merged = applyConfigPatch(
            current,
            provider.configPatchSchema.parse(body.config) as Record<
              string,
              unknown
            >
          );
        }
        validated = (await provider.validateConfig(
          provider.configSchema.parse(merged)
        )) as Record<string, unknown>;
      } catch (err) {
        return badRequest(res, zodMessage(err));
      }
      configChanged = !current || stableJson(validated) !== stableJson(current);
      fields.configEnc = encodePublishConfig(validated);
    }

    if (configChanged) {
      fields.state = {};
      fields.status = null;
    } else if (body.artifacts !== undefined) {
      // Keep push state only for artifacts that survive unchanged; a gzip
      // toggle changes the remote filename without changing the pre-gzip
      // hash, so it must force a re-push.
      const oldByKey = new Map(
        target.artifacts.map((a) => [artifactKey(a), a])
      );
      const state: PublishTargetState = {};
      for (const spec of body.artifacts) {
        const key = artifactKey(spec);
        const old = oldByKey.get(key);
        const entry = target.state[key];
        if (old && entry && old.gzip === spec.gzip) state[key] = entry;
      }
      fields.state = state;
    }

    await ReleaseBlocklistPublishRepository.updateTarget(target.id, fields);
    res
      .status(200)
      .json(createResponse({ success: true, data: await snapshot() }));
  } catch (err) {
    if (err instanceof ZodError) return badRequest(res, zodMessage(err));
    next(err);
  }
});

// DELETE /dashboard/blocklist/targets/:id - remove a publish target.
router.delete('/targets/:id', async (req, res, next) => {
  try {
    await ReleaseBlocklistPublishRepository.removeTarget(req.params.id);
    res
      .status(200)
      .json(createResponse({ success: true, data: await snapshot() }));
  } catch (err) {
    next(err);
  }
});

// POST /dashboard/blocklist/targets/:id/publish - push now (bypasses the
// unchanged-content skip).
router.post('/targets/:id/publish', async (req, res, next) => {
  try {
    const target = await ReleaseBlocklistPublishRepository.getTarget(
      req.params.id
    );
    if (!target) return notFound(res, 'no such publish target');
    await ReleaseBlocklistPublishService.publishOne(target, { force: true });
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

// POST /dashboard/blocklist/mark - manual local verdict for one or more
// releases, each marked under every key it is known by.
router.post('/mark', async (req, res, next) => {
  try {
    const body = MarkSchema.parse(req.body ?? {});
    const keys = [...new Set(body.releases.flat())];
    if (!keys.every((k) => isValidReleaseKey(k))) {
      return badRequest(
        res,
        'keys must be btih:<infohash>, wd1:<fingerprint> or nh1:<content hash> release keys'
      );
    }
    for (const key of keys) {
      await ReleaseBlocklistRepository.markVerdict(
        key,
        body.verdict,
        body.backbones ?? []
      );
    }
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
