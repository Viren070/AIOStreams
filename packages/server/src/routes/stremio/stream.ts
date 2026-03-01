import { Router, Request, Response, NextFunction } from 'express';
import {
  AIOStreams,
  AIOStreamResponse,
  Env,
  createLogger,
  StremioTransformer,
  Cache,
  IdParser,
  constants,
  encryptString,
} from '@aiostreams/core';
import { stremioStreamRateLimiter } from '../../middlewares/ratelimit.js';

const router: Router = Router();

const logger = createLogger('server');

router.use(stremioStreamRateLimiter);

/**
 * Convert a string to Title Case (capitalize first letter of each word).
 */
function toTitleCase(str: string): string {
  return str.replace(
    /\w\S*/g,
    (word) => word.charAt(0).toUpperCase() + word.slice(1)
  );
}

/**
 * Generate the STRM filename from metadata.
 */
function generateStrmFilename(
  metadata: { title?: string; year?: number } | undefined,
  parsedId: {
    type: string;
    value: string | number;
    season?: string;
    episode?: string;
  } | null,
  type: string
): string {
  // Build the base name from metadata title or fallback, with Title Case
  let baseName = toTitleCase(metadata?.title || 'Unknown');

  // Add year for movies
  if (metadata?.year) {
    baseName += ` (${metadata.year})`;
  }

  // Add season/episode for series
  if (type === 'series' && parsedId?.season && parsedId?.episode) {
    const season = String(parsedId.season).padStart(2, '0');
    const episode = String(parsedId.episode).padStart(2, '0');
    baseName += ` S${season}E${episode}`;
  }

  return `${baseName}.strm`;
}

/**
 * Wrap stream URLs through the STRM gate endpoint.
 * The gate will decide at request time (based on User-Agent) whether to serve
 * a .strm file or redirect to the actual stream URL.
 * The URL looks identical to a normal API call - the .strm filename is only
 * used in the Content-Disposition header when the gate serves the file.
 */
function wrapStreamsWithStrmGate(
  result: AIOStreamResponse,
  strmFilename: string,
  strmMode: 'always' | 'userAgent',
  userAgents: string[]
): AIOStreamResponse {
  const wrappedStreams = result.streams.map((stream) => {
    // Only wrap streams that have an HTTP url
    if (!stream.url) {
      return stream;
    }

    const payload = JSON.stringify({
      url: stream.url,
      mode: strmMode,
      userAgents,
    });

    const encrypted = encryptString(payload);
    if (!encrypted.success || !encrypted.data) {
      logger.warn('Failed to encrypt STRM gate payload, keeping original URL');
      return stream;
    }

    return {
      ...stream,
      url: `${Env.BASE_URL}/api/v${constants.API_VERSION}/strm-gate/${encrypted.data}/${encodeURIComponent(strmFilename)}`,
    };
  });

  return { ...result, streams: wrappedStreams };
}

router.get(
  '/:type/:id.json',
  async (
    req: Request,
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

    const provideStreamData =
      Env.PROVIDE_STREAM_DATA !== undefined
        ? typeof Env.PROVIDE_STREAM_DATA === 'boolean'
          ? Env.PROVIDE_STREAM_DATA
          : Env.PROVIDE_STREAM_DATA.includes(req.requestIp || '')
        : (req.headers['user-agent']?.includes('AIOStreams/') ?? false);

    try {
      const { type, id } = req.params;

      const aiostreams = await new AIOStreams(req.userData).initialise();

      const disableAutoplay = await aiostreams.shouldStopAutoPlay(type, id);

      const response = await aiostreams.getStreams(id, type);
      const streamContext = aiostreams.getStreamContext();

      if (!streamContext) {
        throw new Error('Stream context not available');
      }

      let result = await transformer.transformStreams(
        response,
        streamContext.toFormatterContext(response.data.streams),
        { provideStreamData, disableAutoplay }
      );

      // STRM Gate wrapping: wrap stream URLs through the gate endpoint
      const strmConfig = req.userData.strmOutput;
      if (strmConfig?.mode && strmConfig.mode !== 'disabled') {
        const metadata = await streamContext.getMetadata();
        const strmFilename = generateStrmFilename(
          metadata,
          streamContext.parsedId,
          type
        );
        const userAgents = strmConfig.userAgents ?? ['Infuse'];

        result = wrapStreamsWithStrmGate(
          result,
          strmFilename,
          strmConfig.mode as 'always' | 'userAgent',
          userAgents
        );

        logger.info(
          `Wrapped ${result.streams.filter((s) => s.url?.includes('/strm-gate/')).length} streams with STRM gate (mode: ${strmConfig.mode}, filename: ${strmFilename})`
        );
      }

      res.status(200).json(result);
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
