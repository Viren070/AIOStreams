import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ipKeyGenerator } from 'express-rate-limit';
import {
  APIError,
  constants,
  createLogger,
  CommunityService,
  communityIdentity,
  SEMVER_PATTERN,
  MAX_COMMUNITY_TAGS,
  MAX_COMMUNITY_TAG_LENGTH,
  UserRepository,
  type CommunityIdentity,
  type CommunityKind,
} from '@aiostreams/core';
import { createResponse } from '../../utils/responses.js';
import { resolveConfigCredentials } from '../../utils/basic-auth.js';

const router: Router = Router();
const logger = createLogger('server');

const name = z.string().trim().min(1).max(100);
const description = z.string().trim().max(1000);
const author = z.string().trim().min(1).max(20);
const version = z
  .string()
  .max(20)
  .regex(SEMVER_PATTERN, 'Version must be MAJOR.MINOR.PATCH');
const tags = z
  .array(z.string().trim().min(1).max(MAX_COMMUNITY_TAG_LENGTH))
  .max(MAX_COMMUNITY_TAGS)
  .transform((list) => [...new Set(list.map((t) => t.toLowerCase()))]);

const SubmitFormatterSchema = z.object({
  name,
  description: description.default(''),
  author,
  version: version.optional(),
  tags: tags.default([]),
  payload: z.unknown(),
});

// Passthrough: inputs, changelog and the rest are validated by the core schema.
const TemplateMetadataSchema = z
  .object({
    name,
    description: description.default(''),
    author,
    version: version.optional(),
    category: z.string().trim().min(1).max(20).optional(),
    tags: tags.optional(),
  })
  .passthrough();

const SubmitTemplateSchema = z.object({
  template: z.object({ metadata: TemplateMetadataSchema }).passthrough(),
});

const UpdateSchema = z.object({
  name: name.optional(),
  description: description.optional(),
  author: author.optional(),
  version: version.optional(),
  tags: tags.optional(),
  payload: z.unknown().optional(),
  template: z
    .object({ metadata: TemplateMetadataSchema })
    .passthrough()
    .optional(),
});

async function authenticate(
  req: Request,
  res: Response
): Promise<CommunityIdentity> {
  const creds = await resolveConfigCredentials(req, res, {
    allowEncrypted: false,
  });
  if (!creds) {
    throw new APIError(
      constants.ErrorCode.MISSING_REQUIRED_FIELDS,
      undefined,
      'Authorization header (Basic) is required'
    );
  }
  const uuid = req.uuid || creds.uuid;
  const { createdAt } = await UserRepository.verifyUser(uuid, creds.password);
  const ip = req.requestIp || req.ip || '';
  return communityIdentity(uuid, ip ? ipKeyGenerator(ip) : '', createdAt);
}

function handle(
  fn: (req: Request, identity: CommunityIdentity) => Promise<unknown>
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req, res, next) => {
    try {
      const identity = await authenticate(req, res);
      const data = await fn(req, identity);
      res.status(200).json(createResponse({ success: true, data }));
    } catch (error) {
      if (error instanceof APIError) {
        next(error);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: message }, 'community request failed');
      next(
        new APIError(
          constants.ErrorCode.INTERNAL_SERVER_ERROR,
          undefined,
          message
        )
      );
    }
  };
}

/** A template's tags fall back to its single legacy category. */
function templateMeta(metadata: z.infer<typeof TemplateMetadataSchema>) {
  return {
    name: metadata.name,
    description: metadata.description,
    author: metadata.author,
    version: metadata.version,
    tags:
      metadata.tags ??
      (metadata.category ? [metadata.category.toLowerCase()] : []),
  };
}

function id(req: Request): string {
  const value = req.params.id;
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new APIError(
      constants.ErrorCode.MISSING_REQUIRED_FIELDS,
      undefined,
      result.error.issues.map((issue) => issue.message).join('; ')
    );
  }
  return result.data;
}

/** Public listing with an ETag so the SPA can poll cheaply. */
function listRoute(kind: CommunityKind) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const revision = await CommunityService.listRevision();
      const etag = `"community:${kind}:${revision}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'no-cache');
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
      const data = await CommunityService.listPublic(kind);
      res.status(200).json(createResponse({ success: true, data }));
    } catch (error) {
      next(error);
    }
  };
}

router.get('/formatters', listRoute('formatter'));
router.get('/templates', listRoute('template'));

router.post(
  '/formatters',
  handle(async (req, identity) => {
    const body = parse(SubmitFormatterSchema, req.body);
    return CommunityService.submit(
      'formatter',
      {
        name: body.name,
        description: body.description,
        author: body.author,
        version: body.version,
        tags: body.tags,
      },
      body.payload,
      identity
    );
  })
);

router.post(
  '/templates',
  handle(async (req, identity) => {
    const { template } = parse(SubmitTemplateSchema, req.body);
    return CommunityService.submit(
      'template',
      templateMeta(template.metadata),
      template,
      identity
    );
  })
);

router.get(
  '/mine',
  handle(async (_req, identity) => CommunityService.listMine(identity))
);

router.put(
  '/items/:id',
  handle(async (req, identity) => {
    const body = parse(UpdateSchema, req.body);
    // A template revision carries its metadata inside the template itself.
    const meta = body.template
      ? templateMeta(body.template.metadata)
      : {
          name: body.name,
          description: body.description,
          author: body.author,
          version: body.version,
          tags: body.tags,
        };
    return CommunityService.update(
      id(req),
      meta,
      body.template ?? body.payload,
      identity
    );
  })
);

router.delete(
  '/items/:id/draft',
  handle(async (req, identity) =>
    CommunityService.withdrawDraft(id(req), identity)
  )
);

router.delete(
  '/items/:id',
  handle(async (req, identity) => {
    await CommunityService.removeOwn(id(req), identity);
    return { deleted: true };
  })
);

router.post(
  '/items/:id/like',
  handle(async (req, identity) =>
    CommunityService.toggleLike(id(req), identity)
  )
);

export default router;
