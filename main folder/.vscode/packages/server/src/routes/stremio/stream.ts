import { Router, Request, Response } from 'express';
import { AIOStreams, AIOStreamResponse } from '@aiostreams/core';
import { stremioStreamRateLimiter } from '../../middlewares/ratelimit';
import { createLogger } from '@aiostreams/core';
import { StremioTransformer } from '@aiostreams/core';
const router = Router();

const logger = createLogger('server');

router.use(stremioStreamRateLimiter);

router.get(
  '/:type/:id.json',
  async (req: Request, res: Response<AIOStreamResponse>, next) => {
    // Check if we have user data (set by middleware in authenticated routes)
    if (!req.userData) {
      // Return a response indicating configuration is needed
      res.status(200).json(
        StremioTransformer.createDynamicError('stream', {
          errorDescription: 'Please configure the addon first',
        })
      );
      return;
    }
    const transformer = new StremioTransformer(req.userData);

    try {
      const { type, id } = req.params;

      res
        .status(200)
        .json(
          await transformer.transformStreams(
            await (
              await new AIOStreams(req.userData).initialise()
            ).getStreams(id, type)
          )
        );
    } catch (error) {
      let errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      let errors = [
        {
          description: errorMessage,
        },
      ];
      if (transformer.showError('stream', errors)) {
        logger.error(
          `Unexpected error during stream retrieval: ${errorMessage}`
        );
        res.status(200).json(
          StremioTransformer.createDynamicError('stream', {
            errorDescription: errorMessage,
          })
        );
        return;
      }
      next(error);
    }
  }
);

export default router;
