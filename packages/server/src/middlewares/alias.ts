import { Request, Response, NextFunction } from 'express';
import { config as appConfig } from '@aiostreams/core';

const uuidRegex =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function extractUsernameFromBasicAuth(req: Request): string | undefined {
  const header = req.headers['authorization'];
  if (typeof header !== 'string' || !header.startsWith('Basic ')) {
    return undefined;
  }
  try {
    const decoded = Buffer.from(
      header.slice('Basic '.length).trim(),
      'base64'
    ).toString('utf-8');
    const sepIndex = decoded.indexOf(':');
    if (sepIndex === -1) return undefined;
    const username = decoded.slice(0, sepIndex);
    return username || undefined;
  } catch {
    return undefined;
  }
}

// Resolves alias to UUID for user API routes.
// If the provided value is not a UUID and matches a known alias, replaces it with the real UUID.
export function resolveUuidAliasForUserApi(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Authorization header is the primary source for authenticated routes.
  const headerValue = extractUsernameFromBasicAuth(req);
  if (headerValue && !uuidRegex.test(headerValue)) {
    const configuration = appConfig.api.aliasedConfigurations[headerValue];
    if (configuration?.uuid) {
      req.uuid = configuration.uuid;
    }
  }

  // HEAD `/user` uses `?uuid=` for the existence probe (no creds required).
  if (!req.uuid && req.method.toUpperCase() === 'HEAD') {
    const value = req.query.uuid;
    if (typeof value === 'string' && !uuidRegex.test(value)) {
      const configuration = appConfig.api.aliasedConfigurations[value];
      if (configuration?.uuid) {
        req.uuid = configuration.uuid;
      }
    }
  }

  next();
}
