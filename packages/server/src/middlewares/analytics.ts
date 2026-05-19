import type { Request, Response, NextFunction } from 'express';
import { track, hmac, type AnalyticsResource } from '@aiostreams/core';

/**
 * Resource-level analytics: one event per Stremio resource request, carrying
 * the (hashed) config UUID for per-user analytics. Per-addon attribution is
 * emitted separately from the core wrapper. No IP is read or stored.
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
      });
    });
    next();
  };
}
