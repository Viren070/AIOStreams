import express, { Request, Response, Express } from 'express';
import {
  userApi,
  healthApi,
  statusApi,
  formatApi,
  catalogApi,
  postersApi,
  gdriveApi,
  debridApi,
  searchApi,
  animeApi,
  proxyApi,
  templatesApi,
  syncApi,
  authApi,
  dashboardApi,
} from './routes/api/index.js';
import {
  configure,
  manifest,
  stream,
  catalog,
  meta,
  subtitle,
  addonCatalog,
  alias,
} from './routes/stremio/index.js';
import {
  manifest as chillLinkManifest,
  streams as chillLinkStreams,
} from './routes/chilllink/index.js';
import seanimeExtensionsRouter from './routes/seanime/extensions.js';
import {
  gdrive,
  torboxSearch,
  torznab,
  newznab,
  prowlarr,
  knaben,
  eztv,
  torrentGalaxy,
  seadex,
  easynews,
  library,
} from './routes/builtins/index.js';
import {
  ipMiddleware,
  loggerMiddleware,
  userDataMiddleware,
  errorMiddleware,
  corsMiddleware,
  staticRateLimiter,
  internalMiddleware,
  stremioStreamRateLimiter,
  requireSessionIfAuthRequired,
} from './middlewares/index.js';

import {
  config as appConfig,
  constants,
  createLogger,
  Env,
} from '@aiostreams/core';
import { StremioTransformer } from '@aiostreams/core';
import { createResponse } from './utils/responses.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const app: Express = express();
const logger = createLogger('server');

