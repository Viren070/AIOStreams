import { NextFunction, Request, Response, Router } from 'express';
import {
  createLogger,
  DebridError,
  openQbittorrentStream,
} from '@aiostreams/core';
import { mapDebridErrorToStaticFile } from '../../utils/static-errors.js';
import { serveRangeStream } from '../../utils/range-stream.js';
import { corsMiddleware } from '../../middlewares/cors.js';

const logger = createLogger('server:qbittorrent');
const router: Router = Router();

router.use(corsMiddleware);

/**
 * Byte-serving endpoint for qBittorrent streams. The token is an encrypted
 * capability minted by `QBittorrentService.resolve` (it carries the user's
 * WebUI credential and the selected file), so no additional auth is required
 * here. Serves HTTP Range requests straight from the file on disk, gated
 * against the torrent's piece states.
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
          // Bytes are already on the wire; the only honest answer is to
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
