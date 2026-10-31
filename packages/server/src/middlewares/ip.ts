import { Request, Response, NextFunction } from 'express';
import { config as appConfig, createLogger } from '@aiostreams/core';
import proxyaddr from 'proxy-addr';
import { isIP } from 'net';

const logger = createLogger('server');

// Helper function to validate if a string is a valid IP address
function isValidIp(ip: string | undefined): boolean {
  if (!ip) return false;
  // isIP returns 4 for IPv4, 6 for IPv6, and 0 for invalid
  return isIP(ip) !== 0;
}

let compiledFor: readonly string[] | undefined;
let compiledTrust: (addr: string, i: number) => boolean = () => false;

/**
 * Whether a socket peer is one of `trustedIps`.
 */
export function isTrustedIp(addr: string | undefined): boolean {
  if (!addr) return false;
  const list = appConfig.api.trustedIps;
  if (list !== compiledFor) {
    const valid = list.filter((entry) => {
      try {
        proxyaddr.compile([entry]);
        return true;
      } catch {
        logger.warn({ entry }, 'ignoring unparseable trusted IP entry');
        return false;
      }
    });
    compiledTrust = proxyaddr.compile(valid);
    compiledFor = list;
  }
  return compiledTrust(addr, 0);
}

export const isPrivateIp = (ip?: string) => {
  if (!ip) {
    return false;
  }
  return /^(?:(::ffff:)?(10\.|127\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.)|::1$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i.test(
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
      req.get('X-AIOStreams-User-IP') ||
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
  const requestIp = req.ip;
  req.userIp = isPrivateIp(userIp) || !isValidIp(userIp) ? undefined : userIp;
  req.requestIp = isValidIp(requestIp) ? requestIp : undefined;
  next();
};
