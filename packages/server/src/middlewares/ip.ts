import { Request, Response, NextFunction } from 'express';
import { config as appConfig, createLogger } from '@aiostreams/core';
import { isIP } from 'net';

const logger = createLogger('server');

// Helper function to validate if a string is a valid IP address
function isValidIp(ip: string | undefined): boolean {
  if (!ip) return false;
  // isIP returns 4 for IPv4, 6 for IPv6, and 0 for invalid
  return isIP(ip) !== 0;
}

const isIpInRange = (ip: string, range: string) => {
  if (range.includes('/')) {
    // CIDR notation
    const [rangeIp, prefixLength] = range.split('/');
    const ipToLong = (ip: string) =>
      ip
        .split('.')
        .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
    try {
      const ipLong = ipToLong(ip);
      const rangeLong = ipToLong(rangeIp);
      const mask = ~(2 ** (32 - parseInt(prefixLength, 10)) - 1) >>> 0;
      return (ipLong & mask) === (rangeLong & mask);
    } catch {
      return false;
    }
  }
  // Exact match
  return ip === range;
};

const isPrivateIp = (ip?: string) => {
  if (!ip) {
    return false;
  }
  return /^(10\.|(::ffff:)?127\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|::1)/.test(
    ip
  );
};

export const ipMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const getIpFromHeaders = (req: Request) => {
    return (
      req.get('X-Client-IP') ||
      req.get('X-Forwarded-For')?.split(',')[0].trim() ||
      req.get('X-Real-IP') ||
      req.get('CF-Connecting-IP') ||
      req.get('True-Client-IP') ||
      req.get('X-Forwarded')?.split(',')[0].trim() ||
      req.get('Forwarded-For')?.split(',')[0].trim() ||
      req.ip
    );
  };

  const userIp = getIpFromHeaders(req);
  const ip = req.ip || '';
  const trustedIps = appConfig.api.trustedIps;

  const isTrustedIp = trustedIps.some((range) => isIpInRange(ip, range));
  const requestIp = isTrustedIp
    ? req.get('X-Forwarded-For')?.split(',')[0].trim() ||
      req.get('CF-Connecting-IP') ||
      ip
    : ip;
  req.userIp = isPrivateIp(userIp) || !isValidIp(userIp) ? undefined : userIp;
  req.requestIp = isValidIp(requestIp) ? requestIp : undefined;
  next();
};
