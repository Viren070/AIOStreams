import express, { type Router } from 'express';
import {
  APIError,
  config as appConfig,
  constants,
  isEncrypted,
} from '@aiostreams/core';
import {
  jellyfinApiRateLimiter,
  jellyfinImageRateLimiter,
  jellyfinLoginRateLimiter,
  stremioStreamRateLimiter,
} from '../../middlewares/ratelimit.js';
import { jellyfinContext } from './context.js';
import systemRouter from './system.js';
import usersRouter from './users.js';
import quickConnectRouter from './quickconnect.js';
import segmentsRouter from './segments.js';
import stubsRouter from './stubs.js';
import libraryRouter from './library.js';
import playbackRouter from './playback.js';
import subtitlesRouter from './subtitles.js';
import imagesRouter from './images.js';
import playstateRouter from './playstate.js';

export const jellyfinCors: express.RequestHandler = (req, res, next) => {
  // The global middleware sets Allow-Credentials, which browsers reject
  // alongside a wildcard origin, so echo the caller's origin when it has one.
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, HEAD, OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Emby-Authorization, X-Emby-Token, X-MediaBrowser-Token, Range'
  );
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range'
  );
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
};

const UNLIMITED = /^\/system\/info\/public$/i;
const LOGIN_LIKE =
  /^\/(users\/authenticatebyname|users\/authenticatewithquickconnect|quickconnect\/authorize)$/i;
const IMAGE_LIKE =
  /^\/(items\/[^/]+\/images|persons\/[^/]+\/images|userimage|users\/[^/]+\/images|images\/general)(\/|$)/i;
const STREAM_LIKE = /^\/items\/[^/]+\/(playbackinfo|mediasources)$/i;
/* Routes whose bodies are worth revalidating rather than re-sending. */
const CACHEABLE =
  /^\/(items\/[^/]+\/images|persons\/[^/]+\/images|userimage|users\/[^/]+\/images|images\/general|videos\/)/i;

/** Stands in for the web client a real server hosts here. */
function landingPage(req: express.Request): string {
  const configure = `${req.protocol}://${req.get('host')}/stremio/configure`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AIOStreams for Jellyfin</title>
<style>
  body { font: 16px/1.6 system-ui, sans-serif; margin: 0; padding: 3rem 1.5rem;
         background: #101418; color: #e6e9ee; }
  main { max-width: 34rem; margin: 0 auto; }
  h1 { font-size: 1.3rem; margin: 0 0 1rem; }
  p { margin: 0 0 1rem; color: #aab3c0; }
  code { background: #1c2430; padding: .15rem .4rem; border-radius: .25rem; color: #e6e9ee; }
  a { color: #7aa7ff; }
</style>
</head>
<body>
<main>
  <h1>AIOStreams for Jellyfin</h1>
  <p>This address is a Jellyfin-compatible API, not a web client. Add
     <code>${req.protocol}://${req.get('host')}${req.baseUrl}</code> as a server
     in a Jellyfin app and sign in with your configuration UUID or alias.</p>
  <p>Streams are played directly, so nothing is transcoded here.</p>
  <p><a href="${configure}">Open the AIOStreams configuration page</a></p>
</main>
</body>
</html>`;
}

export function createJellyfinRouter(): Router {
  const router = express.Router({
    mergeParams: true,
    caseSensitive: false,
    strict: false,
  });

  router.use((_req, res, next) => {
    if (!appConfig.jellyfin.enabled) {
      res.status(404).json({ Message: 'Jellyfin API is disabled' });
      return;
    }
    next();
  });
  router.use(jellyfinCors);
  router.use(
    express.json({
      limit: '1mb',
      type: ['application/json', 'text/json', 'application/*+json'],
    })
  );
  router.use(express.urlencoded({ extended: false }));

  /* pre-authenticated mount, but the second segment is not an encrypted password */
  router.use((req, _res, next) => {
    const p = req.params as Record<string, string | undefined>;
    if (p.uuid && p.encryptedPassword && !isEncrypted(p.encryptedPassword)) {
      next('router');
      return;
    }
    next();
  });

  /* Jellyfin 12 dropped /emby, but stripping it costs nothing */
  router.use((req, _res, next) => {
    if (/^\/(emby|mediabrowser)(\/|$)/i.test(req.url)) {
      req.url = req.url.replace(/^\/(emby|mediabrowser)/i, '') || '/';
    }
    if (req.url.length > 1 && /\/(\?|$)/.test(req.url)) {
      req.url = req.url.replace(/\/(\?|$)/, '$1');
    }
    next();
  });

  /*
   * Express answers a repeat request with a bodyless 304 once it has sent an
   * ETag, and Jellyfin clients parse every response as JSON, so a client that
   * caches would see the server as unreachable.
   */
  router.use((req, res, next) => {
    if (!CACHEABLE.test(req.path)) {
      delete req.headers['if-none-match'];
      delete req.headers['if-modified-since'];
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });

  /*
   * Clients find the API base by resolving the address, truncating it at "/web"
   * and falling back to the bare origin when there is none, which would drop
   * the mount path. So the root redirects to /web, and /web answers rather than
   * redirecting onwards.
   */
  router.all('/', (req, res) => {
    res.redirect(302, `${req.baseUrl}/web/`);
  });
  router.all(['/web', '/web/index.html'], (req, res) => {
    res.type('html').send(landingPage(req));
  });

  router.use((req, res, next) => {
    if (UNLIMITED.test(req.path)) {
      next();
    } else if (LOGIN_LIKE.test(req.path) && !req.params.encryptedPassword) {
      jellyfinLoginRateLimiter(req, res, next);
    } else if (IMAGE_LIKE.test(req.path)) {
      jellyfinImageRateLimiter(req, res, next);
    } else if (STREAM_LIKE.test(req.path)) {
      stremioStreamRateLimiter(req, res, next);
    } else {
      jellyfinApiRateLimiter(req, res, next);
    }
  });

  /* The limiter throws, and the API's error shape is not one a client reads. */
  router.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (
        err instanceof APIError &&
        err.code === constants.ErrorCode.RATE_LIMIT_EXCEEDED
      ) {
        res
          .status(429)
          .json({ Message: 'Too many requests, please slow down' });
        return;
      }
      next(err);
    }
  );

  router.use(jellyfinContext);
  router.use(systemRouter);
  router.use(usersRouter);
  router.use(quickConnectRouter);
  router.use(playbackRouter);
  router.use(subtitlesRouter);
  router.use(imagesRouter);
  router.use(playstateRouter);
  router.use(libraryRouter);
  router.use(segmentsRouter);
  router.use(stubsRouter);
  router.use((req, res) => {
    res.status(404).json({
      Message: `Unsupported Jellyfin endpoint: ${req.method} ${req.path}`,
    });
  });
  return router;
}

export { attachJellyfinWebSocket } from './ws.js';
export { registerJellyfinTasks } from './tasks.js';
