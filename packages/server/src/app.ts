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
import webdavRouter from './routes/webdav.js';
import { createNabRouter } from './routes/api/nab.js';
import {
  gdrive,
  torboxSearch,
  torznab,
  newznab,
  prowlarr,
  knaben,
  eztv,
  therarbg,
  thePirateBay,
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
builtinsRouter.use('/therarbg', therarbg);
builtinsRouter.use('/the-pirate-bay', thePirateBay);
builtinsRouter.use('/torrent-galaxy', torrentGalaxy);
builtinsRouter.use('/seadex', seadex);
builtinsRouter.use('/easynews', easynews);
builtinsRouter.use('/library', library);
app.use('/builtins', builtinsRouter);

app.use('/blocklist', publicBlocklistRouter);
app.use('/community', publicCommunityRouter);
app.use('/webdav', webdavRouter);

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
