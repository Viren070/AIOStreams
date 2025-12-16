import { NextFunction, Request, Response, Router } from 'express';
import {
  APIError,
  constants,
  createLogger,
  decryptString,
  Env,
  fromUrlSafeBase64,
  getProxyAgent,
  getTimeTakenSincePoint,
  shouldProxy,
} from '@aiostreams/core';
import { z } from 'zod';
import { request, Dispatcher } from 'undici';
import { pipeline } from 'stream/promises';
import { BuiltinProxyStats, BuiltinProxy } from '@aiostreams/core';
import { corsMiddleware } from '../../middlewares/cors.js';
import { StaticFiles } from '../../app.js';
import { Transform } from 'stream';

const logger = createLogger('server');
const router: Router = Router();

// Create a singleton instance of BuiltinProxyStats
const proxyStats = new BuiltinProxyStats();
const PROGRESS_UPDATE_INTERVAL_MS = 5000;

type AllUserStats = Awaited<
  ReturnType<(typeof proxyStats)['getAllUserStats']>
>;
type UserStats = AllUserStats extends Map<string, infer U> ? U : never;
type ConnectionRecord = UserStats extends { active: Array<infer C> }
  ? C
  : never;

const mapConnectionToStats = (conn: ConnectionRecord) => {
  const progress =
    conn.contentLength && conn.contentLength > 0
      ? Math.max(
          1,
          parseFloat(
            ((((conn.bytesRead || 0) / conn.contentLength) * 100).toFixed(1))
          )
        )
      : 0;

  return {
    ip: conn.ip,
    url: conn.url,
    filename: conn.filename ?? null,
    timestamp: new Date(conn.timestamp).toISOString(),
    lastSeen: new Date(conn.lastSeen).toISOString(),
    count: conn.count,
    requestIds: conn.requestIds,
    metaId: conn.metaId ?? null,
    relativeTimestamp: `${getTimeTakenSincePoint(conn.timestamp)} ago`,
    relativeLastSeen: `${getTimeTakenSincePoint(conn.lastSeen)} ago`,
    progress,
  };
};

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
  metaId: z.string().optional(),
});


router.use(corsMiddleware);

// GET /stats endpoint to display proxy statistics
router.get(
  '/stats',
  async (req: Request, res: Response, next: NextFunction) => {
    // only show stats to admin users
    try {
      const { auth: authQuery } = z
        .object({ auth: z.string() })
        .parse(req.query);
      const auth = BuiltinProxy.validateAuth(authQuery);
      if (!auth.admin) {
        throw new APIError(
          constants.ErrorCode.UNAUTHORIZED,
          undefined,
          'Invalid auth'
        );
      }
    } catch (error) {
      if (error instanceof APIError) {
        next(error);
      } else {
        next(
          new APIError(
            constants.ErrorCode.UNAUTHORIZED,
            undefined,
            'Invalid auth'
          )
        );
      }
    }

    try {
      const allUserStats = await proxyStats.getAllUserStats();

      // Convert Map to a more JSON-friendly format
      const stats = {
        timestamp: new Date().toISOString(),
        totalUsers: allUserStats.size,
        users: Object.fromEntries(
          Array.from(allUserStats.entries()).map(([user, userStats]) => [
            user,
            {
              active: userStats.active.map(mapConnectionToStats),
              history: userStats.history.map(mapConnectionToStats),
            },
          ])
        ),
        summary: {
          totalActiveConnections: Array.from(allUserStats.values()).reduce(
            (total, userStats) => total + userStats.active.length,
            0
          ),
          totalHistoryConnections: Array.from(allUserStats.values()).reduce(
            (total, userStats) => total + userStats.history.length,
            0
          ),
          usersWithActiveConnections: Array.from(allUserStats.entries()).filter(
            ([_, userStats]) => userStats.active.length > 0
          ).length,
          usersWithHistory: Array.from(allUserStats.entries()).filter(
            ([_, userStats]) => userStats.history.length > 0
          ).length,
        },
      };

      res.json(stats);
    } catch (error) {
      logger.error('Failed to get proxy stats', {
        error: error instanceof Error ? error.message : String(error),
      });
      next(error);
    }
  }
);

