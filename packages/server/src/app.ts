import express, { Request, Response, Express } from 'express';
import {
  userApi,
  healthApi,
  statusApi,
  formatApi,
  catalogApi,
  rpdbApi,
  gdriveApi,
  debridApi,
  searchApi,
  animeApi,
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
  gdrive,
  torboxSearch,
  torznab,
  newznab,
  prowlarr,
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
} from './middlewares/index.js';

import { constants, createLogger, Env } from '@aiostreams/core';
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
  CONTENT_PROXY_LIMIT_REACHED = 'content_proxy_limit_reached.mp4',
  INTERNAL_SERVER_ERROR = '500.mp4',
  FORBIDDEN = '403.mp4',
  UNAUTHORIZED = '401.mp4',
  NO_MATCHING_FILE = 'no_matching_file.mp4',
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const frontendRoot = path.join(__dirname, '../../frontend/out');
export const staticRoot = path.join(__dirname, './static');

app.use(ipMiddleware);
app.use(loggerMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Allow all origins in development for easier testing
if (Env.NODE_ENV === 'development') {
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
apiRouter.use('/rpdb', rpdbApi);
apiRouter.use('/oauth/exchange/gdrive', gdriveApi);
apiRouter.use('/debrid', debridApi);
if (Env.ENABLE_SEARCH_API) {
  apiRouter.use('/search', searchApi);
}
apiRouter.use('/anime', animeApi);
app.use(`/api/v${constants.API_VERSION}`, apiRouter);

// Stremio Routes
const stremioRouter = express.Router({ mergeParams: true });
stremioRouter.use(corsMiddleware);
// Public routes - no auth needed
stremioRouter.use('/manifest.json', manifest);
stremioRouter.use('/stream', stream);
stremioRouter.use('/configure', configure);
stremioRouter.use('/configure.txt', (req, res) => {
  res.sendFile(path.join(frontendRoot, 'index.txt'));
});

stremioRouter.use('/u', alias);

// Protected routes with authentication
const stremioAuthRouter = express.Router({ mergeParams: true });
stremioAuthRouter.use(corsMiddleware);
stremioAuthRouter.use(userDataMiddleware);
stremioAuthRouter.use('/manifest.json', manifest);
stremioAuthRouter.use('/stream', stream);
stremioAuthRouter.use('/configure', configure);
stremioAuthRouter.use('/configure.txt', staticRateLimiter, (req, res) => {
  res.sendFile(path.join(frontendRoot, 'index.txt'));
});
stremioAuthRouter.use('/meta', meta);
stremioAuthRouter.use('/catalog', catalog);
stremioAuthRouter.use('/subtitles', subtitle);
stremioAuthRouter.use('/addon_catalog', addonCatalog);

app.use('/stremio', stremioRouter); // For public routes
app.use('/stremio/:uuid/:encryptedPassword', stremioAuthRouter); // For authenticated routes

const builtinsRouter = express.Router();
builtinsRouter.use(internalMiddleware);
builtinsRouter.use('/gdrive', gdrive);
builtinsRouter.use('/torbox-search', torboxSearch);
builtinsRouter.use('/torznab', torznab);
builtinsRouter.use('/newznab', newznab);
builtinsRouter.use('/prowlarr', prowlarr);
app.use('/builtins', builtinsRouter);

app.get(
  ['/_next/*any', '/assets/*any', '/favicon.ico', '/logo.png'],
  staticRateLimiter,
  (req, res, next) => {
    const filePath = path.resolve(frontendRoot, req.path.replace(/^\//, ''));
    if (filePath.startsWith(frontendRoot)) {
      res.sendFile(filePath);
      return;
    }
    next();
  }
);

app.get('/static/*any', (req, res, next) => {
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

app.get('/oauth/callback/gdrive', (req, res) => {
  res.sendFile(path.join(frontendRoot, 'oauth/callback/gdrive.html'));
});
app.get('/', (req, res) => {
  res.redirect('/stremio/configure');
});

// legacy route handlers
app.get(
  '{/:config}/stream/:type/:id.json',
  stremioStreamRateLimiter,
  (req, res) => {
    const baseUrl =
      Env.BASE_URL ||
      `${req.protocol}://${req.hostname}${
        req.hostname === 'localhost' ? `:${Env.PORT}` : ''
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
app.get('{/:config}/configure', (req, res) => {
  res.redirect('/stremio/configure');
});

// 404 handler
app.use((req, res) => {
  res.status(404).json(
    createResponse({
      success: false,
      detail: 'Not Found',
    })
  );
});

// Error handling middleware should be last
app.use(errorMiddleware);

export default app;
