import { NextFunction, Request, Response, Router } from 'express';
import { pipeline } from 'stream/promises';
import {
  createLogger,
  openNativeUsenetStream,
  DebridError,
} from '@aiostreams/core';
import { corsMiddleware } from '../../middlewares/cors.js';

const logger = createLogger('server:usenet');
const router: Router = Router();

router.use(corsMiddleware);

const MIME_BY_EXT: Record<string, string> = {
  mkv: 'video/x-matroska',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ts: 'video/mp2t',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
};

function mimeForFilename(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/**
 * Parse a single-range `Range` header. Returns `undefined` for no range or an
 * unsupported suffix range (`bytes=-N`), in which case the full file is served.
 * `endExclusive` is `undefined` for open-ended ranges (`bytes=START-`).
 */
function parseRange(
  header: string | undefined
): { start: number; endExclusive?: number } | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '') return undefined; // suffix range: serve full
  const start = Number(rawStart);
  const endExclusive = rawEnd === '' ? undefined : Number(rawEnd) + 1;
  return { start, endExclusive };
}

interface UsenetStreamParams {
  token: string;
  filename?: string;
}

/**
 * Byte-serving endpoint for native usenet streams. The token is an encrypted
 * capability minted by `NativeUsenetService.resolve` (which already validated
 * the user's `aiostreamsAuth`), so no additional auth is required here. Serves
 * HTTP Range requests directly from the NNTP engine — never via the builtin
 * proxy.
 */
router.get(
  '/stream/:token{/:filename}',
  async (
    req: Request<UsenetStreamParams>,
    res: Response,
    next: NextFunction
  ) => {
    const { token } = req.params;
    const requested = parseRange(req.headers.range);
    const controller = new AbortController();
    const onClose = () => controller.abort();
    res.on('close', onClose);
    const socket = req.socket;
    socket.setKeepAlive(true, 60_000);

    let opened: Awaited<ReturnType<typeof openNativeUsenetStream>> | undefined;
    try {
      opened = await openNativeUsenetStream({
        token,
        start: requested?.start,
        end: requested?.endExclusive,
        signal: controller.signal,
      });

      const { size, start, end, stream, filename, etag, lastModified } = opened;

      // set appropriate cache headers
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', lastModified.toUTCString());
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Accept-Ranges', 'bytes');

      // Conditional GET: a re-request of the unchanged file with a matching
      // If-None-Match is a cheap 304
      const ifNoneMatch = req.headers['if-none-match'];
      if (
        ifNoneMatch &&
        (ifNoneMatch === '*' ||
          ifNoneMatch.split(',').some((t) => t.trim() === etag))
      ) {
        res.removeListener('close', onClose);
        stream.destroy();
        res.status(304).end();
        return;
      }

      // Unsatisfiable range.
      if (requested && requested.start >= size) {
        res.removeListener('close', onClose);
        stream.destroy();
        res.status(416).set('Content-Range', `bytes */${size}`).end();
        return;
      }

      const disposition =
        req.query.download !== undefined ? 'attachment' : 'inline';
      res.setHeader('Content-Type', mimeForFilename(filename));
      res.setHeader(
        'Content-Disposition',
        `${disposition}; filename="${encodeURIComponent(filename)}"`
      );
      res.setHeader('Content-Length', String(end - start));

      if (requested) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end - 1}/${size}`);
      } else {
        res.status(200);
      }

      logger.debug(
        { filename, size, start, end, range: req.headers.range ?? null },
        'serving native usenet stream'
      );

      if (req.method === 'HEAD') {
        stream.destroy();
        res.end();
        return;
      }

      stream.once('error', (err: NodeJS.ErrnoException) => {
        if (err?.code === 'USENET_STREAM_REAPED' && !socket.destroyed) {
          socket.resetAndDestroy();
        }
      });

      await pipeline(stream, res);
    } catch (err) {
      if (opened && !opened.stream.destroyed) opened.stream.destroy();

      const code = (err as NodeJS.ErrnoException)?.code;
      const isClientDisconnect =
        controller.signal.aborted ||
        code === 'ERR_STREAM_PREMATURE_CLOSE' ||
        code === 'ECONNRESET' ||
        code === 'EPIPE' ||
        code === 'ERR_STREAM_DESTROYED' ||
        code === 'ABORT_ERR' ||
        code === 'USENET_STREAM_REAPED';

      if (isClientDisconnect) {
        logger.debug({ code }, 'client disconnected from usenet stream');
        return;
      }

      if (res.headersSent) {
        logger.warn({ err }, 'usenet stream failed after headers sent');
        res.destroy();
        return;
      }

      if (err instanceof DebridError) {
        res.status(err.statusCode || 502).json({
          success: false,
          detail: err.message,
        });
        return;
      }
      next(err);
    } finally {
      res.removeListener('close', onClose);
    }
  }
);

export default router;
