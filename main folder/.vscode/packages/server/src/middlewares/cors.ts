import { Request, Response, NextFunction } from 'express';
import { createLogger } from '@aiostreams/core';

const logger = createLogger('server');

export const corsMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
};
