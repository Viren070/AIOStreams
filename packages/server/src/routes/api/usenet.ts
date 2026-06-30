import { NextFunction, Request, Response, Router } from 'express';
import { corsMiddleware } from '../../middlewares/cors.js';
import { serveUsenetStreamToken } from '../../utils/serve-usenet.js';

const router: Router = Router();

router.use(corsMiddleware);

/**
 * Byte-serving endpoint for native usenet streams. The token is an encrypted
 * capability minted by `NativeUsenetService.resolve` (which already validated
 * the user's `aiostreamsAuth`), so no additional auth is required here. Serves
 * HTTP Range requests directly from the NNTP engine — never via the builtin
 * proxy. The Range/206/HEAD/conditional-GET logic is shared with the WebDAV
 * server via {@link serveUsenetStreamToken}.
 */
router.get(
  '/stream/:token{/:filename}',
  async (req: Request, res: Response, next: NextFunction) => {
    await serveUsenetStreamToken(req, res, next, {
      token: String(req.params.token),
      asAttachment: req.query.download !== undefined,
    });
  }
);

export default router;
