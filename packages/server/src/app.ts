import express, { Express } from 'express';
import {
  userApi,
  profilesApi,
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
  linkedAccountsApi,
  authApi,
  dashboardApi,
  usenetApi,
  communityApi,
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
import sabnzbdRouter from './routes/api/sabnzbd.js';
import publicBlocklistRouter from './routes/blocklist.js';
import publicCommunityRouter from './routes/community.js';
import { createNabRouter } from './routes/api/nab.js';
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
  linkedAccountsRateLimiter,
  communityApiRateLimiter,
  internalMiddleware,
  stremioStreamRateLimiter,
  stremioManifestRateLimiter,
  stremioMetaRateLimiter,
  stremioCatalogRateLimiter,
  stremioSubtitleRateLimiter,
  requireSessionIfAuthRequired,
} from './middlewares/index.js';
import { isTrustedIp } from './middlewares/ip.js';

import {
  config as appConfig,
  constants,
  createLogger,
  Env,
  VARIANT_PATH_ROUTE,
} from '@aiostreams/core';
import { StremioTransformer } from '@aiostreams/core';
import { createResponse } from './utils/responses.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const app: Express = express();
app.set('trust proxy', (addr: string) => isTrustedIp(addr));
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

/**
 * Map a DebridError code to the fallback video served in its place. Playback
 * endpoints answer a player, so a failure has to be watchable to be legible.
 */
export function mapDebridErrorToStaticFile(code: string | undefined): string {
  switch (code) {
    case 'UNAVAILABLE_FOR_LEGAL_REASONS':
      return StaticFiles.UNAVAILABLE_FOR_LEGAL_REASONS;
    case 'STORE_LIMIT_EXCEEDED':
      return StaticFiles.STORE_LIMIT_EXCEEDED;
    case 'PAYMENT_REQUIRED':
      return StaticFiles.PAYMENT_REQUIRED;
    case 'TOO_MANY_ACTIVE_CONNECTIONS':
      return StaticFiles.CONTENT_PROXY_LIMIT_REACHED;
    case 'TOO_MANY_REQUESTS':
      return StaticFiles.TOO_MANY_REQUESTS;
    case 'FORBIDDEN':
      return StaticFiles.FORBIDDEN;
    case 'UNAUTHORIZED':
      return StaticFiles.UNAUTHORIZED;
    case 'UNPROCESSABLE_ENTITY':
    case 'UNSUPPORTED_MEDIA_TYPE':
    case 'STORE_MAGNET_INVALID':
    case 'DOWNLOAD_FAILED':
    case 'BAD_GATEWAY':
    case 'GONE':
      return StaticFiles.DOWNLOAD_FAILED;
    case 'NO_MATCHING_FILE':
      return StaticFiles.NO_MATCHING_FILE;
    case 'SERVICE_UNAVAILABLE':
      return StaticFiles.DOWNLOAD_FAILED;
    case 'TIMEOUT':
      return StaticFiles.DOWNLOADING;
    default:
      return StaticFiles.INTERNAL_SERVER_ERROR;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const frontendRoot = path.join(__dirname, '../../frontend/dist');
export const staticRoot = path.join(__dirname, './static');

app.use(ipMiddleware);
app.use(loggerMiddleware);
// Built on the first request: runtime settings are not loaded at module load.
let jsonParser: express.RequestHandler | undefined;
app.use((req, res, next) => {
  jsonParser ??= express.json({ limit: appConfig.api.maxJsonBodySize });
  jsonParser(req, res, next);
});
app.use(express.urlencoded({ extended: true }));

// Allow all origins in development for easier testing
if (appConfig.bootstrap.nodeEnv === 'development') {
  logger.info('CORS enabled for all origins in development');
  app.use(corsMiddleware);
}

// API Routes
const apiRouter = express.Router();
apiRouter.use('/user', userApi);
apiRouter.use('/profiles', profilesApi);
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
apiRouter.use('/linked-accounts', linkedAccountsRateLimiter, linkedAccountsApi);
apiRouter.use('/community', communityApiRateLimiter, communityApi);
apiRouter.use('/auth', authApi);
apiRouter.use('/dashboard', dashboardApi);
apiRouter.use('/usenet', usenetApi);
apiRouter.use('/sabnzbd', sabnzbdRouter);
apiRouter.use('/newznab', createNabRouter('newznab'));
apiRouter.use('/torznab', createNabRouter('torznab'));
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
stremioRouter.use('/manifest.json', stremioManifestRateLimiter, manifest);
stremioRouter.use('/stream', stremioStreamRateLimiter, stream);
stremioRouter.use('/configure', requireSessionIfAuthRequired, configure);

stremioRouter.use('/u', alias);

// Protected routes with authentication
const stremioAuthRouter = express.Router({ mergeParams: true });
stremioAuthRouter.use(corsMiddleware);
stremioAuthRouter.use('/manifest.json', stremioManifestRateLimiter);
stremioAuthRouter.use('/stream', stremioStreamRateLimiter);
stremioAuthRouter.use('/meta', stremioMetaRateLimiter);
stremioAuthRouter.use('/catalog', stremioCatalogRateLimiter);
stremioAuthRouter.use('/subtitles', stremioSubtitleRateLimiter);
stremioAuthRouter.use(userDataMiddleware);
stremioAuthRouter.use('/manifest.json', manifest);
stremioAuthRouter.use('/stream', stream);
stremioAuthRouter.use('/configure', requireSessionIfAuthRequired, configure);
stremioAuthRouter.use('/meta', meta);
stremioAuthRouter.use('/catalog', catalog);
stremioAuthRouter.use('/subtitles', subtitle);
stremioAuthRouter.use('/addon_catalog', addonCatalog);

app.use('/stremio', stremioRouter); // For public routes

app.use(
  `/stremio/:uuid/:encryptedPassword${VARIANT_PATH_ROUTE}`,
  stremioAuthRouter
);
app.use('/stremio/:uuid/:encryptedPassword', stremioAuthRouter); // For authenticated routes

const chillLinkRouter = express.Router({ mergeParams: true });
chillLinkRouter.use(corsMiddleware);
chillLinkRouter.use('/manifest', stremioManifestRateLimiter);
chillLinkRouter.use('/streams', stremioStreamRateLimiter);
chillLinkRouter.use(userDataMiddleware);
chillLinkRouter.use('/manifest', chillLinkManifest);
chillLinkRouter.use('/streams', chillLinkStreams);

app.use(
  `/chilllink/:uuid/:encryptedPassword${VARIANT_PATH_ROUTE}`,
  chillLinkRouter
);
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

app.use('/blocklist', publicBlocklistRouter);
app.use('/community', publicCommunityRouter);

// Content-hashed build assets. These filenames change on every content
// change, so they are immutable and safe to cache aggressively. Deliberately
// NOT behind staticRateLimiter: a single page load pulls many of these and
// rate-limiting them is what caused asset fetch failures + the logo flash.
app.use(
  '/assets',
  express.static(path.join(frontendRoot, 'assets'), {
    immutable: true,
    maxAge: '1y',
  })
);

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
  express.static(frontendRoot, { index: false, maxAge: '1h' })
);

app.use('/static', corsMiddleware, express.static(staticRoot));

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