export enum StaticFiles {
  DOWNLOAD_FAILED = 'download_failed.mp4',
  DOWNLOADING = 'downloading.mp4',
  UNAVAILABLE_FOR_LEGAL_REASONS = 'unavailable_for_legal_reasons.mp4',
  STORE_LIMIT_EXCEEDED = 'store_limit_exceeded.mp4',
  CONTENT_PROXY_LIMIT_REACHED = 'content_proxy_limit_reached.mp4',
  INTERNAL_SERVER_ERROR = '500.mp4',
  TOO_MANY_REQUESTS = '429.mp4',
  FORBIDDEN = '403.mp4',
  UNAUTHORIZED = '401.mp4',
  NO_MATCHING_FILE = 'no_matching_file.mp4',
  PAYMENT_REQUIRED = 'payment_required.mp4',
  OK = '200.mp4',
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const frontendRoot = path.join(__dirname, '../../frontend/dist');
export const staticRoot = path.join(__dirname, './static');

app.use(ipMiddleware);
app.use(loggerMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Allow all origins in development for easier testing
if (appConfig.bootstrap.nodeEnv === 'development') {
  logger.info('CORS enabled for all origins in development');
  app.use(corsMiddleware);
}

// API Routes
const apiRouter = express.Router();
apiRouter.use('/user', userApi);
apiRouter.use('/health', healthApi);
apiRouter.use('/status', statusApi);
apiRouter.use('/format', formatApi);
apiRouter.use('/catalogs', catalogApi);
apiRouter.use('/posters', postersApi);
apiRouter.use('/oauth/exchange/gdrive', gdriveApi);
apiRouter.use('/debrid', debridApi);
apiRouter.use(
  '/search',
  (req, res, next) => {
    if (!appConfig.api.enableSearchApi) {
      res.status(403).json({ error: 'Search API is disabled', success: false });
      return;
    }
    next();
  },
  searchApi
);
apiRouter.use('/anime', animeApi);
apiRouter.use('/proxy', proxyApi);
apiRouter.use('/templates', templatesApi);
apiRouter.use('/sync', syncApi);
apiRouter.use('/auth', authApi);
apiRouter.use('/dashboard', dashboardApi);
apiRouter.use((req, res) => {
  res.status(404).json(
    createResponse({
      success: false,
      detail: 'Not Found',
    })
  );
});

app.use(`/api/v${constants.API_VERSION}`, apiRouter);

// Stremio Routes
const stremioRouter = express.Router({ mergeParams: true });
stremioRouter.use(corsMiddleware);
// Public routes - no auth needed
stremioRouter.use('/manifest.json', manifest);
stremioRouter.use('/stream', stream);
stremioRouter.use('/configure', requireSessionIfAuthRequired, configure);

stremioRouter.use('/u', alias);

// Protected routes with authentication
const stremioAuthRouter = express.Router({ mergeParams: true });
stremioAuthRouter.use(corsMiddleware);
stremioAuthRouter.use(userDataMiddleware);
stremioAuthRouter.use('/manifest.json', manifest);
stremioAuthRouter.use('/stream', stream);
stremioAuthRouter.use('/configure', requireSessionIfAuthRequired, configure);
stremioAuthRouter.use('/meta', meta);
stremioAuthRouter.use('/catalog', catalog);
stremioAuthRouter.use('/subtitles', subtitle);
stremioAuthRouter.use('/addon_catalog', addonCatalog);

app.use('/stremio', stremioRouter); // For public routes
app.use('/stremio/:uuid/:encryptedPassword', stremioAuthRouter); // For authenticated routes

const chillLinkRouter = express.Router({ mergeParams: true });
chillLinkRouter.use(corsMiddleware);
chillLinkRouter.use(userDataMiddleware);
chillLinkRouter.use('/manifest', chillLinkManifest);
chillLinkRouter.use('/streams', chillLinkStreams);

app.use('/chilllink/:uuid/:encryptedPassword', chillLinkRouter);

const seanimeRouter = express.Router({ mergeParams: true });
seanimeRouter.use(corsMiddleware);
seanimeRouter.use(seanimeExtensionsRouter);

app.use('/seanime', seanimeRouter);

const builtinsRouter = express.Router();
builtinsRouter.use(internalMiddleware);
builtinsRouter.use('/gdrive', gdrive);
builtinsRouter.use('/torbox-search', torboxSearch);
builtinsRouter.use('/torznab', torznab);
builtinsRouter.use('/newznab', newznab);
builtinsRouter.use('/prowlarr', prowlarr);
builtinsRouter.use('/knaben', knaben);
builtinsRouter.use('/eztv', eztv);
builtinsRouter.use('/torrent-galaxy', torrentGalaxy);
builtinsRouter.use('/seadex', seadex);
builtinsRouter.use('/easynews', easynews);
builtinsRouter.use('/library', library);
app.use('/builtins', builtinsRouter);

// Content-hashed build assets. These filenames change on every content
// change, so they are immutable and safe to cache aggressively. Deliberately
// NOT behind staticRateLimiter: a single page load pulls many of these and
// rate-limiting them is what caused asset fetch failures + the logo flash.
app.get('/assets/*any', (req, res, next) => {
  const filePath = path.resolve(frontendRoot, req.path.replace(/^\//, ''));
  if (filePath.startsWith(frontendRoot) && fs.existsSync(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(filePath);
    return;
  }
  next();
});

// Root-level static files (not content-hashed). Short cache; kept behind the
// static rate limiter. The logo honours the alternate-design branding flag.
app.get('/logo.png', staticRateLimiter, (req, res, next) => {
  const filePath = path.resolve(
    frontendRoot,
    appConfig.branding.alternateDesign ? 'logo_alt.png' : 'logo.png'
  );
  if (filePath.startsWith(frontendRoot) && fs.existsSync(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(filePath);
    return;
  }
  next();
});
app.get(
  [
    '/favicon.ico',
    '/manifest.json',
    '/web-app-manifest-192x192.png',
    '/web-app-manifest-512x512.png',
    '/apple-icon.png',
    '/mini-nightly-white.png',
    '/mini-stable-white.png',
    '/icon0.svg',
    '/icon1.png',
    '/logo_alt.png',
  ],
  staticRateLimiter,
  (req, res, next) => {
    const filePath = path.resolve(frontendRoot, req.path.replace(/^\//, ''));
    if (filePath.startsWith(frontendRoot) && fs.existsSync(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.sendFile(filePath);
      return;
    }
    next();
  }
);

app.get('/static/*any', corsMiddleware, (req, res, next) => {
  const filePath = path.resolve(
    staticRoot,
    req.path.replace(/^\/static\//, '')
  );
  logger.debug(`Static file requested: ${filePath}`);
  if (filePath.startsWith(staticRoot) && fs.existsSync(filePath)) {
    res.sendFile(filePath);
    return;
  }
  next();
});

// Infuse-mode subtitle proxy. Serves an upstream provider subtitle from this
// addon's own host/cert (reachable by the Apple TV), normalising the
// content-type. Path: /infuse-sub/<payload>/<name>-<lang>.srt
//   - payload: base64url(JSON array of candidate upstream URLs, priority order)
//   - the trailing <name>-<lang>.srt is read by Infuse to label the track and
//     needs the .srt extension; the server only uses <payload>.
// Serves the FIRST candidate that fetches OK (transparent fallback). Public +
// CORS so Infuse can fetch it.
app.get(
  /^\/infuse-sub\/([A-Za-z0-9_-]+)\/[^/]+\.srt$/,
  corsMiddleware,
  async (req, res) => {
    try {
      const encoded = (req.params as unknown as string[])[0];
      const decoded = Buffer.from(encoded, 'base64url').toString('utf-8');
      let candidates: string[];
      try {
        const parsed = JSON.parse(decoded);
        candidates = Array.isArray(parsed) ? parsed : [String(parsed)];
      } catch {
        candidates = [decoded]; // tolerate a plain (non-JSON) URL
      }
      candidates = candidates.filter((u) => /^https?:\/\//i.test(u));
      if (candidates.length === 0) {
        res.status(400).send('no valid subtitle url');
        return;
      }
      const title = typeof req.query.t === 'string' ? req.query.t : undefined;
      const SUB_TIMEOUT_MS = 10_000;
      const SUB_MAX_BYTES = 5_000_000; // subtitles are tiny; guard against huge/hanging upstreams
      for (let i = 0; i < candidates.length; i++) {
        const upstream = candidates[i];
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SUB_TIMEOUT_MS);
        try {
          const upstreamRes = await fetch(upstream, {
            redirect: 'follow',
            signal: controller.signal,
          });
          if (upstreamRes.ok) {
            const declared = Number(
              upstreamRes.headers.get('content-length') || 0
            );
            if (declared > SUB_MAX_BYTES) {
              logger.warn(
                `infuse-sub: subtitle too large (${declared} bytes) for ${upstream}`
              );
              continue;
            }
            const buf = Buffer.from(await upstreamRes.arrayBuffer());
            if (buf.length > SUB_MAX_BYTES) {
              logger.warn(
                `infuse-sub: subtitle too large (${buf.length} bytes) for ${upstream}`
              );
              continue;
            }
            res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.send(buf);
            logger.info(
              `infuse-sub served: movie=${title ?? 'unknown'} | candidate ${i + 1}/${candidates.length} | url=${upstream}`
            );
            return;
          }
          logger.warn(`infuse-sub: ${upstreamRes.status} for ${upstream}`);
        } catch (e) {
          logger.warn(
            `infuse-sub: fetch failed for ${upstream}: ${e instanceof Error ? e.message : String(e)}`
          );
        } finally {
          clearTimeout(timeoutId);
        }
      }
      res.status(502).send('all subtitle candidates failed');
    } catch (error) {
      logger.error(
        `infuse-sub error: ${error instanceof Error ? error.message : String(error)}`
      );
      res.status(500).send('subtitle proxy error');
    }
  }
);

// legacy route handlers
app.get(
  '{/:config}/stream/:type/:id.json',
  stremioStreamRateLimiter,
  (req, res) => {
    const baseUrl =
      appConfig.bootstrap.baseUrl ||
      `${req.protocol}://${req.hostname}${
        req.hostname === 'localhost' ? `:${appConfig.bootstrap.port}` : ''
      }`;
    res.json({
      streams: [
        StremioTransformer.createErrorStream({
          errorDescription:
            'AIOStreams v2 requires you to reconfigure. Please click this stream to reconfigure.',
          errorUrl: `${baseUrl}/stremio/configure`,
        }),
      ],
    });
  }
);

// redirect for legacy paths
app.get('{/:config}/configure', (req, res) => {
  res.redirect('/stremio/configure');
});

app.get('/configure', (req, res) => {
  res.redirect('/stremio/configure');
});

// SPA route validation: returns true for paths that exist in the client-side router.
const SPA_STATIC_ROUTES = [
  '/',
  '/login',
  '/oauth/callback/gdrive',
  '/splashscreen',
  '/stremio/configure',
];

const SPA_DYNAMIC_PATTERNS: RegExp[] = [
  /^\/stremio\/[^/]+\/[^/]+\/configure$/,
  /^\/dashboard(\/.*)?$/,
];

function isValidSpaRoute(routePath: string): boolean {
  if (SPA_STATIC_ROUTES.includes(routePath)) {
    return true;
  }
  return SPA_DYNAMIC_PATTERNS.some((pattern) => pattern.test(routePath));
}

// SPA fallback.
app.get('*splat', staticRateLimiter, (req, res, next) => {
  if (req.method !== 'GET' || !req.accepts('html')) {
    next();
    return;
  }
  const indexPath = path.join(frontendRoot, 'index.html');
  if (fs.existsSync(indexPath)) {
    const status = isValidSpaRoute(req.path) ? 200 : 404;
    res
      .status(status)
      .setHeader('Cache-Control', 'no-cache')
      .sendFile(indexPath);
    return;
  }
  next();
});

// Error handling middleware should be last
app.use(errorMiddleware);

export default app;
