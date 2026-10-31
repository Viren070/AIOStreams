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

/**
 * Normalises hexadecimal or expanded IPv4-mapped IPv6 addresses
 * (e.g. `::ffff:a00:5` or `0:0:0:0:0:ffff:a00:5`) to `::ffff:a.b.c.d`.
 */
function normaliseMappedIpv4(ip: string): string | undefined {
  if (isIP(ip) !== 6) return undefined;
  const hex = ip
    .toLowerCase()
    .replace(
      /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
      (_, a: string, b: string, c: string, d: string) =>
        `${((+a << 8) | +b).toString(16)}:${((+c << 8) | +d).toString(16)}`
    );
  const [front, back] = hex.split('::');
  const head = front ? front.split(':') : [];
  const tail = back ? back.split(':') : [];
  const fill =
    back === undefined ? 0 : Math.max(0, 8 - head.length - tail.length);
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail].map((g) =>
    parseInt(g, 16)
  );
  if (
    groups.length !== 8 ||
    groups.slice(0, 5).some((g) => g !== 0) ||
    groups[5] !== 0xffff
  ) {
    return undefined;
  }
  return `::ffff:${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
}

/**
 * Checks whether an IPv4, IPv4-mapped IPv6, or IPv6 address belongs to a
 * private, loopback, or link-local range.
 */
export const isPrivateIp = (ip?: string) => {
  if (!ip) {
    return false;
  }
  const candidate = normaliseMappedIpv4(ip) ?? ip;
  return /^(?:(::ffff:)?(10\.|127\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.)|::1$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i.test(
    candidate
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
