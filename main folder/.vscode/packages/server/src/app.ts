import express, { Request, Response } from 'express';

import {
  userApi,
  healthApi,
  statusApi,
  formatApi,
  catalogApi,
} from './routes/api';
import {
  configure,
  manifest,
  stream,
  catalog,
  meta,
  subtitle,
  addonCatalog,
  alias,
} from './routes/stremio';

import {
  ipMiddleware,
  loggerMiddleware,
  userDataMiddleware,
  errorMiddleware,
  corsMiddleware,
  staticRateLimiter,
} from './middlewares';

import { constants, createLogger, Env } from '@aiostreams/core';
import { StremioTransformer } from '@aiostreams/core';
import { createResponse } from './utils/responses';
import path from 'path';
const app = express();
const logger = createLogger('server');

export const frontendRoot = path.join(__dirname, '../../frontend/out');

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

app.get(
  ['/_next/*', '/assets/*', '/favicon.ico', '/logo.png'],
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

app.get('/', (req, res) => {
  res.redirect('/stremio/configure');
});

// legacy route handlers
app.get('/:config?/stream/:type/:id.json', (req, res) => {
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
});
app.get('/:config?/configure', (req, res) => {
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
