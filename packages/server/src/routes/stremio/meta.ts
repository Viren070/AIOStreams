import { Router, Request, Response } from 'express';
import {
  AIOStreams,
  MetaResponse,
  createLogger,
  StremioTransformer,
} from '@aiostreams/core';

import { stremioMetaRateLimiter } from '../../middlewares/ratelimit.js';

const logger = createLogger('server');
const router: Router = Router();

router.use(stremioMetaRateLimiter);

router.get(
  '/:type/:id.json',
  async (req: Request, res: Response<MetaResponse>, next) => {
    if (!req.userData) {
      res.status(200).json({
        meta: StremioTransformer.createErrorMeta({
          errorDescription: 'Please configure the addon first',
        }),
      });
      return;
    }
    const transformer = new StremioTransformer(req.userData);
    try {
      const { type, id } = req.params;
      logger.debug('Meta request received', {
        type,
        id,
        userData: req.userData,
      });

      if (id.startsWith('aiostreamserror.')) {
        res.status(200).json({
          meta: StremioTransformer.createErrorMeta(
            JSON.parse(decodeURIComponent(id.split('.').slice(1).join('.')))
          ),
        });
        return;
      }

      const aiostreams = new AIOStreams(req.userData);
      await aiostreams.initialise();

      const meta = await aiostreams.getMeta(type, id);
      const transformed = await transformer.transformMeta(meta);
      if (!transformed) {
        next();
      } else {
        res.status(200).json(transformed);
      }
    } catch (error) {
      next(error);
    }
  }
);

export default router;
