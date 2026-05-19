import { Request, Response, NextFunction } from 'express';
import {
  createLogger,
  getTimeTakenSincePoint,
  makeUrlLogSafe,
} from '@aiostreams/core';

const logger = createLogger('http');

export const loggerMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const startTime = Date.now();

  const ip = req.userIp ?? undefined;
  const path = makeUrlLogSafe(req.originalUrl);

  logger.debug({ method: req.method, path, ip }, 'incoming request');

  res.on('finish', () => {
    const duration = getTimeTakenSincePoint(startTime);
    logger.debug(
      { method: req.method, path, status: res.statusCode, duration, ip },
      'request complete'
    );
  });

  next();
};
