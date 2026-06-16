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
import syncler from './routes/stremio/syncler.js';
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
stremioAuthRouter.use('/syncler', syncler);

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

// legacy route handlers
app.get(
  '{/:config}/stream/:type/:id.json',
  stremioStreamRateLimiter,
  (req, res) => {
    const baseUrl = appConfig.bootstrap.baseUrl!;
    res.json({
      streams: [
        StremioTransformer.createErrorStream({
          errorDescription:
            'AIOStreams v2 requires you to reconfigure. Please click this stream to reconfigure.',
          errorUrl: `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}/stremio/configure`,
        }),
      ],
    });
  }
);

// Syncler vendor package
app.get(['/syncler-vendor.json', '/syncler-provider.json'], corsMiddleware, (req, res) => {
  const baseUrl = appConfig.bootstrap.baseUrl!;
  
  res.json({
    name: "AIOStreams Vendor",
    description: "AIOStreams vendor package for Syncler.",
    tutorial: "https://github.com/Viren070/AIOStreams",
    support: "https://github.com/Viren070/AIOStreams/issues",
    website: "https://github.com/Viren070/AIOStreams",
    version: 1,
    packages: [
      {
        name: "AIOStreams",
        description: "AIOStreams Express package.",
        manifest: `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}/syncler/manifest2.json`,
        enabled: true
      },
      {
        name: "AIOStreams (Advanced Format)",
        description: "AIOStreams with dedicated metadata extraction and sorting tailored for Syncler UI.",
        manifest: `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}/syncler/manifest_advanced.json`,
        enabled: true
      }
    ],
    cacheServers: [],
    defaults: {
      packages: [
        `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}/syncler/manifest2.json`,
        `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}/syncler/manifest_advanced.json`
      ]
    }
  });
});

app.get(['/syncler/manifest.json', '/syncler/manifest2.json'], corsMiddleware, (req, res) => {
  const baseUrl = appConfig.bootstrap.baseUrl!;
  const domain = new URL(baseUrl).hostname;
  
  res.json({
    id: "com.aiostreams.syncler.express",
    name: "AIOStreams",
    description: "AIOStreams Express package.",
    version: 1,
    type: "express",
    url: `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}/syncler/express2.json`,
    accounts: [
      {
        alias: "aiostreams",
        branding: {
          name: "AIOStreams",
          website: `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}`
        },
        auth: {
          type: "token",
          allowedDomains: [
            domain
          ],
          inject: {
            query: {
              dummy_auth: "{managedAccounts.aiostreams.token}"
            }
          }
        },
        verification: {
          url: `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}/`,
          method: "GET",
          responseType: "text",
          extract: {
            username: {
              type: "regex",
              value: "<title>(.*?)</title>"
            }
          }
        }
      }
    ]
  });
});

app.get(['/syncler/manifest_advanced.json'], corsMiddleware, (req, res) => {
  const baseUrl = appConfig.bootstrap.baseUrl!;
  const domain = new URL(baseUrl).hostname;
  
  res.json({
    id: "com.aiostreams.syncler.express.advanced",
    name: "AIOStreams (Advanced Format)",
    description: "AIOStreams with dedicated Syncler formatting and UI badge extraction.",
    version: 1,
    type: "express",
    url: `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}/syncler/express_advanced.json`,
    accounts: [
      {
        alias: "aiostreams",
        branding: {
          name: "AIOStreams",
          website: `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}`
        },
        auth: {
          type: "token",
          allowedDomains: [
            domain
          ],
          inject: {
            query: {
              dummy_auth: "{managedAccounts.aiostreams.token}"
            }
          }
        },
        verification: {
          url: `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}/`,
          method: "GET",
          responseType: "text",
          extract: {
            username: {
              type: "regex",
              value: "<title>(.*?)</title>"
            }
          }
        }
      }
    ]
  });
});

app.get(['/syncler/express.json', '/syncler/express2.json'], corsMiddleware, (req, res) => {
  const baseUrl = appConfig.bootstrap.baseUrl!;
  
  res.json({
    aiostreams: {
      name: 'AIOStreams',
      enabled: true,
      languages: ['en'],
      base_url: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
      response_type: 'json',
      time_to_wait_between_each_request_ms: 300,
      time_to_wait_on_too_many_request_ms: 5000,
      movie: {
        query:
          'stremio/{managedAccounts.aiostreams.token}/stream/movie/{imdbId}.json',
        keywords: '{imdbId}',
      },
      episode: {
        query:
          'stremio/{managedAccounts.aiostreams.token}/stream/series/{showImdbId}:{season}:{episode}.json',
        keywords: '{showImdbId}:{season}:{episode}',
      },
      json_format: {
        results: 'streams',
        url: 'url',
        title: 'description',
        host: 'url',
        'host:ops': [
          {
            name: 'regex',
            params: ['^https?://([^/:]+)'],
          },
        ],
        size: 'description',
        'size:ops': [
          {
            name: 'regex',
            params: ['([0-9]+(?:\\.[0-9]+)?\\s*(?:MB|GB|TB))'],
          },
        ],
        playbackFileName: 'behaviorHints.filename',
        playbackFileSize: 'behaviorHints.videoSize',
      },
    },
  });
});

app.get(['/syncler/express_advanced.json'], corsMiddleware, (req, res) => {
  const baseUrl = appConfig.bootstrap.baseUrl!;
  
  res.json({
    aiostreams: {
      name: 'AIOStreams (Advanced Format)',
      enabled: true,
      languages: ['en'],
      base_url: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
      response_type: 'json',
      time_to_wait_between_each_request_ms: 300,
      time_to_wait_on_too_many_request_ms: 5000,
      movie: {
        query:
          'stremio/{managedAccounts.aiostreams.token}/syncler/stream/movie/{imdbId}.json',
        keywords: '{imdbId}',
      },
      episode: {
        query:
          'stremio/{managedAccounts.aiostreams.token}/syncler/stream/series/{showImdbId}:{season}:{episode}.json',
        keywords: '{showImdbId}:{season}:{episode}',
      },
      json_format: {
        results: 'streams',
        url: 'url',
        title: 'title',
        quality: 'quality',
        size: 'size',
        host: 'host',
        badge: 'badges'
      }
    }
  });
});

// redirect for legacy paths
app.get('{/:config}/configure', (req, res) => {
  res.redirect('/stremio/configure');
});

app.get('/configure', (req, res) => {
  res.redirect('/stremio/configure');
});

// SPA fallback.
app.get('*splat', staticRateLimiter, (req, res, next) => {
  if (req.method !== 'GET' || !req.accepts('html')) {
    next();
    return;
  }
  const indexPath = path.join(frontendRoot, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexPath);
    return;
  }
  next();
});

// Error handling middleware should be last
app.use(errorMiddleware);

export default app;
