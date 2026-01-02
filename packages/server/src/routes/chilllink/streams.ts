import { Router, Request, Response, NextFunction } from 'express';
import {
  AIOStreams,
  createLogger,
  constants,
  ChillLinkTransformer,
} from '@aiostreams/core';
import { stremioStreamRateLimiter } from '../../middlewares/ratelimit.js';
import { createResponse } from '../../utils/responses.js';
import z from 'zod';

const router: Router = Router();

const logger = createLogger('server');

router.use(stremioStreamRateLimiter);

const ChillLinkQuerySchema = z.object({
  type: z.string(),
  tmdbID: z.string(),
  imdbID: z.string().optional(),
  season: z.coerce.number().optional(),
  episode: z.coerce.number().optional(),
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  // Check if we have user data (set by middleware in authenticated routes)
  if (!req.userData) {
    // Return a response indicating configuration is needed
    res.status(400).json(
      createResponse({
        success: false,
        error: {
          code: constants.ErrorCode.BAD_REQUEST,
          message: 'Please configure the addon first',
        },
      })
    );
    return;
  }
  const transformer = new ChillLinkTransformer(req.userData);

  try {
    const { tmdbID, imdbID, type, season, episode } =
      ChillLinkQuerySchema.parse(req.query);

    const stremioId =
      (imdbID || `tmdb:${tmdbID}`) +
      (season ? `:${season}` : '') +
      (episode ? `:${episode}` : '');

    const aiostreams = await new AIOStreams(req.userData).initialise();

    res
      .status(200)
      .json(
        await transformer.transformStreams(
          await aiostreams.getStreams(stremioId, type)
        )
      );
  } catch (error) {
    let errorMessage = error instanceof Error ? error.message : 'Unknown error';
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
      res.status(200).json({
        sources: [
          ChillLinkTransformer.createErrorStream({
            errorDescription: errorMessage,
          }),
        ],
      });
      return;
    }
    next(error);
  }
});

export default router;
