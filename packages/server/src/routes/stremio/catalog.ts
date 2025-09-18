import { Router, Request, Response } from 'express';
import {
  AIOStreams,
  CatalogResponse,
  createLogger,
  StremioTransformer,
} from '@aiostreams/core';
import { stremioCatalogRateLimiter } from '../../middlewares/ratelimit.js';

const logger = createLogger('server');
const router: Router = Router();

router.use(stremioCatalogRateLimiter);

router.get(
  '/:type/:id{/:extras}.json',
  async (req: Request, res: Response<CatalogResponse>, next) => {
    const transformer = new StremioTransformer(req.userData);
    if (!req.userData) {
      res.status(200).json(
        transformer.transformCatalog({
          success: false,
          data: [],
          errors: [{ description: 'Please configure the addon first' }],
        })
      );
      return;
    }

    try {
      const { type, id, extras } = req.params;

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
