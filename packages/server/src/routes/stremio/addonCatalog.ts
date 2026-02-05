import { Router, Request, Response } from 'express';
import {
  AddonCatalogResponse,
  AIOStreams,
  createLogger,
  StremioTransformer,
} from '@aiostreams/core';

const logger = createLogger('server');
const router: Router = Router();

interface AddonCatalogParams {
  type?: string;
  id?: string;
}

router.get(
  '/:type/:id.json',
  async (req: Request<AddonCatalogParams>, res: Response<AddonCatalogResponse>, next) => {
    if (!req.userData) {
      res.status(200).json({
        addons: [
          StremioTransformer.createErrorAddonCatalog({
            errorDescription: 'Please configure the addon first',
          }),
        ],
      });
      return;
    }
    const transformer = new StremioTransformer(req.userData);

    try {
      const { type, id } = req.params;
      if (!type || !id) {
        res.status(200).json({
          addons: [
            StremioTransformer.createErrorAddonCatalog({
              errorDescription: 'Missing URL Parameters: Type and id are required',
            }),
          ],
        });
        return;
      }
      logger.debug('Addon catalog request received', {
        type,
        id,
      });
      res
        .status(200)
        .json(
          transformer.transformAddonCatalog(
            await (
              await new AIOStreams(req.userData).initialise()
            ).getAddonCatalog(type, id)
          )
        );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errors = [
        {
          description: errorMsg,
        },
      ];
      if (transformer.showError('addon_catalog', errors)) {
        logger.error(
          `Unexpected error during addon catalog retrieval: ${errorMsg}`
        );
        res.status(200).json(
          transformer.transformAddonCatalog({
            success: false,
            data: [],
            errors,
          })
        );
      } else {
        next(error);
      }
    }
  }
);

export default router;
