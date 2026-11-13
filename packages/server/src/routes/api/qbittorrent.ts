import { NextFunction, Request, Response, Router } from 'express';
import {
  createLogger,
  DebridError,
  FeatureControl,
  openQbittorrentStream,
  testQbittorrentConnection,
} from '@aiostreams/core';
import { z } from 'zod';
import { mapDebridErrorToStaticFile } from '../../utils/static-errors.js';
import { serveRangeStream } from '../../utils/range-stream.js';
import { corsMiddleware } from '../../middlewares/cors.js';
import { requireSessionIfAuthRequired } from '../../middlewares/auth.js';
import { userApiRateLimiter } from '../../middlewares/ratelimit.js';
import { createResponse } from '../../utils/responses.js';

const logger = createLogger('server:qbittorrent');
const router: Router = Router();

router.use(corsMiddleware);

const TestRequestSchema = z.object({
  url: z.string().min(1),
  username: z.string().min(1),
  password: z.string(),
});

/**
 * `POST /api/v1/qbittorrent/test` for the config UI's test button. Probe
 * only, log in to the WebUI with the supplied credentials and report back.
 */
router.post(
  '/test',
  requireSessionIfAuthRequired,
  userApiRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // The probe follows the instance's feature gate: a disabled or
      // not-yet-opted-in service must not offer an outbound request probe.
      const disabled = FeatureControl.disabledServices.get('qbittorrent');
      if (disabled) {
        res.status(403).json(
          createResponse({ success: false, detail: disabled })
        );
        return;
      }
      const body = TestRequestSchema.parse(req.body ?? {});
      const result = await testQbittorrentConnection(body);
      logger.debug(
        { ok: result.ok, stage: result.stage },
        'completed qbittorrent connection test'
      );
      res.json(createResponse({ success: true, data: result }));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Byte-serving endpoint for qBittorrent streams. The token is an encrypted
 * capability minted by resolve, an opaque reference to a server-side entry
 * (credential, torrent, selected file), so no extra auth is needed. Serves
 * range requests straight from the file, gated against the torrent's piece
 * states.
 */
router.get(
  '/stream/:token{/:filename}',
  async (req: Request, res: Response, next: NextFunction) => {
    const token = String(req.params.token);
    const download = req.query.download !== undefined;
    try {
      await serveRangeStream(req, res, {
        open: (range, signal) =>
          openQbittorrentStream({
            token,
            range,
            signal,
          }),
        disposition: download ? 'attachment' : 'inline',
      });
    } catch (err) {
      if (err instanceof DebridError) {
        if (res.headersSent) {
          // Bytes are already on the wire, the only honest answer is to
          // drop the connection, not to write a second response.
          res.destroy();
          return;
        }
        logger.warn(
          { err },
          'qbittorrent stream failed before any bytes were sent'
        );
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
