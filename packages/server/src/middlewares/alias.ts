import { Request, Response, NextFunction } from 'express';
import { Env } from '@aiostreams/core';

// Resolves alias to UUID for user API routes.
// If the provided value is not a UUID and matches a known alias, replaces it with the real UUID.
export function resolveUuidAliasForUserApi(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const uuidRegex =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

  const method = req.method.toUpperCase();

  if (method === 'GET' || method === 'HEAD') {
    const value = req.query.uuid;
    if (typeof value === 'string' && !uuidRegex.test(value)) {
      const configuration = Env.ALIASED_CONFIGURATIONS.get(value);
      if (configuration?.uuid) {
        req.uuid = configuration?.uuid;
      }
    }
  } else if (method === 'PUT' || method === 'DELETE' || method === 'POST') {
    // POST is included for /api/v1/user/load (and incidentally /verify,
    // /password) so aliases work there too. POST /api/v1/user (create)
    // has no `uuid` in the body so the lookup below no-ops.
    const value = (req.body ?? {}).uuid;
    if (typeof value === 'string' && !uuidRegex.test(value)) {
      const configuration = Env.ALIASED_CONFIGURATIONS.get(value);
      if (configuration?.uuid) {
        req.uuid = configuration.uuid;
      }
    }
  }

  next();
}
