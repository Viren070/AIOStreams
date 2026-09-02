import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  APIError,
  constants,
  createLogger,
  LinkedAccountService,
  listPlatforms,
  UserRepository,
} from '@aiostreams/core';
import { createResponse } from '../../utils/responses.js';
import { resolveConfigCredentials } from '../../utils/basic-auth.js';

const router: Router = Router();
const logger = createLogger('server');

const ManifestUrls = z.array(z.url()).min(1).max(8);

const LinkSchema = z.object({
  platform: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
  manifestUrls: ManifestUrls,
  label: z.string().max(64).optional(),
});

const UpdateSchema = z.object({
  label: z.string().max(64).optional(),
  autoPush: z.boolean().optional(),
  manifestUrls: ManifestUrls.optional(),
});

const ProbeSchema = z.object({
  platform: z.string().min(1),
  instanceUrl: z.string().max(2048).optional(),
});

/**
 * Every route is scoped to a configuration the caller can already open, so a
 * linked account is never reachable by anyone who could not read the config
 * it belongs to.
 */
async function authenticate(req: Request, res: Response): Promise<string> {
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
  await UserRepository.verifyUser(uuid, creds.password);
  return uuid;
}

function handle(
  fn: (req: Request, uuid: string) => Promise<unknown>
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req, res, next) => {
    try {
      const uuid = await authenticate(req, res);
      const data = await fn(req, uuid);
      res.status(200).json(createResponse({ success: true, data }));
    } catch (error) {
      if (error instanceof APIError) {
        next(error);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Linked account request failed: ${message}`);
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

router.get(
  '/platforms',
  handle(async () => listPlatforms())
);

router.get(
  '/',
  handle(async (_req, uuid) => LinkedAccountService.list(uuid))
);

router.post(
  '/probe',
  handle(async (req) => {
    const { platform, instanceUrl } = parse(ProbeSchema, req.body);
    return LinkedAccountService.probe(platform, { instanceUrl });
  })
);

router.post(
  '/',
  handle(async (req, uuid) => {
    const body = parse(LinkSchema, req.body);
    return LinkedAccountService.link(
      uuid,
      body.platform,
      body.input,
      body.manifestUrls,
      body.label
    );
  })
);

router.patch(
  '/:id',
  handle(async (req, uuid) =>
    LinkedAccountService.update(uuid, id(req), parse(UpdateSchema, req.body))
  )
);

router.delete(
  '/:id',
  handle(async (req, uuid) => {
    await LinkedAccountService.unlink(uuid, id(req));
    return { unlinked: true };
  })
);

router.post(
  '/:id/push',
  handle(async (req, uuid) => LinkedAccountService.push(uuid, id(req)))
);

router.post(
  '/push',
  handle(async (_req, uuid) => LinkedAccountService.pushAll(uuid))
);

export default router;
