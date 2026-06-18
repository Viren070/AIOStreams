import type { Request, Response, NextFunction } from 'express';
import {
  track,
  hmac,
  anonymizeIp,
  type AnalyticsResource,
} from '@aiostreams/core';

/**
 * Resource-level analytics: one event per Stremio resource request, carrying
 * the (hashed) config UUID for per-user analytics. The client IP is reduced to
 * an anonymised prefix (IPv4 first 3 octets / IPv6 first 3 hextets) before
 * storage — a full address is never read or persisted.
 */
export function trackResource(resource: AnalyticsResource) {
  return (req: Request, res: Response, next: NextFunction) => {
    const started = Date.now();
    res.on('finish', () => {
      const uuid = (req as { userData?: { uuid?: string } }).userData?.uuid;
      track({
        event_type: 'resource_request',
        resource,
        uuid_hash: uuid ? hmac(uuid) : null,
        status: res.statusCode >= 500 ? 'error' : 'ok',
        latency_ms: Date.now() - started,
        ip_prefix: anonymizeIp(req.requestIp),
      });
    });
    next();
  };
}
