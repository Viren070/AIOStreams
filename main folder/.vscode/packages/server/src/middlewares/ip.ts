import { Request, Response, NextFunction } from 'express';
import { createLogger } from '@aiostreams/core';

const logger = createLogger('server');

export const ipMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // extract IP from headers
  const ip =
    req.get('X-Client-IP') ||
    req.get('X-Forwarded-For')?.split(',')[0].trim() ||
    req.get('X-Real-IP') ||
    req.get('CF-Connecting-IP') ||
    req.get('True-Client-IP') ||
    req.get('X-Forwarded')?.split(',')[0].trim() ||
    req.get('Forwarded-For')?.split(',')[0].trim() ||
    req.ip;

  // attach IP to request object
  req.userIp = ip;

  next();
};
