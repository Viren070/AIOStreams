import { NextFunction, Request, Response, Router } from 'express';
import {
  createLogger,
  openNativeUsenetStream,
  DebridError,
} from '@aiostreams/core';
import { mapDebridErrorToStaticFile } from '../../utils/static-errors.js';
import { serveRangeStream } from '../../utils/range-stream.js';
import { corsMiddleware } from '../../middlewares/cors.js';

const logger = createLogger('server:usenet');
const router: Router = Router();

router.use(corsMiddleware);

/**
 * Byte-serving endpoint for native usenet streams. The token is an encrypted
 * capability minted by `NativeUsenetService.resolve` (which already validated
 * the user's `aiostreamsAuth`), so no additional auth is required here. Serves
 * HTTP Range requests directly from the NNTP engine — never via the builtin
 * proxy.
 */
router.get(
  '/stream/:token{/:filename}',
  async (req: Request, res: Response, next: NextFunction) => {
    const token = String(req.params.token);
    const download = req.query.download !== undefined;
    try {
      await serveRangeStream(req, res, {
        open: (range, signal) =>
          openNativeUsenetStream({
            token,
            start: range?.start,
            end: range?.endExclusive,
            suffixLength: range?.suffixLength,
            signal,
            clientIp: req.requestIp || req.ip || req.socket.remoteAddress,
          }),
        disposition: download ? 'attachment' : 'inline',
      });
    } catch (err) {
      if (err instanceof DebridError) {
        logger.warn({ err }, 'usenet stream failed before any bytes were sent');
        if (download) {
          res.status(err.statusCode || 502).json({
            success: false,
            detail: err.message,
          });
        } else {
          res.redirect(302, `/static/${mapDebridErrorToStaticFile(err.code)}`);
        }
        return;
      }
      next(err);
    }
  }
);

export default router;
