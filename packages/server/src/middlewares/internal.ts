import { Request, Response, NextFunction } from 'express';
import { createResponse } from '../utils/responses.js';
import { constants, Env } from '@aiostreams/core';

const WHIELIST = ['/easynews/nzb', '/library/refresh'];

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
    internalSecret !== Env.INTERNAL_SECRET &&
    Env.NODE_ENV !== 'development'
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
