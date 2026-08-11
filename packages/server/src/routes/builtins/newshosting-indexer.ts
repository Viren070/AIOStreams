import { Router, Request, Response, NextFunction } from 'express';
import {
  createNewshostingNzb,
  decryptString,
  NewshostingIndexerAddon,
  NewshostingPrivateConfigSchema,
  verifyConfigProxyGrant,
} from '@aiostreams/core';

const router: Router = Router();

function decryptJson(encodedConfig: string, label: string): unknown {
  const decrypted = decryptString(encodedConfig);
  if (!decrypted.success || !decrypted.data) {
    throw new Error(`Invalid encrypted Newshosting ${label} configuration`);
  }
  try {
    return JSON.parse(decrypted.data);
  } catch {
    throw new Error(`Invalid encrypted Newshosting ${label} configuration`);
  }
}

router.get(
  '/:encodedConfig/manifest.json',
  async (
    req: Request<{ encodedConfig: string }>,
    res: Response,
    next: NextFunction
  ) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json(
        new NewshostingIndexerAddon(
          decryptJson(req.params.encodedConfig, 'addon') as any,
          req.userIp
        ).getManifest()
      );
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:encodedConfig/stream/:type/:id.json',
  async (
    req: Request<{
      encodedConfig: string;
      type: string;
      id: string;
    }>,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const addon = new NewshostingIndexerAddon(
        decryptJson(req.params.encodedConfig, 'addon') as any,
        req.userIp
      );
      res.set('Cache-Control', 'private, no-store');
      res.json({
        streams: await addon.getStreams(req.params.type, req.params.id),
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:nzbConfig/nzb/:encodedId',
  async (
    req: Request<{ nzbConfig: string; encodedId: string }>,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const config = NewshostingPrivateConfigSchema.parse(
        decryptJson(req.params.nzbConfig, 'NZB')
      );
      const grant = verifyConfigProxyGrant(config.proxyAuth);
      if (!grant || grant.audience !== 'newshosting-nzb') {
        throw new Error('Invalid Newshosting NZB proxy authorization');
      }
      const content = Buffer.from(
        await createNewshostingNzb(req.params.encodedId, config),
        'utf8'
      );
      res.status(200);
      res.set('Cache-Control', 'private, no-store');
      res.set('Content-Type', 'application/x-nzb');
      res.set('Content-Length', String(content.length));
      res.set('Content-Disposition', 'attachment; filename="newshosting.nzb"');
      res.end(content);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
