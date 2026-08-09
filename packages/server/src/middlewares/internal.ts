import { Request, Response, NextFunction } from 'express';
import { createResponse } from '../utils/responses.js';
import { constants, appConfig } from '@aiostreams/core';

// browser-reachable builtin paths; each gates itself instead
const WHIELIST = [
  '/easynews/nzb',
  '/library/refresh',
  '/newznab/test',
  '/torznab/test',
  '/unarr-indexer/auth',
];

export const internalMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (WHIELIST.some((path) => req.path.startsWith(path))) {
    next();
    return;
  }
  const internalSecret = req.get(constants.INTERNAL_SECRET_HEADER);
  if (
    internalSecret !== appConfig.bootstrap.internalSecret &&
    appConfig.bootstrap.nodeEnv !== 'development'
  ) {
    res.status(403).json(
      createResponse({
        success: false,
        detail: 'Forbidden',
      })
    );
    return;
  }

  next();
};
