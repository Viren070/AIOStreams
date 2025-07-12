import 'express';
import { UserData } from '../db';

declare global {
  namespace Express {
    interface Request {
      userData?: UserData;
      userIp?: string;
      uuid?: string;
    }
  }
}
