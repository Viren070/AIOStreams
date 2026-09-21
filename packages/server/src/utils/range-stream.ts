import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import {
  createLogger,
  mimeForFilename,
  type ByteRangeRequest,
  type OpenedByteStream,
} from '@aiostreams/core';

const logger = createLogger('server:range-stream');

/**
 * Parse a single-range `Range` header. Returns `undefined` for no range or a
 * malformed/multi-range header, in which case the full file is served.
 */
export function parseRange(
  header: string | undefined
): ByteRangeRequest | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '') {
    if (rawEnd === '') return undefined;
    return { suffixLength: Number(rawEnd) };
  }
  const start = Number(rawStart);
  const endExclusive = rawEnd === '' ? undefined : Number(rawEnd) + 1;
  return { start, endExclusive };
}

export interface ServeRangeStreamOptions {
  /** Open the source for the parsed range; called once per request. */
  open(
    range: ByteRangeRequest | undefined,
    signal: AbortSignal
  ): Promise<OpenedByteStream>;
  /** `none` omits Content-Disposition (WebDAV). Defaults to `inline`. */
  disposition?: 'inline' | 'attachment' | 'none';
  contentType?: (filename: string) => string;
}

/**
 * RFC 5987 ext-value encoder: `encodeURIComponent` leaves `'()*` unescaped,
 * which are not valid attr-chars.
 */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

const CLIENT_GONE_CODES = new Set([
  'ERR_STREAM_PREMATURE_CLOSE',
  'ECONNRESET',
  'EPIPE',
  'ERR_STREAM_DESTROYED',
  'ABORT_ERR',
  'USENET_STREAM_REAPED',
  'STREAM_STOPPED',
]);

/**
 * Serve one HTTP range response from a lazily opened byte stream: validators,
 * conditional GET, 416, HEAD, and disconnect handling. Rejects only when
 * nothing has been sent yet, so the caller decides how to present the
 * failure; after headers the response is simply torn down.
 */
export async function serveRangeStream(
  req: Request,
  res: Response,
  opts: ServeRangeStreamOptions
): Promise<void> {
  const requested = parseRange(req.headers.range);
  const controller = new AbortController();
  const onClose = () => controller.abort();
  res.on('close', onClose);
  const socket = req.socket;
  socket.setKeepAlive(true, 60_000);

  let opened: OpenedByteStream | undefined;
  try {
    opened = await opts.open(requested, controller.signal);
    const { size, start, end, stream, filename, etag, lastModified } = opened;

    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', lastModified.toUTCString());
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Accept-Ranges', 'bytes');

    // A re-request of the unchanged file with a matching If-None-Match is a
    // cheap 304.
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

    // Unsatisfiable range (includes `bytes=-0`, which resolves to start=size).
    if (requested && start >= size) {
      res.removeListener('close', onClose);
      stream.destroy();
      res.status(416).set('Content-Range', `bytes */${size}`).end();
      return;
    }

    const disposition = opts.disposition ?? 'inline';
    res.setHeader(
      'Content-Type',
      (opts.contentType ?? mimeForFilename)(filename)
    );
    if (disposition !== 'none') {
      const asciiName = filename
        .replace(/[^\x20-\x7e]/g, '_')
        .replace(/["\\]/g, '_');
      res.setHeader(
        'Content-Disposition',
        `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeRfc5987(filename)}`
      );
    }
    res.setHeader('Content-Length', String(end - start));
    if (requested) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end - 1}/${size}`);
    } else {
      res.status(200);
    }

    logger.debug(
      { filename, size, start, end, range: req.headers.range ?? null },
      'serving range stream'
    );

    if (req.method === 'HEAD') {
      stream.destroy();
      res.end();
      return;
    }

    // A clean FIN is invisible to a player whose buffer is full.
    stream.once('error', (err: NodeJS.ErrnoException) => {
      if (
        (err?.code === 'USENET_STREAM_REAPED' ||
          err?.code === 'STREAM_STOPPED') &&
        !socket.destroyed
      ) {
        socket.resetAndDestroy();
      }
    });

    await pipeline(stream, res);
  } catch (err) {
    if (opened && !opened.stream.destroyed) opened.stream.destroy();

    const code = (err as NodeJS.ErrnoException)?.code;
    if (controller.signal.aborted || (code && CLIENT_GONE_CODES.has(code))) {
      logger.debug({ code }, 'client disconnected from range stream');
      return;
    }
    if (res.headersSent) {
      logger.warn({ err }, 'range stream failed after headers were sent');
      res.destroy();
      return;
    }
    throw err;
  } finally {
    res.removeListener('close', onClose);
  }
}
