import { Router, Request, Response, NextFunction } from 'express';
import {
  AIOStreams,
  APIError,
  config as appConfig,
  constants,
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
  let addonId = appConfig.branding.addonId;
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
    name: config?.addonName || appConfig.branding.addonName,
    id: addonId,
    version:
      appConfig.bootstrap.version === 'unknown'
        ? '0.0.0'
        : appConfig.bootstrap.version,
    description: config?.addonDescription || appConfig.bootstrap.description,
    catalogs,
    resources,
    types: resources.reduce((types, resource) => {
      const resourceTypes =
        typeof resource === 'string' ? [resource] : resource.types;
      return [...new Set([...types, ...resourceTypes])];
    }, [] as string[]),
    logo:
      config?.addonLogo ||
      `https://raw.githubusercontent.com/Viren070/AIOStreams/refs/heads/main/packages/frontend/public/logo${
        appConfig.branding.alternateDesign ? '_alt' : ''
      }.png`,
    behaviorHints: {
      configurable: true,
      configurationRequired: config ? false : true,
    },
    addonCatalogs,
    stremioAddonsConfig:
      appConfig.api.stremioAddonsConfigIssuer &&
      appConfig.api.stremioAddonsConfigSignature
        ? {
            issuer: appConfig.api.stremioAddonsConfigIssuer,
            signature: appConfig.api.stremioAddonsConfigSignature,
          }
        : undefined,
  };
};

router.get(
  '/',
  async (req: Request, res: Response<Manifest>, next: NextFunction) => {
    logger.info({ uuid: req.userData?.uuid }, 'received request for manifest');
    try {
      res.status(200).json(await manifest(req.userData));
    } catch (error) {
      logger.error(`Failed to generate manifest: ${error}`);
      next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
    }
  }
);
