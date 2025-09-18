import { Router, Request, Response } from 'express';
import {
  AIOStreams,
  APIError,
  constants,
  Env,
  getSimpleTextHash,
  UserData,
} from '@aiostreams/core';
import { Manifest } from '@aiostreams/core';
import { createLogger } from '@aiostreams/core';
import { stremioManifestRateLimiter } from '../../middlewares/ratelimit.js';

const logger = createLogger('server');
const router: Router = Router();

export default router;

router.use(stremioManifestRateLimiter);

const manifest = async (config?: UserData): Promise<Manifest> => {
  let addonId = Env.ADDON_ID;
  if (config) {
    addonId = addonId += `.${config.uuid?.substring(0, 12)}`;
  }
  let catalogs: Manifest['catalogs'] = [];
  let resources: Manifest['resources'] = [];
  let addonCatalogs: Manifest['addonCatalogs'] = [];
  if (config) {
    const aiostreams = new AIOStreams(config, { skipFailedAddons: true });

    await aiostreams.initialise();

    catalogs = aiostreams.getCatalogs();
    resources = aiostreams.getResources();
    addonCatalogs = aiostreams.getAddonCatalogs();
  }
  return {
    name: config?.addonName || Env.ADDON_NAME,
    id: addonId,
    version: Env.VERSION === 'unknown' ? '0.0.0' : Env.VERSION,
    description: config?.addonDescription || Env.DESCRIPTION,
    catalogs,
    resources,
    types: resources.reduce((types, resource) => {
      const resourceTypes =
        typeof resource === 'string' ? [resource] : resource.types;
      return [...new Set([...types, ...resourceTypes])];
    }, [] as string[]),
    background:
      config?.addonBackground ||
      'https://raw.githubusercontent.com/Viren070/AIOStreams/refs/heads/main/packages/frontend/public/assets/background.png',
    logo:
      config?.addonLogo ||
      'https://raw.githubusercontent.com/Viren070/AIOStreams/refs/heads/main/packages/frontend/public/assets/logo.png',
    behaviorHints: {
      configurable: true,
      configurationRequired: config ? false : true,
    },
    addonCatalogs,
    stremioAddonsConfig:
      Env.STREMIO_ADDONS_CONFIG_ISSUER && Env.STREMIO_ADDONS_CONFIG_SIGNATURE
        ? {
            issuer: Env.STREMIO_ADDONS_CONFIG_ISSUER,
            signature: Env.STREMIO_ADDONS_CONFIG_SIGNATURE,
          }
        : undefined,
  };
};

router.get('/', async (req: Request, res: Response<Manifest>, next) => {
  logger.debug('Manifest request received', { userData: req.userData });
  try {
    res.status(200).json(await manifest(req.userData));
  } catch (error) {
    logger.error(`Failed to generate manifest: ${error}`);
    next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
  }
});
