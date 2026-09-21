import { Router, Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import {
  CommunityFederation,
  CommunityService,
  createLogger,
  formatZodError,
  type CommunityKind,
  type CommunityStatus,
} from '@aiostreams/core';
import { createResponse } from '../../../utils/responses.js';

const router: Router = Router();
const logger = createLogger('dashboard:community');

const KINDS: CommunityKind[] = ['formatter', 'template'];
const STATUSES: CommunityStatus[] = ['pending', 'approved', 'rejected'];

const ReasonSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
const ApproveSchema = z.object({ trusted: z.boolean().optional() });
const TrustedSchema = z.object({ trusted: z.boolean() });
const BlockSchema = z.object({
  itemId: z.string().min(1),
  kind: z.enum(['owner', 'ip']),
  reason: z.string().trim().max(500).optional(),
});

function username(req: { user?: { username?: string } }): string {
  return req.user?.username ?? 'admin';
}

function id(req: Request): string {
  const value = req.params.id;
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function badRequest(res: Response, message: string) {
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

function handle(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await fn(req);
      res.status(200).json(createResponse({ success: true, data }));
    } catch (err) {
      if (err instanceof ZodError) {
        badRequest(res, zodMessage(err));
        return;
      }
      next(err);
    }
  };
}

// GET /dashboard/community/items?kind&status&search&pending&limit&offset
router.get(
  '/items',
  handle(async (req) => {
    const q = req.query as Record<string, unknown>;
    const kind = KINDS.find((k) => k === q.kind);
    const status = STATUSES.find((s) => s === q.status);
    const limit = Number(q.limit);
    const offset = Number(q.offset);
    return CommunityService.list({
      kind,
      status,
      search: typeof q.search === 'string' && q.search ? q.search : undefined,
      pending: q.pending === '1' || q.pending === 'true',
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
    });
  })
);

router.get(
  '/items/:id',
  handle((req) => CommunityService.get(id(req)))
);

router.post(
  '/items/:id/approve',
  handle(async (req) => {
    const { trusted } = ApproveSchema.parse(req.body ?? {});
    const item = await CommunityService.approve(id(req), { trusted });
    logger.info(
      {
        id: item.id,
        kind: item.kind,
        trusted: item.trusted,
        by: username(req),
      },
      'community item approved'
    );
    return item;
  })
);

router.post(
  '/items/:id/reject',
  handle(async (req) => {
    const { reason } = ReasonSchema.parse(req.body);
    const item = await CommunityService.reject(id(req), reason);
    logger.info({ id: item.id, by: username(req) }, 'community item rejected');
    return item;
  })
);

router.post(
  '/items/:id/draft/approve',
  handle(async (req) => {
    const item = await CommunityService.approveDraft(id(req));
    logger.info(
      { id: item.id, version: item.version, by: username(req) },
      'community update approved'
    );
    return item;
  })
);

router.post(
  '/items/:id/draft/reject',
  handle(async (req) => {
    const { reason } = ReasonSchema.parse(req.body);
    return CommunityService.rejectDraft(id(req), reason);
  })
);

router.delete(
  '/items/:id',
  handle(async (req) => {
    const deleted = await CommunityService.remove(id(req));
    if (deleted)
      logger.info({ id: id(req), by: username(req) }, 'community item deleted');
    return { deleted };
  })
);

router.post(
  '/items/:id/trusted',
  handle(async (req) => {
    const { trusted } = TrustedSchema.parse(req.body);
    return CommunityService.setTrusted(id(req), trusted);
  })
);

router.post(
  '/items/:id/reset-likes',
  handle(async (req) => {
    await CommunityService.resetLikes(id(req));
    return { reset: true };
  })
);

router.get(
  '/blocks',
  handle(async () => ({ blocks: await CommunityService.listBlocks() }))
);

router.get(
  '/remote',
  handle(async () => ({ sources: CommunityFederation.sourceStates() }))
);

router.post(
  '/blocks',
  handle(async (req) => {
    const { itemId, kind, reason } = BlockSchema.parse(req.body);
    if (kind === 'owner') await CommunityService.blockOwnerOf(itemId, reason);
    else await CommunityService.blockIpOf(itemId, reason);
    logger.info({ itemId, kind, by: username(req) }, 'community block added');
    return { blocks: await CommunityService.listBlocks() };
  })
);

router.delete(
  '/blocks/:hash',
  handle(async (req) => {
    const value = req.params.hash;
    const hash = Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
    return { removed: await CommunityService.removeBlock(hash) };
  })
);

export default router;
