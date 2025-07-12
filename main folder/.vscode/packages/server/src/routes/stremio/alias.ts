// looks at Env.ALIASED_CONFIGURATIONS and then redirects to /stremio/{uuid}/{encryptedPassword} after parsing the alias value

import { APIError, constants, createLogger, Env } from '@aiostreams/core';
import { Router, Request } from 'express';
import { createResponse } from '../../utils/responses';

const logger = createLogger('server');
const router = Router();

interface AliasParams {
  alias: string;
  [key: string]: string;
}

router.get('/:alias/*', (req: Request<AliasParams>, res) => {
  const { alias } = req.params;
  const wildcardPath = req.params[0] || '';

  const configuration = Env.ALIASED_CONFIGURATIONS[alias];
  if (!configuration || !configuration.uuid || !configuration.password) {
    throw new APIError(constants.ErrorCode.USER_NOT_FOUND);
  }

  const redirectPath = `/stremio/${configuration.uuid}/${configuration.password}${wildcardPath ? `/${wildcardPath}` : ''}`;
  logger.debug(`Redirecting alias ${alias} to ${redirectPath}`);

  res.redirect(redirectPath);
});

export default router;
