import { Router, Request, Response } from 'express';
import {
  AIOStreams,
  SubtitleResponse,
  createLogger,
  StremioTransformer,
} from '@aiostreams/core';
import { stremioSubtitleRateLimiter } from '../../middlewares/ratelimit.js';

const logger = createLogger('server');
const router: Router = Router();

router.use(stremioSubtitleRateLimiter);

router.get(
  '/:type/:id{/:extras}.json',
  async (req: Request, res: Response<SubtitleResponse>, next) => {
    if (!req.userData) {
      res.status(200).json(
        StremioTransformer.createDynamicError('subtitles', {
          errorDescription: 'Please configure the addon first',
        })
      );
      return;
    }
    const transformer = new StremioTransformer(req.userData);
    try {
      const { type, id, extras } = req.params;

      res
        .status(200)
        .json(
          transformer.transformSubtitles(
            await (
              await new AIOStreams(req.userData).initialise()
            ).getSubtitles(type, id, extras)
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
      if (transformer.showError('subtitles', errors)) {
        logger.error(
          `Unexpected error during subtitle retrieval: ${errorMessage}`
        );
        res.status(200).json(
          StremioTransformer.createDynamicError('subtitles', {
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