router.all(
  '/:encryptedAuthAndData{/:filename}',
  async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(7);
    let upstreamResponse: Dispatcher.ResponseData | undefined;
    let auth: { username: string; password: string } | undefined;
    let data: z.infer<typeof ProxyDataSchema> | undefined;
    let clientIp: string | undefined;

    try {
      // decrypt and authenticate the request
      const { encryptedAuthAndData } = req.params;
      // const [encodeMode, encryptedAuth, encryptedData] =
      //   encryptedAuthAndData.split('.');
      const parts = encryptedAuthAndData.split('.');
      let encodedAuth: string | undefined;
      let encodedData: string | undefined;
      let encodeMode: 'e' | 'u' | undefined;
      if (parts.length == 2) {
        encodeMode = 'e';
        encodedAuth = parts[0];
        encodedData = parts[1];
      } else if (parts.length == 3) {
        encodeMode = parts[0] as 'e' | 'u';
        encodedAuth = parts[1];
        encodedData = parts[2];
      } else {
        throw new APIError(
          constants.ErrorCode.BAD_REQUEST,
          undefined,
          'Invalid encrypted auth and data'
        );
      }
      const filename = req.params.filename as string | undefined;

      let rawData: string | undefined;
      let rawAuth: string | undefined;
      if (encodeMode === 'e') {
        const { data: streamData } = decryptString(encodedData);
        const { data: authData } = decryptString(encodedAuth);
        rawData = streamData ?? undefined;
        rawAuth = authData ?? undefined;
      } else {
        rawAuth = fromUrlSafeBase64(encodedAuth);
        rawData = fromUrlSafeBase64(encodedData);
      }

      if (!rawData || !rawAuth) {
        logger.error(`[${requestId}] Decryption failed`);
        next(
          new APIError(
            constants.ErrorCode.ENCRYPTION_ERROR,
            undefined,
            'Could not decrypt data or auth'
          )
        );
        return;
      }

      data = ProxyDataSchema.parse(JSON.parse(rawData));
      auth = ProxyAuthSchema.parse(JSON.parse(rawAuth));

      if (
        (!Env.AIOSTREAMS_AUTH?.has(auth.username) ||
          Env.AIOSTREAMS_AUTH?.get(auth.username) !== auth.password) &&
        (auth.username !== constants.PUBLIC_NZB_PROXY_USERNAME ||
          !Env.NZB_PROXY_PUBLIC_ENABLED)
      ) {
        logger.warn(`[${requestId}] Authentication failed`, {
          username: auth.username,
        });
        next(
          new APIError(
            constants.ErrorCode.UNAUTHORIZED,
            undefined,
            'Invalid auth'
          )
        );
        return;
      }

      // Track the connection
      clientIp =
        req.requestIp || req.ip || req.socket.remoteAddress || 'unknown';
      const timestamp = Date.now();

      const connectionLimit =
        Env.AIOSTREAMS_AUTH_CONNECTIONS_LIMIT?.get(auth.username) ??
        Env.AIOSTREAMS_AUTH_CONNECTIONS_LIMIT?.get('*') ??
        0;

      // prepare and execute upstream request
      const clientHeaders = copyHeaders(req.headers);

      const isBodyRequest =
        req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH';
      const isGetRequest = req.method === 'GET';

      let sizeLimiter;
      let bytesRead = 0;
      if (auth.username === constants.PUBLIC_NZB_PROXY_USERNAME) {
        if (Env.NZB_PROXY_MAX_SIZE > 0) {
          sizeLimiter = new Transform({
            transform(chunk, encoding, callback) {
              bytesRead += chunk.length;

              if (bytesRead > Env.NZB_PROXY_MAX_SIZE) {
                callback(new Error('Content too large'));
              } else {
                callback(null, chunk);
              }
            },
          });
        }
        if (data.type !== 'nzb') {
          logger.warn(
            `[${requestId}] Public NZB proxy can only be used for NZB files`,
            { dataType: data.type }
          );
          next(
            new APIError(
              constants.ErrorCode.FORBIDDEN,
              undefined,
              'Public NZB proxy can only be used for NZB files'
            )
          );
          return;
        }
      }

      if (isGetRequest) {
        if (connectionLimit > 0) {
          const activeConnections = await proxyStats.getActiveConnections(
            auth.username
          );
          if (activeConnections.length >= connectionLimit) {
            logger.warn(`[${requestId}] Connection limit reached`, {
              username: auth.username,
              clientIp,
              connectionLimit,
            });
            res
              .status(302)
              .redirect(`/static/${StaticFiles.CONTENT_PROXY_LIMIT_REACHED}`);
            return;
          }
        }
        proxyStats
          .addConnection(
            auth.username,
            clientIp,
            data.url,
            timestamp,
            requestId,
            filename,
            data.metaId
          )
          .catch((error) =>
            logger.warn(`[${requestId}] Failed to add connection to stats`, {
              error: error instanceof Error ? error.message : String(error),
            })
          );
      }

      const upstreamStartTime = Date.now();
      let currentUrl = data.url;
      const maxRedirects = 10;
      let redirectCount = 0;
      let method = req.method as Dispatcher.HttpMethod;

      while (redirectCount < maxRedirects) {
        const urlObj = new URL(currentUrl);
        if (Env.BASE_URL && urlObj.origin === Env.BASE_URL) {
          const internalUrl = new URL(Env.INTERNAL_URL);
          urlObj.protocol = internalUrl.protocol;
          urlObj.host = internalUrl.host;
          urlObj.port = internalUrl.port;
        }

        if (Env.REQUEST_URL_MAPPINGS) {
          for (const [key, value] of Object.entries(Env.REQUEST_URL_MAPPINGS)) {
            if (urlObj.origin === key) {
              const mappedUrl = new URL(value);
              urlObj.protocol = mappedUrl.protocol;
              urlObj.host = mappedUrl.host;
              urlObj.port = mappedUrl.port;
              break;
            }
          }
        }
        const { useProxy, proxyIndex } = shouldProxy(urlObj);
        const proxyAgent = useProxy
          ? getProxyAgent(Env.ADDON_PROXY![proxyIndex])
          : undefined;
        const headers = Object.fromEntries(
          Object.entries({ ...clientHeaders, ...data.requestHeaders }).map(
            ([key, value]) => [key.toLowerCase(), value]
          )
        );
        if (urlObj.username && urlObj.password) {
          const basicAuth = Buffer.from(
            `${decodeURIComponent(urlObj.username)}:${decodeURIComponent(
              urlObj.password
            )}`
          ).toString('base64');
          headers['authorization'] = `Basic ${basicAuth}`;
          urlObj.username = '';
          urlObj.password = '';
        }
        currentUrl = urlObj.toString();
        logger.debug(`[${requestId}] Making upstream request`, {
          username: auth.username,
          method: method,
          proxied: useProxy
            ? `true${proxyIndex > 1 ? ` (${proxyIndex + 1})` : ''}`
            : 'false',
          range: headers['range'],
          url: currentUrl,
        });
        logger.silly(`[${requestId}] Headers for upstream request`, {
          headers: JSON.stringify(headers),
        });
        upstreamResponse = await request(currentUrl, {
          method: method,
          headers: headers,
          dispatcher: proxyAgent,
          body: isBodyRequest ? req : undefined,
          bodyTimeout: 0,
          headersTimeout: 0,
        });

        if ([301, 302, 303, 307, 308].includes(upstreamResponse.statusCode)) {
          redirectCount++;
          const location = upstreamResponse.headers['location'];
          if (!location || typeof location !== 'string') {
            break; // No location header, stop redirecting
          }
          currentUrl = new URL(location, currentUrl).href;

          if ([301, 302, 303].includes(upstreamResponse.statusCode)) {
            method = 'GET';
          }
          // For 307, 308, method remains the same
          continue;
        }

        break; // Not a redirect, exit loop
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
      const contentLengthHeader = upstreamResponse.headers['content-length']
        ? Array.isArray(upstreamResponse.headers['content-length'])
          ? upstreamResponse.headers['content-length'][0]
          : upstreamResponse.headers['content-length']
        : undefined;
      const contentLength = contentLengthHeader
        ? parseInt(contentLengthHeader, 10)
        : 0;
      if (auth.username === constants.PUBLIC_NZB_PROXY_USERNAME) {
        // size check
        if (Env.NZB_PROXY_MAX_SIZE > 0) {
          const maxSize = Env.NZB_PROXY_MAX_SIZE;
          if (maxSize > 0 && contentLength > maxSize) {
            logger.warn(`[${requestId}] Public NZB proxy size limit exceeded`, {
              contentLength,
              maxSize,
            });
            next(
              new APIError(
                constants.ErrorCode.FORBIDDEN,
                undefined,
                'Content size exceeds public NZB proxy limit'
              )
            );
            return;
          }
        }
      }

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

      let totalBytesRead = 0;
      let pendingBytes = 0;
      let lastProgressSent = 0;
      let lastProgressUpdate = Date.now();

      const progressTracker = new Transform({
        transform(chunk, encoding, callback) {
          totalBytesRead += chunk.length;
          pendingBytes += chunk.length;

          const now = Date.now();
          const progress =
            contentLength > 0
              ? Math.max(1, (totalBytesRead / contentLength) * 100)
              : 0;
          const progressDelta = progress - lastProgressSent;
          
          // update in reasonable intervals
          const shouldFlush =
            pendingBytes > 0 &&
            ((contentLength > 0 && progressDelta >= 2) ||
              now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL_MS);

          if (shouldFlush && auth && clientIp && data) {
            const bytesToPersist = pendingBytes;
            pendingBytes = 0;
            lastProgressSent = progress;
            lastProgressUpdate = now;

            proxyStats
              .updateConnectionProgress(
                auth.username,
                clientIp,
                data.url,
                bytesToPersist,
                contentLength
              )
              .catch((err) => {
                logger.debug(
                  `[${requestId}] Failed to update connection progress`,
                  {
                    error: err instanceof Error ? err.message : String(err),
                  }
                );
              });
          }

          callback(null, chunk);
        },
        flush(callback) {
          if (auth && clientIp && data && pendingBytes > 0) {
            proxyStats
              .updateConnectionProgress(
                auth.username,
                clientIp,
                data.url,
                pendingBytes,
                contentLength
              )
              .catch((err) => {
                logger.debug(
                  `[${requestId}] Failed to update connection progress`,
                  {
                    error: err instanceof Error ? err.message : String(err),
                  }
                );
              })
              .finally(() => callback());
          } else {
            callback();
          }
        },
      });

      if (req.method === 'HEAD') {
        res.end();
      } else {
        if (sizeLimiter) {
          await pipeline(
            upstreamResponse.body,
            sizeLimiter,
            progressTracker,
            res
          );
        } else {
          await pipeline(upstreamResponse.body, progressTracker, res);
        }
      }

      logger.debug(`[${requestId}] Proxy connection closed`, {
        username: auth.username,
      });
    } catch (error) {
      const totalDuration = Date.now() - startTime;

      if (upstreamResponse) {
        upstreamResponse.body.destroy();
      }

      if (
        (error as NodeJS.ErrnoException)?.code !== 'ERR_STREAM_PREMATURE_CLOSE'
      ) {
        logger.error(`[${requestId}] Proxy request failed`, {
          error: error instanceof Error ? error.message : String(error),
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
        logger.debug(`[${requestId}] Client disconnected (premature close)`, {
          durationMs: totalDuration,
        });
      }
    } finally {
      if (auth && clientIp && data) {
        proxyStats
          .endConnection(auth.username, clientIp, data.url, requestId)
          .catch((statsError) =>
            logger.warn(`[${requestId}] Failed to end connection in stats`, {
              error: statsError,
            })
          );
      }
    }
  }
);
