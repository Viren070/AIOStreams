import { Router, Request, Response, NextFunction } from 'express';
import {
  AIOStreams,
  AIOStreamResponse,
  config as appConfig,
  createLogger,
  StremioTransformer,
  Cache,
  IdParser,
} from '@aiostreams/core';
import { stremioStreamRateLimiter } from '../../middlewares/ratelimit.js';
import { trackResource } from '../../middlewares/analytics.js';

const router: Router = Router();

const logger = createLogger('server');

router.use(stremioStreamRateLimiter);
router.use(trackResource('stream'));

interface StreamParams {
  type: string;
  id: string;
}

router.get(
  '/:type/:id.json',
  async (
    req: Request<StreamParams>,
    res: Response<AIOStreamResponse>,
    next: NextFunction
  ) => {
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

    const provideSetting = appConfig.api.provideStreamData;
    const provideStreamData =
      provideSetting === null
        ? (req.headers['user-agent']?.includes('AIOStreams/') ?? false)
        : typeof provideSetting === 'boolean'
          ? provideSetting
          : provideSetting.includes(req.requestIp || '');

    try {
      const { type, id } = req.params;

      const aiostreams = await new AIOStreams(req.userData).initialise();

      const disableAutoplay = await aiostreams.shouldStopAutoPlay(type, id);

      const response = await aiostreams.getStreams(id, type);
      const streamContext = aiostreams.getStreamContext();

      if (!streamContext) {
        throw new Error('Stream context not available');
      }

      res
        .status(200)
        .json(
          await transformer.transformStreams(
            response,
            streamContext.toFormatterContext(response.data.streams),
            { provideStreamData, disableAutoplay }
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
          `Unexpected error during stream retrieval: ${errorMessage}`,
          error
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
