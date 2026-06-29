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
 * Parse a single `Range` header into a from-range (`bytes=START-` /
 * `bytes=START-END`) or a suffix range (`bytes=-N`, the last N bytes, resolved
 * against the file size by the engine). Returns `undefined` for no header or an
 * unparseable/out-of-range value (in which case the full file is served).
 * `endExclusive` is `undefined` for open-ended ranges.
 */
export type ParsedRange =
  | { start: number; endExclusive?: number }
  | { suffix: number };

export function parseRange(
  header: string | undefined
): ParsedRange | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '') {
    if (rawEnd === '') return undefined; // `bytes=-` is invalid
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return undefined;
    return { suffix };
  }
  const start = Number(rawStart);
  if (!Number.isSafeInteger(start) || start < 0) return undefined;
  let endExclusive: number | undefined;
  if (rawEnd !== '') {
    const end = Number(rawEnd);
    if (!Number.isSafeInteger(end) || end < 0) return undefined;
    endExclusive = end + 1;
  }
  return { start, endExclusive };
}

/**
 * RFC 5987 encoder for the `filename*` ext-value. `encodeURIComponent` leaves
 * `'`, `(`, `)` and `*` unescaped, which are not valid `attr-char`, so encode
 * those too.
 */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
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

  // Reject reversed from-ranges (e.g. bytes=100-0) up front. Beyond-EOF and
  // suffix ranges need the file size, so the engine resolves/validates those.
  if (
    requested &&
    'start' in requested &&
    requested.endExclusive !== undefined &&
    requested.start >= requested.endExclusive
  ) {
    res.status(416).set('Content-Range', 'bytes */*').end();
    return;
  }

  const controller = new AbortController();
  const onClose = () => controller.abort();
  res.on('close', onClose);

  try {
    const opened = await openNativeUsenetStream({
      token: opts.token,
      start: requested && 'start' in requested ? requested.start : undefined,
      end:
        requested && 'start' in requested ? requested.endExclusive : undefined,
      suffix: requested && 'suffix' in requested ? requested.suffix : undefined,
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

    const disposition = opts.asAttachment ? 'attachment' : 'inline';
    res.setHeader('Content-Type', webdavContentType(filename));
    // RFC 6266: a quoted ASCII fallback plus a UTF-8 `filename*` for non-ASCII
    // names. Percent-encoding the plain `filename=` makes clients show `%20`
    // literally, so it stays a readable ASCII approximation.
    const asciiName = filename
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\]/g, '_');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeRfc5987(filename)}`
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
      if (err.statusCode === 416) {
        const cr = (err as { headers?: Record<string, string> }).headers?.[
          'content-range'
        ];
        if (cr) res.setHeader('Content-Range', cr);
        res.status(416).end();
        return;
      }
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
