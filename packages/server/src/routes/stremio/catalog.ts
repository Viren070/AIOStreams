import { Router, Request, Response } from 'express';
import {
  AIOStreams,
  CatalogResponse,
  createLogger,
  StremioTransformer,
} from '@aiostreams/core';
import { trackResource } from '../../middlewares/analytics.js';
import { rawExtras } from '../../utils/extras.js';

const logger = createLogger('server');
const router: Router = Router();

router.use(trackResource('catalog'));

interface CatalogParams {
  type: string;
  id: string;
  extras?: string; // optional
}

router.get(
  '/:type/:id{/:extras}.json',
  async (req: Request<CatalogParams>, res: Response<CatalogResponse>, next) => {
    if (!req.userData) {
      res.status(200).json(
        StremioTransformer.createDynamicError('catalog', {
          errorDescription: 'Please configure the addon first',
        })
      );
      return;
    }
    const transformer = new StremioTransformer(req.userData);

    try {
      const { type, id } = req.params;
      const extras = rawExtras(req);

      res
        .status(200)
        .json(
          transformer.transformCatalog(
            await (
              await new AIOStreams(req.userData).initialise()
            ).getCatalog(type, id, extras)
          )
        );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errors = [
        {
          description: errorMsg,
        },
      ];
      if (transformer.showError('catalog', errors)) {
        logger.error(`Unexpected error during catalog retrieval: ${errorMsg}`);
        res.status(200).json(
          transformer.transformCatalog({
            success: false,
            data: [],
            errors,
          })
        );
        return;
      }
      next(error);
    }
  }
);

export default router;
