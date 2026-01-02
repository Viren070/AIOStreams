import { Router, Request, Response, NextFunction } from 'express';
import {
  AIOStreams,
  APIError,
  constants,
  Env,
  UserData,
} from '@aiostreams/core';
import { Manifest } from '@aiostreams/core';
import { createLogger } from '@aiostreams/core';
import { stremioManifestRateLimiter } from '../../middlewares/ratelimit.js';

const logger = createLogger('server');
const router: Router = Router();

router.use(stremioManifestRateLimiter);

interface ChillLinkManifest {
  id: string;
  version: string;
  name: string;
  description: string;
  supported_endpoints: {
    feeds: string | null;
    streams: string | null;
  };
}

const manifest = async (config?: UserData): Promise<ChillLinkManifest> => {
  let addonId = Env.ADDON_ID;
  if (config) {
    addonId += `.${config.uuid?.substring(0, 12)}`;
  }
  let resources: Manifest['resources'] = [];
  if (config) {
    const aiostreams = new AIOStreams(config, { skipFailedAddons: true });

    await aiostreams.initialise();
    resources = aiostreams.getResources();
  }
  return {
    name: config?.addonName || Env.ADDON_NAME,
    id: addonId,
    version: Env.VERSION === 'unknown' ? '0.0.0' : Env.VERSION,
    description: config?.addonDescription || Env.DESCRIPTION,
    supported_endpoints: {
      feeds: null,
      streams:
        resources.find(
          (resource) =>
            (typeof resource === 'string' ? resource : resource.name) ===
            'stream'
        ) !== undefined
          ? '/streams'
          : null,
    },
  };
};

router.get(
  '/',
  async (
    req: Request,
    res: Response<ChillLinkManifest>,
    next: NextFunction
  ) => {
    logger.debug('Manifest request received', { userData: req.userData });
    try {
      res.status(200).json(await manifest(req.userData));
    } catch (error) {
      logger.error(`Failed to generate manifest: ${error}`);
      next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
    }
  }
);

export default router;
