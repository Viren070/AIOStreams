import 'express';
import { UserData, SessionUser, type ClientInfo } from '@aiostreams/core';
import type { RateLimitInfo } from 'express-rate-limit';
import type { JellyfinRequestContext } from './routes/jellyfin/context.js';

declare global {
  namespace Express {
    interface Request {
      userData?: UserData;
      userIp?: string;
      requestIp?: string;
      uuid?: string;
      user?: SessionUser;
      rateLimit?: RateLimitInfo;
      jf?: JellyfinRequestContext;
      jfClient?: ClientInfo;
    }
  }
}
