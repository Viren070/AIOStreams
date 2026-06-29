import { NextFunction, Request, Response } from 'express';
import { pipeline } from 'stream/promises';
import {
  createLogger,
  openNativeUsenetStream,
  webdavContentType,
  DebridError,
} from '@aiostreams/core';

const logger = createLogger('server:usenet');

/**
 * Parse a single-range `Range` header. Returns `undefined` for no range or an
 * unsupported suffix range (`bytes=-N`), in which case the full file is served.
 * `endExclusive` is `undefined` for open-ended ranges (`bytes=START-`).
 */
export function parseRange(
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

/**
 * Serve a native usenet stream token over HTTP with full Range support
 * (206/200, ETag, conditional GET, HEAD), piping bytes straight from the NNTP
 * engine. The token is an encrypted capability minted by the engine
 * (`NativeUsenetService.resolve` / `mintUsenetLibraryToken`) — it carries the
 * source NZB + file selection — so the caller is responsible for any auth
 * (the Stremio stream endpoint validates `aiostreamsAuth` before minting; the
 * WebDAV server validates Basic Auth before resolving). Shared by the
 * `/api/v1/usenet/stream/:token` route and the WebDAV `GET`/`HEAD` handler so
 * both behave identically.
 */
export async function serveUsenetStreamToken(
  req: Request,
  res: Response,
  next: NextFunction,
  opts: { token: string; asAttachment?: boolean }
): Promise<void> {
  const requested = parseRange(req.headers.range);
  const controller = new AbortController();
  const onClose = () => controller.abort();
  res.on('close', onClose);

  try {
    const opened = await openNativeUsenetStream({
      token: opts.token,
      start: requested?.start,
      end: requested?.endExclusive,
      signal: controller.signal,
    });

    const { size, start, end, stream, filename, etag, lastModified } = opened;

    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', lastModified.toUTCString());
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Accept-Ranges', 'bytes');

    // Conditional GET: a re-request of the unchanged file with a matching
    // If-None-Match is a cheap 304.
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

    const disposition = opts.asAttachment ? 'attachment' : 'inline';
    res.setHeader('Content-Type', webdavContentType(filename));
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

    await pipeline(stream, res);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    const isClientDisconnect =
      controller.signal.aborted ||
      code === 'ERR_STREAM_PREMATURE_CLOSE' ||
      code === 'ECONNRESET' ||
      code === 'EPIPE' ||
      code === 'ERR_STREAM_DESTROYED';

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
