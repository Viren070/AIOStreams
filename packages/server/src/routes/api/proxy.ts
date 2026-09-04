import { NextFunction, Request, Response, Router } from 'express';
import {
  APIError,
  constants,
  createLogger,
  decryptString,
  resolveOverrideHeaders,
  appConfig,
  fromUrlSafeBase64,
  getTimeTakenSincePoint,
  makeUrlLogSafe,
  rewriteRequestUrl,
  resolveDispatcher,
  getRedirectHop,
  takeBasicAuthFromUrl,
  MAX_REDIRECTS,
  REQUEST_BODY_HEADERS,
  validateCredentials,
  hasPermission,
  Permission,
  downloadManager,
  NzbTooLargeError,
  BuiltinProxy,
  streamRegistry,
  proxyTargetKey,
} from '@aiostreams/core';
import { z } from 'zod';
import { request, Dispatcher } from 'undici';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import { requireAdmin } from '../../middlewares/auth.js';
import { corsMiddleware } from '../../middlewares/cors.js';
import { StaticFiles } from '../../utils/static-errors.js';

const logger = createLogger('server');
const router: Router = Router();

function sanitiseHeaderValue(value: string): string {
  return value.replace(/[^\t\x20-\x7e]/g, '');
}

// A helper to iterate over the headers object
function sanitiseHeaders(
  headers: Record<string, string | string[] | number | undefined>
): Record<string, string | string[]> {
  const sanitised: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      sanitised[key] = value.map((v) => sanitiseHeaderValue(v));
    } else if (typeof value === 'number') {
      sanitised[key] = String(value);
    } else {
      sanitised[key] = sanitiseHeaderValue(value);
    }
  }

  return sanitised;
}

/**
 * Byte offset a client's `Range` header asks for. Suffix ranges (`bytes=-N`)
 * have no known start, so they read as 0.
 */
function rangeStart(header: string | undefined): number {
  const match = /^bytes=(\d+)-/.exec((header ?? '').trim());
  return match ? Number(match[1]) : 0;
}

/**
 * Total size of the resource from a `Content-Range: bytes a-b/total` header.
 * `Content-Length` is the length of the returned range on a 206, so using it
 * would shrink the reported file size on every seek.
 */
function totalFromContentRange(header: string | string[] | undefined): number {
  const value = Array.isArray(header) ? header[0] : header;
  const match = /\/(\d+)\s*$/.exec(value ?? '');
  return match ? Number(match[1]) : 0;
}

function copyHeaders(headers: Record<string, string | string[] | undefined>) {
  const exclude = new Set([
    // Host header
    'host',
    // IP headers
    'x-client-ip',
    'x-forwarded-for',
    'cf-connecting-ip',
    'do-connecting-ip',
    'fastly-client-ip',
    'true-client-ip',
    'x-real-ip',
    'x-cluster-client-ip',
    'x-forwarded',
    'forwarded-for',
    'x-appengine-user-ip',
    'cf-pseudo-ipv4',
    'x-forwarded-proto',

    // Hop-by-hop headers
    'connection',
    'upgrade',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'proxy-connection',
  ]);
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => !exclude.has(key))
  );
}

export default router;

const ProxyAuthSchema = z.object({
  username: z.string(),
  password: z.string(),
});

const ProxyDataSchema = z.object({
  url: z.url(),
  filename: z.string().optional(),
  type: z.enum(['nzb', 'stream']).optional(),
  // These are optional, as we'll be forwarding client headers
  requestHeaders: z.record(z.string(), z.string()).optional(),
  responseHeaders: z.record(z.string(), z.string()).optional(),
});

type ProxyAuth = z.infer<typeof ProxyAuthSchema>;
type ProxyData = z.infer<typeof ProxyDataSchema>;

/**
 * Decode the `{mode}.{auth}.{data}` path segment, then authenticate and
 * authorise the caller. Throws {@link APIError} (mapped to the right status by
 * the route's catch) on any malformed / unauthenticated / unauthorised request.
 */
