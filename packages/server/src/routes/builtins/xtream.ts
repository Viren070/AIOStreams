import { Router, Request, Response, NextFunction } from 'express';
import {
  APIError,
  constants,
  fromUrlSafeBase64,
  testXtreamLogin,
  XtreamAddon,
  XtreamError,
} from '@aiostreams/core';
import { z } from 'zod';
import { rawExtras } from '../../utils/extras.js';
import { createResponse } from '../../utils/responses.js';
import { requireSessionIfAuthRequired } from '../../middlewares/auth.js';
import { userApiRateLimiter } from '../../middlewares/ratelimit.js';

const router: Router = Router();

interface Params {
  encodedConfig: string;
  type: string;
  id: string;
}

const addonOf = (encodedConfig: string) =>
  new XtreamAddon(JSON.parse(fromUrlSafeBase64(encodedConfig)));

/** The provider's failures as the provider's, not as this server's. */
const failure = (error: unknown) =>
  error instanceof XtreamError
    ? new APIError(constants.ErrorCode.UPSTREAM_ERROR, 502, error.message)
    : error;

const LoginSchema = z.object({
  server: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});

/** `POST /test` for the configure page, which a browser reaches past `internalMiddleware`. */
router.post(
  '/test',
  requireSessionIfAuthRequired,
  userApiRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    const login = LoginSchema.safeParse(req.body ?? {});
    if (!login.success) {
      res.status(400).json(
        createResponse({
          success: false,
          detail: 'The server, username and password are all needed to test',
        })
      );
      return;
    }
    try {
      res.json(
        createResponse({
          success: true,
          data: await testXtreamLogin(login.data),
        })
      );
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:encodedConfig/manifest.json',
  async (
    req: Request<Pick<Params, 'encodedConfig'>>,
    res: Response,
    next: NextFunction
  ) => {
    try {
      res.json(await addonOf(req.params.encodedConfig).getManifest());
    } catch (error) {
      next(failure(error));
    }
  }
);

router.get(
  '/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (
    req: Request<Params & { extras?: string }>,
    res: Response,
    next: NextFunction
  ) => {
    const { encodedConfig, type, id } = req.params;
    try {
      res.json(
        await addonOf(encodedConfig).getCatalog(type, id, rawExtras(req))
      );
    } catch (error) {
      next(failure(error));
    }
  }
);

router.get(
  '/:encodedConfig/meta/:type/:id.json',
  async (req: Request<Params>, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;
    try {
      res.json({ meta: await addonOf(encodedConfig).getMeta(type, id) });
    } catch (error) {
      next(failure(error));
    }
  }
);

router.get(
  '/:encodedConfig/stream/:type/:id.json',
  async (req: Request<Params>, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;
    try {
      res.json({
        streams: await addonOf(encodedConfig).getStreams(type, id),
      });
    } catch (error) {
      next(failure(error));
    }
  }
);

export default router;
