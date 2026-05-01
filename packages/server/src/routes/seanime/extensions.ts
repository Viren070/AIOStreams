import { Router, Request, Response, NextFunction } from 'express';
import {
  APIError,
  constants,
  createLogger,
  decryptString,
  Env,
  getSimpleTextHash,
  UserRepository,
} from '@aiostreams/core';
import {
  applySeanimeManifestRuntimeConfig,
  isValidSeanimeExtensionId,
  readSeanimeExtensionManifest,
} from '../../utils/seanime.js';
import z from 'zod';

const logger = createLogger('server');
const router: Router = Router({ mergeParams: true });

const catalogDataSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  addonManifestUrl: z.url(),
  addonLogo: z.url(),
});

interface CustomSourceParams {
  encodedCatalogData: string;
}

router.get(
  '/extensions/:encodedCatalogData/stremio-custom-source.json',
  (req: Request<CustomSourceParams>, res: Response, next: NextFunction) => {
    const { encodedCatalogData } = req.params;
    let catalogData: z.infer<typeof catalogDataSchema>;
    try {
      const decoded = Buffer.from(encodedCatalogData, 'base64url').toString(
        'utf-8'
      );
      catalogData = catalogDataSchema.parse(JSON.parse(decoded));
    } catch (error) {
      res.status(400).json({ error: 'Invalid encoded catalog data' });
      return;
    }

    const manifest = readSeanimeExtensionManifest('stremio-custom-source');
    if (!manifest) {
      next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
      return;
    }

    const thisUrl = `${Env.BASE_URL}/seanime/extensions/${encodedCatalogData}/stremio-custom-source.json`;

    applySeanimeManifestRuntimeConfig(manifest, {
      manifestURI: thisUrl,
      website: catalogData.addonManifestUrl.replace(
        '/manifest.json',
        '/configure'
      ),
      baseUrl: Env.BASE_URL,
      stremioManifestUrl: catalogData.addonManifestUrl,
    });

    if (manifest.payload) {
      manifest.payload = manifest.payload
        .replace(/{{\s*catalogId\s*}}/g, catalogData.id)
        .replace(/{{\s*catalogType\s*}}/g, catalogData.type)
        .replace(/{{\s*manifestUrl\s*}}/g, catalogData.addonManifestUrl);
    }

    const hash = getSimpleTextHash(
      `${catalogData.addonManifestUrl}-${catalogData.id}-${catalogData.type}`
    ).slice(0, 16);

    manifest.id += `-${hash}`;
    manifest.name = catalogData.name;
    manifest.icon = catalogData.addonLogo;
    delete manifest.notes;
    delete manifest.userConfig;

    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(manifest);
  }
);

interface ExtensionManifestRequestParams {
  extensionId: string;
}

/**
 * GET /seanime/extensions/:extensionId
 * Serves the built extension manifest with manifestURI set to this URL.
 */
router.get(
  '/extensions/:extensionId.json',
  (
    req: Request<ExtensionManifestRequestParams>,
    res: Response,
    next: NextFunction
  ) => {
    const { extensionId } = req.params;

    if (!isValidSeanimeExtensionId(extensionId)) {
      res.status(404).json({ error: 'Extension not found' });
      return;
    }

    const manifest = readSeanimeExtensionManifest(extensionId);
    if (!manifest) {
      logger.error(`Seanime extension manifest not found for: ${extensionId}`);
      next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
      return;
    }

    applySeanimeManifestRuntimeConfig(manifest, {
      manifestURI: `${Env.BASE_URL}/seanime/extensions/${extensionId}.json`,
      website: `${Env.BASE_URL}/stremio/configure`,
      baseUrl: Env.BASE_URL,
    });

    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(manifest);
  }
);

interface AuthenticatedExtensionManifestRequestParams {
  uuid: string;
  encryptedPassword: string;
  extensionId: string;
}

/**
 * GET /seanime/:uuid/:encryptedPassword/extensions/:extensionId
 * Serves the extension manifest with the manifestUrl field default pre-populated
 * with the user's own Stremio manifest URL.
 */
router.get(
  '/:uuid/:encryptedPassword/extensions/:extensionId.json',
  async (
    req: Request<AuthenticatedExtensionManifestRequestParams>,
    res: Response,
    next: NextFunction
  ) => {
    const { uuid: uuidOrAlias, encryptedPassword, extensionId } = req.params;

    if (!isValidSeanimeExtensionId(extensionId)) {
      res.status(404).json({ error: 'Extension not found' });
      return;
    }

    // Validate UUID
    const uuidRegex =
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    let uuid: string;
    if (!uuidRegex.test(uuidOrAlias)) {
      const alias = Env.ALIASED_CONFIGURATIONS.get(uuidOrAlias);
      if (alias) {
        uuid = alias.uuid;
      } else {
        next(new APIError(constants.ErrorCode.USER_INVALID_DETAILS));
        return;
      }
    } else {
      uuid = uuidOrAlias;
    }

    try {
      const userExists = await UserRepository.checkUserExists(uuid);
      if (!userExists) {
        next(new APIError(constants.ErrorCode.USER_INVALID_DETAILS));
        return;
      }

      const { success } = decryptString(encryptedPassword);
      if (!success) {
        next(new APIError(constants.ErrorCode.USER_INVALID_DETAILS));
        return;
      }
    } catch (error: any) {
      logger.error(error.message);
      next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
      return;
    }

    const manifest = readSeanimeExtensionManifest(extensionId);
    if (!manifest) {
      logger.error(`Seanime extension manifest not found for: ${extensionId}`);
      next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
      return;
    }

    // Pre-populate the manifestUrl field default with the user's Stremio manifest URL
    const stremioManifestUrl = `${Env.BASE_URL}/stremio/${uuid}/${encryptedPassword}/manifest.json`;
    applySeanimeManifestRuntimeConfig(manifest, {
      manifestURI: `${Env.BASE_URL}/seanime/${uuid}/${encryptedPassword}/extensions/${extensionId}.json`,
      website: stremioManifestUrl.replace('/manifest.json', '/configure'),
      baseUrl: Env.BASE_URL,
      stremioManifestUrl,
    });

    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(manifest);
  }
);

export default router;