function decodeAndAuthorizeRequest(
  encryptedAuthAndData: string,
  requestId: string
): { auth: ProxyAuth; data: ProxyData } {
  const parts = encryptedAuthAndData.split('.');
  let encodedAuth: string;
  let encodedData: string;
  let encodeMode: 'e' | 'u';
  if (parts.length === 2) {
    encodeMode = 'e';
    [encodedAuth, encodedData] = parts;
  } else if (parts.length === 3) {
    encodeMode = parts[0] as 'e' | 'u';
    [, encodedAuth, encodedData] = parts;
  } else {
    throw new APIError(
      constants.ErrorCode.BAD_REQUEST,
      undefined,
      'Invalid encrypted auth and data'
    );
  }

  let rawAuth: string | undefined;
  let rawData: string | undefined;
  if (encodeMode === 'e') {
    rawAuth = decryptString(encodedAuth).data ?? undefined;
    rawData = decryptString(encodedData).data ?? undefined;
  } else {
    rawAuth = fromUrlSafeBase64(encodedAuth);
    rawData = fromUrlSafeBase64(encodedData);
  }

  if (!rawData || !rawAuth) {
    logger.error(`[${requestId}] Decryption failed`);
    throw new APIError(
      constants.ErrorCode.ENCRYPTION_ERROR,
      undefined,
      'Could not decrypt data or auth'
    );
  }

  const data = ProxyDataSchema.parse(JSON.parse(rawData));
  const auth = ProxyAuthSchema.parse(JSON.parse(rawAuth));

  if (!validateCredentials(auth.username, auth.password)) {
    logger.warn(`[${requestId}] Authentication failed`, {
      username: auth.username,
    });
    throw new APIError(
      constants.ErrorCode.UNAUTHORIZED,
      undefined,
      'Invalid auth'
    );
  }

  if (!hasPermission(auth.username, Permission.Proxy)) {
    logger.warn(`[${requestId}] Proxy access denied`, {
      username: auth.username,
    });
    throw new APIError(
      constants.ErrorCode.FORBIDDEN,
      undefined,
      'Proxy access not permitted for this user'
    );
  }

  return { auth, data };
}

/**
 * Build the outbound header set for an upstream request to `urlObj`: client
 * headers + the caller's `requestHeaders`, then per-host / `[context]` override
 * headers, then any URL userinfo folded into a Basic auth header (and stripped
 * from `urlObj`). Header names are lowercased. Mutates `urlObj`.
 */
function buildOutboundHeaders(
  clientHeaders: Record<string, string | string[] | undefined>,
  requestHeaders: Record<string, string> | undefined,
  urlObj: URL,
  context?: 'nzb_grabs'
): Record<string, string | string[] | undefined> {
  const headers = Object.fromEntries(
    Object.entries({ ...clientHeaders, ...requestHeaders }).map(
      ([key, value]) => [key.toLowerCase(), value]
    )
  );
  for (const [name, value] of Object.entries(
    resolveOverrideHeaders(urlObj, context)
  )) {
    headers[name.toLowerCase()] = value;
  }
  const basicAuth = takeBasicAuthFromUrl(urlObj);
  if (basicAuth) {
    headers['authorization'] = basicAuth;
  }
  return headers;
}

/**
 * Serve a NZB grab (`type: 'nzb'`) from the shared disk-backed grab
 * cache. Throws {@link APIError} on failure.
 */
async function serveNzbFromGrabCache(
  method: string,
  res: Response,
  data: ProxyData,
  requestId: string,
  username: string
): Promise<void> {
  let nzb: Buffer;
  try {
    nzb = await downloadManager.fetchNzb(data.url);
  } catch (error) {
    if (error instanceof NzbTooLargeError) {
      throw new APIError(constants.ErrorCode.BAD_REQUEST, 413, error.message);
    }
    logger.error(`[${requestId}] Failed to grab NZB`, {
      username,
      url: makeUrlLogSafe(data.url),
      error: error instanceof Error ? error.message : String(error),
    });
    throw new APIError(
      constants.ErrorCode.INTERNAL_SERVER_ERROR,
      502,
      'Failed to grab NZB'
    );
  }

  res.status(200);
  res.set('Content-Type', 'application/x-nzb');
  res.set('Content-Length', String(nzb.length));
  if (data.filename) {
    res.set(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(data.filename)}"`
    );
  }
  // Let any caller-supplied response headers win, matching the streaming path.
  if (data.responseHeaders) {
    res.set(data.responseHeaders);
  }
  logger.debug(`[${requestId}] Served NZB from grab cache`, {
    username,
    bytes: nzb.length,
    url: makeUrlLogSafe(data.url),
  });
  if (method === 'HEAD') {
    res.end();
  } else {
    res.end(nzb);
  }
}

router.use(corsMiddleware);

// POST /generate — produce a proxified URL. Admin-only (dashboard session).
// Credentials are injected server-side from AIOSTREAMS_AUTH for the session
// user — the proxy password never reaches the browser.
const GenerateSchema = ProxyDataSchema.extend({
  encrypt: z.boolean().optional().default(true),
});

