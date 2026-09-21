import { Router, type Response } from 'express';
import { handleWebdav } from '@viren070/fsmux';
import {
  createLogger,
  config as appConfig,
  checkAuthToken,
  Permission,
  shareFilesystem,
} from '@aiostreams/core';
import { parseBasicAuthHeader } from '../utils/basic-auth.js';

const logger = createLogger('server:webdav');
const router: Router = Router();

const REALM = 'AIOStreams WebDAV';

function unauthorized(res: Response): void {
  res.setHeader('WWW-Authenticate', `Basic realm="${REALM}"`);
  res.status(401).type('text/plain').send('Unauthorized');
}

/**
 * Read-only WebDAV over the share tree (the usenet library today). Basic
 * auth with an `AIOSTREAMS_AUTH` user holding the `webdav` permission; every
 * request below the mount terminates here so nothing falls through to the
 * SPA.
 */
router.use((req, res, next) => {
  if (!appConfig.shares.webdav.enabled) {
    res.status(404).type('text/plain').send('WebDAV is disabled');
    return;
  }
  let credentials: ReturnType<typeof parseBasicAuthHeader>;
  try {
    credentials = parseBasicAuthHeader(req, { allowEncrypted: false });
  } catch {
    unauthorized(res);
    return;
  }
  if (!credentials) {
    unauthorized(res);
    return;
  }
  const check = checkAuthToken(
    `${credentials.uuid}:${credentials.password}`,
    Permission.Webdav
  );
  if (!check.ok) {
    logger.warn(
      { username: credentials.uuid, reason: check.reason },
      'webdav login refused'
    );
    unauthorized(res);
    return;
  }
  res.locals.davOwner = check.username;
  next();
});

router.all('/{*splat}', async (req, res, next) => {
  const clientIp = req.requestIp || req.ip || req.socket.remoteAddress;
  try {
    await handleWebdav(req, res, {
      fs: shareFilesystem({
        owner: String(res.locals.davOwner ?? ''),
        clientIp,
        scope: 'library',
      }),
      base: req.baseUrl,
      path: req.path,
      peer: clientIp,
      logger,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
