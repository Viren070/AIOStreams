import { Router, Request, Response } from 'express';
import { AIOStreams, constants, MetaResponse } from '@aiostreams/core';
import { createLogger } from '@aiostreams/core';
import { createResponse } from '../../utils/responses';
import { StremioTransformer } from '@aiostreams/core';
import { stremioMetaRateLimiter } from '../../middlewares/ratelimit';

const logger = createLogger('server');
const router = Router();

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

      const aiostreams = new AIOStreams(req.userData);
      await aiostreams.initialise();

      const meta = await aiostreams.getMeta(type, id);
      const transformed = transformer.transformMeta(meta);
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