router.post(
  '/generate',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = GenerateSchema.parse(req.body ?? {});
      const username = (req as { user?: { username?: string } }).user?.username;
      const password = username
        ? appConfig.bootstrap.auth?.get(username)
        : undefined;
      if (!username || !password) {
        throw new APIError(
          constants.ErrorCode.UNAUTHORIZED,
          undefined,
          'No AIOSTREAMS_AUTH credentials for the current session user'
        );
      }
      const proxy = new BuiltinProxy({
        id: constants.BUILTIN_SERVICE,
        enabled: true,
        url: appConfig.bootstrap.baseUrl,
        credentials: `${username}:${password}`,
      } as any);
      const urls = await proxy.generateUrls(
        [
          {
            url: body.url,
            filename: body.filename,
            type: body.type ?? 'stream',
            headers: {
              request: body.requestHeaders,
              response: body.responseHeaders,
            },
          },
        ],
        body.encrypt
      );
      if (!urls || 'error' in (urls as object)) {
        throw new APIError(
          constants.ErrorCode.INTERNAL_SERVER_ERROR,
          undefined,
          (urls as { error: string })?.error ?? 'Failed to generate URL'
        );
      }
      res.json({ proxified_url: (urls as string[])[0] });
    } catch (error) {
      next(error);
    }
  }
);

interface ProxyParams {
  encryptedAuthAndData: string;
  filename?: string; // optional
}

router.all(
  '/:encryptedAuthAndData{/:filename}',
  async (req: Request<ProxyParams>, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(7);
    let upstreamResponse: Dispatcher.ResponseData | undefined;
    let auth: { username: string; password: string } | undefined;
    let data: z.infer<typeof ProxyDataSchema> | undefined;
    let clientIp: string | undefined;
    let session: ReturnType<typeof streamRegistry.open> | undefined;

    try {
      const { auth: decodedAuth, data: decodedData } =
        decodeAndAuthorizeRequest(req.params.encryptedAuthAndData, requestId);
      auth = decodedAuth;
      data = decodedData;
      const filename = req.params.filename as string | undefined;

      if (
        data.type === 'nzb' &&
        (req.method === 'GET' || req.method === 'HEAD')
      ) {
        await serveNzbFromGrabCache(
          req.method,
          res,
          data,
          requestId,
          auth.username
        );
        return;
      }

      // Track the connection
      clientIp = req.requestIp || req.ip || req.socket.remoteAddress;

      // prepare and execute upstream request
      const clientHeaders = copyHeaders(req.headers);

      const isBodyRequest =
        req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH';
      const isGetRequest = req.method === 'GET';

      if (isGetRequest) {
        // Without probes, a viewer that vanishes without a FIN leaves the
        // response hanging on a socket nothing will ever close.
        req.socket.setKeepAlive(true, 60_000);
        // Seeks join the session already open for this (user, ip, target)
        // and skip admission.
        session = streamRegistry.open({
          transport: 'proxy',
          username: auth.username,
          clientIp,
          targetKey: proxyTargetKey(data.url),
          filename,
          displayUrl: makeUrlLogSafe(data.url),
          // Where this read starts, so a seek advances the progress bar
          // instead of restarting it.
          start: rangeStart(req.headers.range),
        });
        if (!session.ok) {
          logger.warn(`[${requestId}] Proxy stream refused`, {
            username: auth.username,
            clientIp,
            reason: session.verdict.reason,
          });
          res
            .status(302)
            .redirect(`/static/${StaticFiles.CONTENT_PROXY_LIMIT_REACHED}`);
          return;
        }
        // A full-buffered player never notices a clean FIN.
        session.handle.onKill(() => {
          upstreamResponse?.body?.destroy();
          if (!req.socket.destroyed) req.socket.resetAndDestroy();
        });
      }

      const upstreamStartTime = Date.now();
      let currentUrl = data.url;

      let redirectCount = 0;
      let method = req.method as Dispatcher.HttpMethod;
      // Set once a redirect rewrites the method to GET: the client body was
      // consumed on the first hop and must not be resent or described.
      let bodyDropped = false;

      while (true) {
        const grabContext = data.type === 'nzb' ? 'nzb_grabs' : undefined;
        const urlObj = rewriteRequestUrl(new URL(currentUrl));
        const { dispatcher, useProxy, proxyIndex } = resolveDispatcher(
          urlObj,
          grabContext
        );
        const headers = buildOutboundHeaders(
          clientHeaders,
          data.requestHeaders,
          urlObj,
          grabContext
        );
        if (bodyDropped) {
          for (const header of REQUEST_BODY_HEADERS) {
            delete headers[header];
          }
        }
        currentUrl = urlObj.toString();
        logger.debug(
          {
            requestId,
            username: auth.username,
            url: makeUrlLogSafe(currentUrl),
            method,
            tunneled: dispatcher ? `true (proxy index ${proxyIndex})` : 'false',
            ...(appConfig.logging.logSensitiveInfo
              ? {
                  headers,
                  dispatcher: useProxy
                    ? appConfig.http.addonProxy[proxyIndex]
                    : undefined,
                }
              : {}),
          },
          'Making upstream request'
        );

        upstreamResponse = await request(currentUrl, {
          method: method,
          headers: headers,
          dispatcher: dispatcher,
          body: isBodyRequest && !bodyDropped ? req : undefined,
          bodyTimeout: 0,
          headersTimeout: 0,
        });

        const hop = getRedirectHop(
          upstreamResponse.statusCode,
          upstreamResponse.headers['location'],
          currentUrl,
          method
        );
        if (!hop || redirectCount >= MAX_REDIRECTS) {
          break;
        }
        redirectCount++;
        // Release the pooled connection held by the intermediate response.
        await upstreamResponse.body.dump().catch(() => {});
        currentUrl = hop.location;
        method = hop.method as Dispatcher.HttpMethod;
        if (hop.methodChanged) {
          bodyDropped = true;
        }
      }

      if (!upstreamResponse) {
        logger.error(`[${requestId}] Upstream response not found`);
        if (!res.headersSent) {
          next(
            new APIError(
              constants.ErrorCode.INTERNAL_SERVER_ERROR,
              undefined,
              'Upstream response not found'
            )
          );
        }
        return;
      }
      const upstreamDuration = getTimeTakenSincePoint(upstreamStartTime);

      // forward upstream response to client
      res.set(sanitiseHeaders(upstreamResponse.headers));
      if (data.responseHeaders) {
        res.set(data.responseHeaders);
      }
      res.status(upstreamResponse.statusCode);

      logger.debug(`[${requestId}] Serving upstream response`, {
        username: auth.username,
        statusCode: upstreamResponse.statusCode,
        upstreamDuration,
        contentType: upstreamResponse.headers['content-type'],
        contentLength: upstreamResponse.headers['content-length'],
        contentRange: upstreamResponse.headers['content-range'],
        targetUrl: currentUrl,
      });

      if (session?.ok) {
        // Content-Range carries the whole file; Content-Length only this range.
        const declared = Number(upstreamResponse.headers['content-length']);
        const total =
          totalFromContentRange(upstreamResponse.headers['content-range']) ||
          (Number.isFinite(declared) ? declared : 0);
        session.handle.setInfo({ size: total || undefined });
      }

      if (req.method === 'HEAD') {
        res.end();
      } else {
        // Check if streams are still writable before piping
        if (upstreamResponse.body.destroyed || res.destroyed) {
          logger.debug(
            `[${requestId}] Stream already destroyed, skipping pipe`,
            {
              upstreamDestroyed: upstreamResponse.body.destroyed,
              resDestroyed: res.destroyed,
            }
          );
        } else if (session?.ok) {
          const handle = session.handle;
          const counter = new Transform({
            transform(chunk, _enc, cb) {
              handle.addBytes(chunk.length);
              cb(null, chunk);
            },
          });
          await pipeline(upstreamResponse.body, counter, res);
        } else {
          await pipeline(upstreamResponse.body, res);
        }
      }

      logger.debug(`[${requestId}] Proxy connection closed`, {
        username: auth.username,
      });
    } catch (error) {
      if (error instanceof APIError) {
        if (!res.headersSent) {
          next(error);
        }
        return;
      }

      const totalDuration = Date.now() - startTime;

      if (upstreamResponse && !upstreamResponse.body.destroyed) {
        upstreamResponse.body.on('error', (err) => {
          logger.warn(
            `[${requestId}] Failed to destroy upstream response body`,
            {
              error: err instanceof Error ? err.message : String(err),
            }
          );
        });
        upstreamResponse.body.destroy();
      }

      const errorCode = (error as NodeJS.ErrnoException)?.code;
      const isClientDisconnect =
        errorCode === 'ERR_STREAM_PREMATURE_CLOSE' ||
        errorCode === 'ERR_STREAM_UNABLE_TO_PIPE' ||
        errorCode === 'ECONNRESET' ||
        errorCode === 'EPIPE' ||
        errorCode === 'ERR_STREAM_DESTROYED' ||
        (error as Error)?.message?.includes('aborted') ||
        (error as Error)?.message?.includes('destroyed');

      if (!isClientDisconnect) {
        logger.error(`[${requestId}] Proxy request failed`, {
          error: error instanceof Error ? error.message : String(error),
          errorCode,
          durationMs: totalDuration,
          contentLength: upstreamResponse?.headers['content-length'],
          upstreamStatusCode: upstreamResponse?.statusCode,
        });
        if (!res.headersSent) {
          next(
            new APIError(
              constants.ErrorCode.INTERNAL_SERVER_ERROR,
              undefined,
              'Proxy request failed'
            )
          );
        }
      } else {
        logger.debug(`[${requestId}] Client disconnected`, {
          errorCode,
          durationMs: totalDuration,
        });
      }
    } finally {
      // Ends this request only; the session idles out on its own.
      if (session?.ok) session.handle.close();
    }
  }
);
